// Phase 9 — le relief de la carte mondiale, sans rien télécharger.
//
//   node scripts/worldmap/dem-pyramid.mjs
//
// Les tuiles d'altitude Terrarium de zoom 4 sont déjà là (hoi-elevation/terrarium/4,
// posées par scripts/hoi-fetch-elevation.mjs en phase 4). MapLibre en veut aussi
// aux zooms 0 à 3 pour ombrer la carte vue de loin : chaque tuile de zoom z est
// la moyenne 2×2 des quatre tuiles de zoom z+1 qu'elle couvre. Écrit
// hoi-elevation/terrarium/{0..3}/x/y.png (PNG RVB 8 bits, encodage Terrarium :
// (R × 256 + G + B / 256) − 32 768 mètres). OH_DATA_DIR : un autre dossier.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const DATA = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
const ROOT = path.join(DATA, "hoi-elevation", "terrarium");
const SIZE = 256;

// ——— PNG ———

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

// Un PNG RVB 8 bits de `width` × `height` à partir de `rgb` (Uint8Array).
export const encodePngRgb = (rgb, width, height) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 3 + 1)] = 0; // pas de filtre
    Buffer.from(rgb.buffer, rgb.byteOffset + row * width * 3, width * 3).copy(raw, row * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
};

// PNG RVB/RVBA 8 bits non entrelacé → { width, height, channels, pixels }.
export const decodePng = (buffer) => {
  let offset = 8; let width = 0; let height = 0; let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const out = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? pixels[out + i - channels] : 0;
      const up = row > 0 ? pixels[out - stride + i] : 0;
      const upLeft = row > 0 && i >= channels ? pixels[out - stride + i - channels] : 0;
      let value = raw[row * (stride + 1) + 1 + i];
      if (filter === 1) value += left; else if (filter === 2) value += up; else if (filter === 3) value += (left + up) >> 1; else if (filter === 4) value += paeth(left, up, upLeft);
      pixels[out + i] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
};

// ——— Altitudes ———

export const toHeights = ({ width, height, channels, pixels }) => {
  const heights = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) heights[i] = pixels[i * channels] * 256 + pixels[i * channels + 1] + pixels[i * channels + 2] / 256 - 32768;
  return heights;
};
export const toTerrariumRgb = (heights) => {
  const rgb = new Uint8Array(heights.length * 3);
  for (let i = 0; i < heights.length; i += 1) {
    const v = Math.max(0, Math.min(65535.99, heights[i] + 32768));
    rgb[i * 3] = Math.floor(v / 256); rgb[i * 3 + 1] = Math.floor(v) % 256; rgb[i * 3 + 2] = Math.floor((v - Math.floor(v)) * 256);
  }
  return rgb;
};

// Une tuile de zoom z à partir de ses quatre enfants (null = océan à 0 m).
export const parentHeights = (children) => {
  const out = new Float32Array(SIZE * SIZE);
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const child = children[quadrant];
    const ox = (quadrant % 2) * (SIZE / 2); const oy = Math.floor(quadrant / 2) * (SIZE / 2);
    for (let y = 0; y < SIZE / 2; y += 1) {
      for (let x = 0; x < SIZE / 2; x += 1) {
        let sum = 0;
        if (child) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sum += child[(y * 2 + dy) * SIZE + x * 2 + dx];
        out[(oy + y) * SIZE + ox + x] = child ? sum / 4 : 0;
      }
    }
  }
  return out;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const started = Date.now();
  const read = (z, x, y) => {
    const file = path.join(ROOT, String(z), String(x), `${y}.png`);
    return fs.existsSync(file) ? toHeights(decodePng(fs.readFileSync(file))) : null;
  };
  let written = 0;
  for (let z = 3; z >= 0; z -= 1) {
    const n = 2 ** z;
    for (let x = 0; x < n; x += 1) {
      for (let y = 0; y < n; y += 1) {
        const children = [read(z + 1, x * 2, y * 2), read(z + 1, x * 2 + 1, y * 2), read(z + 1, x * 2, y * 2 + 1), read(z + 1, x * 2 + 1, y * 2 + 1)];
        if (children.every((child) => !child)) continue;
        const dir = path.join(ROOT, String(z), String(x));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${y}.png`), encodePngRgb(toTerrariumRgb(parentHeights(children)), SIZE, SIZE));
        written += 1;
      }
    }
  }
  console.log(`${written} tuiles de relief (zooms 0 à 3) écrites dans ${ROOT}, en ${Date.now() - started} ms`);
}
