#!/usr/bin/env node
// Contrôle : les provinces qui mêlent deux pays d'une année guide.
//
//   node scripts/worldmap/check-guides.mjs <année> [<ouest> <sud> <est> <nord>]
//
// On compare à la frontière réellement tracée pour cette année (ondulée, sans
// les bandes de décalage : work/eff<année>.bin). Une province « mêle » deux pays
// si moins de 100 % de sa surface est dans l'un ; on donne aussi le seuil de
// 85 % et les pays en cause.

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { W, H, colOf, rowOf } from "./lib/grid.mjs";

const WORK = path.join(DATA_DIR, "worldmap", "work");
const load = (n, T) => { const b = fs.readFileSync(path.join(WORK, `${n}.bin`)); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const year = process.argv[2];
const [west, south, east, north] = process.argv.length >= 7 ? process.argv.slice(3, 7).map(Number) : [-180, -58, 180, 84];
const labels = load("labels", Int32Array);
const land = load("land", Uint8Array);
const eff = load(`eff${year}`, Int32Array);

const counts = new Map();
for (let j = Math.max(0, rowOf(north)); j < Math.min(H, rowOf(south)); j += 1) {
  for (let i = Math.max(0, colOf(west)); i < Math.min(W, colOf(east)); i += 1) {
    const c = j * W + i;
    if (!land[c] || !labels[c] || !eff[c]) continue; // 0 : pays inconnu (îlot hors des sources)
    if (!counts.has(labels[c])) counts.set(labels[c], new Map());
    const m = counts.get(labels[c]);
    m.set(eff[c], (m.get(eff[c]) ?? 0) + 1);
  }
}
let strict = 0; let loose = 0; const worst = [];
for (const [l, m] of counts) {
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  const top = Math.max(...m.values());
  if (top < total) { strict += 1; worst.push([l, total - top, total]); }
  if (top / total < 0.85) loose += 1;
}
worst.sort((a, b) => b[1] - a[1]);
console.log(`${year} : ${counts.size} provinces ; ${strict} ont au moins une case d'un autre pays, ${loose} en ont plus de 15 %`);
if (worst.length) console.log(`  les pires (province : cases hors pays / cases) : ${worst.slice(0, 8).map(([l, o, t]) => `${l} : ${o}/${t}`).join(", ")}`);
