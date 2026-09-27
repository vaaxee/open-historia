#!/usr/bin/env node
// Contrôle : part des provinces qui mêlent deux pays d'une année guide
// (trame non ondulée), dans une fenêtre. node scripts/worldmap/check-guides.mjs <ouest> <sud> <est> <nord>
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { N, W, colOf, rowOf, fillRings } from "./lib/grid.mjs";
import { readZip } from "./lib/zip.mjs";
import { shapefileFromZip } from "./lib/shapefile.mjs";

const WM = path.join(DATA_DIR, "worldmap");
const load = (n, T) => { const b = fs.readFileSync(path.join(WM, "work", `${n}.bin`)); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const labels = load("labels", Int32Array);
const [west, south, east, north] = process.argv.slice(2, 6).map(Number);
const years = [
  ["1938", JSON.parse(fs.readFileSync(path.join(WM, "sources", "world_1938.geojson"))).features, (p) => p.NAME],
  ["1914", JSON.parse(fs.readFileSync(path.join(WM, "sources", "world_1914.geojson"))).features, (p) => p.NAME],
  ["aujourd'hui", shapefileFromZip(readZip(path.join(WM, "sources", "ne_10m_admin_0_countries.zip"))), (p) => p.ADM0_A3],
];
for (const [year, features, keyOf] of years) {
  const ids = new Map(); const raster = new Int32Array(N);
  for (const f of features) {
    const k = keyOf(f.properties ?? {}); if (!k || !f.geometry) continue;
    if (!ids.has(k)) ids.set(k, ids.size + 1);
    for (const polygon of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) fillRings(raster, polygon, ids.get(k));
  }
  const counts = new Map();
  for (let j = rowOf(north); j < rowOf(south); j += 1) for (let i = colOf(west); i < colOf(east); i += 1) {
    const c = j * W + i; if (!labels[c] || !raster[c]) continue;
    if (!counts.has(labels[c])) counts.set(labels[c], new Map());
    const m = counts.get(labels[c]); m.set(raster[c], (m.get(raster[c]) ?? 0) + 1);
  }
  let mixed = 0; const names = [...ids.keys()]; const where = [];
  for (const [l, m] of counts) {
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    if (Math.max(...m.values()) / total < 0.85) { mixed += 1; where.push([...m].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => names[k - 1]).join("/")); }
  }
  const tally = new Map(); for (const w of where) tally.set(w, (tally.get(w) ?? 0) + 1);
  if (process.argv.includes("--detail")) console.log([...tally].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ×${v}`).join(", "));
  console.log(`${year} : ${mixed} provinces sur ${counts.size} mêlent deux pays (moins de 85 % dans l'un)`);
}
