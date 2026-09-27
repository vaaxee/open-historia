#!/usr/bin/env node
// Carte mondiale (phase 5, étape B) : les tuiles vectorielles de la carte, une
// fois, hors du dépôt : server/data/worldmap/v1/tiles/{z}/{x}/{y}.pbf.
//
//   node --max-old-space-size=12000 scripts/worldmap/tiles.mjs
//
// Deux couches, d'identifiants fixes (pour colorier par « feature-state ») :
//   provinces  polygones, id = numéro de province
//   arcs       limites entre deux provinces, id = numéro d'arc, a et b = les
//              deux provinces, river = 1 le long d'un très grand fleuve
// Une limite devient frontière de pays (ou d'état) quand a et b n'ont pas le
// même propriétaire : le jeu le décide, la géométrie ne change jamais.

import fs from "fs";
import path from "path";
import geojsonvt from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { DATA_DIR } from "../../server/dataDir.js";

export const TILE_MAX_ZOOM = 8;
const OUT = path.join(DATA_DIR, "worldmap", "v1");
const TILES = path.join(OUT, "tiles");
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);

const read = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
log("Lecture…");
const provinces = read("provinces.geojson");
for (const feature of provinces.features) feature.id = feature.properties.id;
const arcs = read("arcs.geojson");
// L'index des limites pour le jeu : [id, a, b, fleuve] (sans géométrie).
fs.writeFileSync(path.join(OUT, "arcs-index.json"), JSON.stringify(arcs.features.map((f) => [f.id, f.properties.a, f.properties.b, f.properties.river])));

const options = { maxZoom: TILE_MAX_ZOOM, indexMaxZoom: 4, indexMaxPoints: 100000, tolerance: 2, extent: 4096, buffer: 64 };
log("Index des provinces…");
const provinceIndex = geojsonvt(provinces, options);
log("Index des limites…");
const arcIndex = geojsonvt(arcs, { ...options, tolerance: 1.5 });

fs.rmSync(TILES, { recursive: true, force: true });
let count = 0; let bytes = 0;
const queue = [[0, 0, 0]];
while (queue.length) {
  const [z, x, y] = queue.shift();
  const p = provinceIndex.getTile(z, x, y);
  const a = arcIndex.getTile(z, x, y);
  if (!p && !a) continue;
  const data = fromGeojsonVt({ provinces: p ?? { features: [] }, arcs: a ?? { features: [] } }, { version: 2, extent: 4096 });
  const file = path.join(TILES, String(z), String(x), `${y}.pbf`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  count += 1; bytes += data.length;
  if (z < TILE_MAX_ZOOM) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) queue.push([z + 1, x * 2 + dx, y * 2 + dy]);
  if (count % 5000 === 0) log(`  ${count} tuiles`);
}
fs.writeFileSync(path.join(OUT, "tiles.json"), JSON.stringify({ minzoom: 0, maxzoom: TILE_MAX_ZOOM, layers: ["provinces", "arcs"], count, bytes }));
log(`${count} tuiles, ${(bytes / 1e6).toFixed(1)} Mo`);
