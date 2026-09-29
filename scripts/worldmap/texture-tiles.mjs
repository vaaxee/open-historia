// Phase 9 (suite) — la texture de terrain Natural Earth II en tuiles.
//   node scripts/worldmap/texture-tiles.mjs [--max 5]
// Source : Natural Earth II with Shaded Relief, Water, and Drainage, haute
// résolution (NE2_HR_LC_SR_W_DR.tif, 21 600 × 10 800, plate carrée, domaine
// public), dézippée dans DATA/worldmap/work/ne2/. Sortie : tuiles PNG Mercator
// 256 px, zooms 0 à --max (5 par défaut), dans DATA/hoi-texture/ne2/{z}/{x}/{y}.png.
// La mer de NE2 devient transparente (la carte garde sa mer ardoise) ; une tuile
// toute en mer n'est pas écrite (le serveur répond 204). Le zoom le plus fin est
// tiré de la source, chaque zoom au-dessus est la moyenne de ses quatre enfants.
// OH_DATA_DIR : un autre dossier de données.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const DATA = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
const SOURCE = path.join(DATA, "worldmap", "work", "ne2", "NE2_HR_LC_SR_W_DR.tif");
const OUT = process.env.OH_TEXTURE_OUT || path.join(DATA, "hoi-texture", "ne2");
const SIZE = 256;

// L'eau de NE2 (océans, mers, lacs : ~ 109, 164, 201) : nettement bleue.
export const isWater = (r, g, b) => b > r + 40 && b > g + 12;

// Un PNG RGBA (type de couleur 6), sans filtre.
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buffer) => { let c = -1; for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
export const encodePngRgba = (rgba, size = SIZE) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
};

const latOfY = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(Math.sinh(n)); };

// Une tuile du zoom le plus fin, tirée de la source : chaque pixel moyenne
// jusqu'à 4 × 4 échantillons du rectangle qu'il couvre ; l'alpha est la part de
// terre, la couleur celle de la terre seule.
export const sourceTile = ({ pixels, width, height }, z, x, y) => {
  const out = new Uint8Array(SIZE * SIZE * 4);
  const scale = 2 ** z * SIZE;
  let land = 0;
  for (let py = 0; py < SIZE; py += 1) {
    const lat0 = latOfY((y * SIZE + py) / SIZE, z); const lat1 = latOfY((y * SIZE + py + 1) / SIZE, z);
    const row0 = Math.max(0, Math.min(height - 1, ((90 - lat0) / 180) * height));
    const row1 = Math.max(0, Math.min(height - 1, ((90 - lat1) / 180) * height));
    const rows = Math.max(1, Math.min(4, Math.round(row1 - row0)));
    for (let px = 0; px < SIZE; px += 1) {
      const col0 = (((x * SIZE + px) / scale) * width);
      const col1 = (((x * SIZE + px + 1) / scale) * width);
      const cols = Math.max(1, Math.min(4, Math.round(col1 - col0)));
      let r = 0; let g = 0; let b = 0; let n = 0; let total = 0;
      for (let j = 0; j < rows; j += 1) {
        const row = Math.min(height - 1, Math.floor(row0 + ((j + 0.5) * (row1 - row0)) / rows));
        for (let i = 0; i < cols; i += 1) {
          const col = Math.min(width - 1, Math.floor(col0 + ((i + 0.5) * (col1 - col0)) / cols));
          const at = (row * width + col) * 3;
          total += 1;
          if (isWater(pixels[at], pixels[at + 1], pixels[at + 2])) continue;
          r += pixels[at]; g += pixels[at + 1]; b += pixels[at + 2]; n += 1;
        }
      }
      const k = (py * SIZE + px) * 4;
      if (n) { out[k] = r / n; out[k + 1] = g / n; out[k + 2] = b / n; out[k + 3] = Math.round((255 * n) / total); land += 1; }
    }
  }
  return land ? out : null;
};

// Un parent, depuis ses quatre enfants (null : tout en mer) ; la couleur pondérée par l'alpha.
export const parentTile = (children) => {
  if (children.every((child) => !child)) return null;
  const out = new Uint8Array(SIZE * SIZE * 4);
  const half = SIZE / 2;
  for (let q = 0; q < 4; q += 1) {
    const child = children[q];
    if (!child) continue;
    const ox = (q % 2) * half; const oy = Math.floor(q / 2) * half;
    for (let py = 0; py < half; py += 1) {
      for (let px = 0; px < half; px += 1) {
        let r = 0; let g = 0; let b = 0; let a = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const k = ((py * 2 + dy) * SIZE + (px * 2 + dx)) * 4;
          const w = child[k + 3];
          r += child[k] * w; g += child[k + 1] * w; b += child[k + 2] * w; a += w;
        }
        const k = ((oy + py) * SIZE + (ox + px)) * 4;
        if (a) { out[k] = r / a; out[k + 1] = g / a; out[k + 2] = b / a; out[k + 3] = a / 4; }
      }
    }
  }
  return out;
};

// La source en mémoire : un TIF non compressé, une bande par ligne, RVB entrelacé.
const readSource = async () => {
  const { fromFile } = await import("geotiff");
  const tiff = await fromFile(SOURCE);
  const image = await tiff.getImage();
  const width = image.getWidth(); const height = image.getHeight();
  const directory = image.fileDirectory;
  const offsets = directory.StripOffsets ?? (await directory.loadValue?.("StripOffsets"));
  if (!offsets || image.getSamplesPerPixel() !== 3 || (directory.Compression ?? 1) !== 1) throw new Error("unexpected TIF layout");
  const file = fs.readFileSync(SOURCE);
  const rowBytes = width * 3;
  const pixels = Buffer.alloc(rowBytes * height);
  const perStrip = Math.max(1, Number(directory.RowsPerStrip ?? 1));
  for (let s = 0; s < offsets.length; s += 1) {
    const rows = Math.min(perStrip, height - s * perStrip);
    file.copy(pixels, s * perStrip * rowBytes, Number(offsets[s]), Number(offsets[s]) + rows * rowBytes);
  }
  return { pixels, width, height };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const at = process.argv.indexOf("--max");
  const max = at > 0 ? Number(process.argv[at + 1]) : 5;
  const started = Date.now();
  const source = await readSource();
  let written = 0; let bytes = 0;
  const save = (z, x, y, rgba) => {
    if (!rgba) return;
    const dir = path.join(OUT, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    const png = encodePngRgba(rgba);
    fs.writeFileSync(path.join(dir, `${y}.png`), png);
    written += 1; bytes += png.length;
  };
  fs.rmSync(OUT, { recursive: true, force: true });
  let level = new Map();
  for (let x = 0; x < 2 ** max; x += 1) {
    for (let y = 0; y < 2 ** max; y += 1) {
      const tile = sourceTile(source, max, x, y);
      if (tile) level.set(`${x}/${y}`, tile);
      save(max, x, y, tile);
    }
  }
  for (let z = max - 1; z >= 0; z -= 1) {
    const next = new Map();
    for (let x = 0; x < 2 ** z; x += 1) {
      for (let y = 0; y < 2 ** z; y += 1) {
        const tile = parentTile([[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => level.get(`${x * 2 + dx}/${y * 2 + dy}`) ?? null));
        if (tile) next.set(`${x}/${y}`, tile);
        save(z, x, y, tile);
      }
    }
    level = next;
  }
  console.log(`${written} tuiles de texture (zooms 0 à ${max}, ${Math.round(bytes / 1048576)} Mo) écrites dans ${OUT}, en ${Math.round((Date.now() - started) / 1000)} s`);
}
