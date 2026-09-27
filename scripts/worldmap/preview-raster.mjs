#!/usr/bin/env node
// Aperçu brut de la trame des provinces (avant vectorisation), en PNG.
//   node scripts/worldmap/preview-raster.mjs <ouest> <sud> <est> <nord> <fichier.png> [pixels par case]

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { H, N, W, colOf, rowOf } from "./lib/grid.mjs";
import { writePng } from "./lib/png.mjs";

const WORK = path.join(DATA_DIR, "worldmap", "work");
const load = (name, Type) => { const b = fs.readFileSync(path.join(WORK, `${name}.bin`)); return new Type(b.buffer, b.byteOffset, b.byteLength / Type.BYTES_PER_ELEMENT); };
const [west, south, east, north] = process.argv.slice(2, 6).map(Number);
const file = process.argv[6];
const scale = Number(process.argv[7] || 3);
const labels = load("labels", Int32Array);
const rivers = load("rivers", Uint8Array);
const zones = load("zones", Int32Array);

const i0 = Math.max(0, colOf(west)); const i1 = Math.min(W, colOf(east));
const j0 = Math.max(0, rowOf(north)); const j1 = Math.min(H, rowOf(south));
const width = (i1 - i0) * scale; const height = (j1 - j0) * scale;
const px = new Uint8Array(width * height * 3);
const colour = (l) => {
  let h = Math.imul(l, 2654435761) >>> 0;
  const r = 150 + (h & 63); h >>>= 6; const g = 140 + (h & 63); h >>>= 6; const b = 110 + (h & 63);
  return [r, g, b];
};
for (let j = j0; j < j1; j += 1) {
  for (let i = i0; i < i1; i += 1) {
    const c = j * W + i; const l = labels[c];
    let rgb = l ? colour(l) : [70, 100, 140];
    if (l && rivers[c] >= 2) rgb = [60, 110, 190];
    for (let y = 0; y < scale; y += 1) {
      for (let x = 0; x < scale; x += 1) {
        const k = (((j - j0) * scale + y) * width + (i - i0) * scale + x) * 3;
        // Bord de province (à droite ou en bas) en sombre, bord de zone guide en rouge.
        const right = x === scale - 1 && i + 1 < W ? c + 1 : -1;
        const below = y === scale - 1 && j + 1 < H ? c + W : -1;
        let out = rgb;
        for (const n of [right, below]) {
          if (n < 0 || n >= N) continue;
          if (labels[n] !== l && l && labels[n] && out[0] !== 230) out = zones[n] !== zones[c] ? [230, 30, 30] : [40, 35, 30];
        }
        px[k] = out[0]; px[k + 1] = out[1]; px[k + 2] = out[2];
      }
    }
  }
}
writePng(file, width, height, px);
console.log(`${file} : ${width} × ${height}`);
