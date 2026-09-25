/*! Couche HOI4, phase 4 — l'altitude des provinces, lue dans des tuiles Terrarium. */
// Les tuiles Terrarium d'AWS (projet public « Terrain Tiles », sans clé) donnent
// l'altitude dans les couleurs d'un PNG : (R × 256 + G + B / 256) − 32768 mètres.
// Elles ne sont JAMAIS téléchargées par le serveur : c'est le rôle du script
// scripts/hoi-fetch-elevation.mjs, lancé à la main. Sans elles, le terrain vient
// de la règle simple (hoiTerrain.js).
//
// Zoom 4 : 16 × 16 tuiles de 256 px, un pixel ≈ 10 km à l'équateur. Assez pour
// dire d'une province de 10 000 km² (≈ 100 pixels) si elle est montagneuse.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { DATA_DIR } from "./dataDir.js";

export const ELEVATION_ZOOM = 4;
export const ELEVATION_DIR = path.join(DATA_DIR, "hoi-elevation", "terrarium", String(ELEVATION_ZOOM));
export const ELEVATION_TILE_COUNT = (2 ** ELEVATION_ZOOM) ** 2;

export const tilePath = (x, y) => path.join(ELEVATION_DIR, String(x), `${y}.png`);

// Combien de tuiles sont là : le cache des provinces se recalcule quand ça change.
export const elevationTilesPresent = () => {
  let count = 0;
  for (let x = 0; x < 2 ** ELEVATION_ZOOM; x += 1) {
    for (let y = 0; y < 2 ** ELEVATION_ZOOM; y += 1) if (fs.existsSync(tilePath(x, y))) count += 1;
  }
  return count;
};

// ---------------------------------------------------------------------------
// PNG : 8 bits, RVB ou RVBA, non entrelacé (ce que sont les tuiles Terrarium).
// ---------------------------------------------------------------------------

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

export const decodePng = (buffer) => {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0; let height = 0; let colorType = 0; let bitDepth = 0; let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace) throw new Error("unsupported PNG");
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const out = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? pixels[out + i - channels] : 0;
      const up = row > 0 ? pixels[out - stride + i] : 0;
      const upLeft = row > 0 && i >= channels ? pixels[out - stride + i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      pixels[out + i] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
};

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

const tiles = new Map();
const loadTile = (x, y) => {
  const key = `${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key);
  let heights = null;
  try {
    const { width, height, channels, pixels } = decodePng(fs.readFileSync(tilePath(x, y)));
    heights = { width, height, data: new Int16Array(width * height) };
    for (let i = 0; i < width * height; i += 1) {
      const r = pixels[i * channels]; const g = pixels[i * channels + 1]; const b = pixels[i * channels + 2];
      heights.data[i] = Math.max(-32768, Math.min(32767, Math.round(r * 256 + g + b / 256 - 32768)));
    }
  } catch {
    heights = null;
  }
  tiles.set(key, heights);
  return heights;
};

// L'altitude en un point (mètres), ou null sans tuile.
export const elevationAt = (lng, lat) => {
  const n = 2 ** ELEVATION_ZOOM;
  const clampedLat = Math.max(-85.05, Math.min(85.05, lat));
  const xf = ((lng + 180) / 360) * n;
  const rad = (clampedLat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.max(0, Math.floor(xf)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(yf)));
  const tile = loadTile(x, y);
  if (!tile) return null;
  const px = Math.min(tile.width - 1, Math.floor((xf - x) * tile.width));
  const py = Math.min(tile.height - 1, Math.floor((yf - y) * tile.height));
  return tile.data[py * tile.width + px];
};

// Moyenne, relief (écart-type) et maximum d'altitude sur des points d'une
// province ; null s'il manque les tuiles. La mer (< 0) n'entre pas dans le calcul.
export const elevationStats = (points) => {
  const values = [];
  for (const [lng, lat] of points) {
    const value = elevationAt(lng, lat);
    if (value === null) return null;
    if (value >= 0) values.push(value);
  }
  if (!values.length) return { mean: 0, relief: 0, max: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const relief = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  return { mean: Math.round(mean), relief: Math.round(relief), max: Math.max(...values) };
};
