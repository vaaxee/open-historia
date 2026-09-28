// Phase 7.2 — ce que le ravitaillement sait de chaque état du scénario.
//
//   node scripts/worldmap/supply-states.mjs [scenarioId]
//
// Pour chaque état : son terrain dominant (à la surface, d'après les provinces),
// s'il touche la mer, sa surface, sa population, et les kilomètres de voie ferrée
// qui le traversent (Natural Earth, ne_10m_railroads : le réseau d'AUJOURD'HUI,
// pris comme base de l'infrastructure ; les bacs ferroviaires sont écartés).
// Écrit server/data/worldmap/v1/supply-<scenarioId>.json, lu par le moteur
// (src/runtime/hoi/supply.js). OH_DATA_DIR désigne un autre dossier de données.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";
import { shapefileFromZip } from "./lib/shapefile.mjs";
import { readZip } from "./lib/zip.mjs";
import { railLevel } from "../../src/runtime/hoi/supply.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const DATA = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
const scenarioId = process.argv[2] || "hoi4-states-copy-copy-2";
const V1 = path.join(DATA, "worldmap", "v1");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const meta = readJson(path.join(V1, "meta.json"));
const provinces = readJson(path.join(V1, "provinces.json"));
const provinceList = Array.isArray(provinces) ? provinces : provinces.provinces ?? Object.values(provinces);
const byId = new Map(provinceList.map((entry) => [Number(entry.id), entry]));
const scenario = readJson(path.join(DATA, "scenarios", scenarioId, "provinces.v1.json"));
const stateOfProvince = (id) => scenario.states?.[id - 1] ?? "";

// La trame des provinces à 0,1° (build.mjs) : un identifiant de province par case.
const { width: GW, height: GH, step, latTop } = meta.coarseGrid;
const gridBytes = zlib.gunzipSync(fs.readFileSync(path.join(V1, meta.coarseGrid.file)));
const grid = new Uint16Array(gridBytes.buffer, gridBytes.byteOffset, GW * GH);
const provinceAt = (lng, lat) => {
  const x = Math.floor((lng + 180) / step);
  const y = Math.floor((latTop - lat) / step);
  if (x < 0 || y < 0 || x >= GW || y >= GH) return 0;
  return grid[y * GW + x];
};

const km = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

// Les états : terrain à la surface, côte, surface, population.
const states = {};
for (const [index, stateId] of (scenario.states ?? []).entries()) {
  const province = byId.get(index + 1);
  if (!stateId || !province) continue;
  const state = (states[stateId] ??= { terrains: {}, coastal: false, areaKm2: 0, population: 0, railKm: 0 });
  const area = Number(province.areaKm2) || 0;
  state.terrains[province.terrain] = (state.terrains[province.terrain] ?? 0) + area;
  state.coastal ||= Boolean(province.coastal);
  state.areaKm2 += area;
  state.population += Number(province.population) || 0;
}

// Les voies : chaque tronçon est découpé en pas d'environ 5 km, chaque pas compté
// dans l'état de son milieu.
const lines = shapefileFromZip(readZip(path.join(DATA, "worldmap", "sources", "ne_10m_railroads.zip")));
let counted = 0; let outside = 0;
for (const feature of lines) {
  if (feature?.properties?.featurecla !== "Railroad") continue;
  const geometry = feature.geometry;
  const parts = geometry?.type === "LineString" ? [geometry.coordinates] : geometry?.type === "MultiLineString" ? geometry.coordinates : [];
  for (const part of parts) {
    for (let i = 1; i < part.length; i += 1) {
      const a = part[i - 1]; const b = part[i];
      const length = km(a, b);
      const pieces = Math.max(1, Math.ceil(length / 5));
      for (let p = 0; p < pieces; p += 1) {
        const t = (p + 0.5) / pieces;
        const stateId = stateOfProvince(provinceAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t));
        if (stateId && states[stateId]) { states[stateId].railKm += length / pieces; counted += length / pieces; } else outside += length / pieces;
      }
    }
  }
}

// Les voisinages entre états, d'après ceux des provinces (adjacency.json : terre
// ou fleuve). Un passage où toutes les liaisons franchissent un fleuve est noté
// (le combat, 7.4, en tiendra compte).
const adjacency = readJson(path.join(V1, "adjacency.json"));
const links = {};
for (const [from, list] of Object.entries(adjacency)) {
  const a = stateOfProvince(Number(from));
  if (!a || !states[a]) continue;
  for (const [to, kind] of list) {
    const b = stateOfProvince(Number(to));
    if (!b || b === a || !states[b]) continue;
    const link = ((links[a] ??= {})[b] ??= { land: 0, river: 0 });
    if (kind === "fleuve") link.river += 1; else link.land += 1;
  }
}

const out = {};
for (const [stateId, state] of Object.entries(states)) {
  const terrain = Object.entries(state.terrains).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "plaine";
  const railKm = Math.round(state.railKm);
  out[stateId] = {
    terrain,
    coastal: state.coastal,
    areaKm2: Math.round(state.areaKm2),
    population: Math.round(state.population),
    railKm,
    rail: railLevel(railKm, state.areaKm2),
    neighbours: Object.keys(links[stateId] ?? {}).sort(),
    riverNeighbours: Object.entries(links[stateId] ?? {}).filter(([, link]) => link.river > 0 && link.land === 0).map(([id]) => id).sort(),
  };
}
const file = path.join(V1, `supply-${scenarioId}.json`);
fs.writeFileSync(file, JSON.stringify({ version: 1, scenarioId, generatedAt: new Date().toISOString(), source: "Natural Earth ne_10m_railroads (réseau actuel)", states: out }));
const levels = [0, 0, 0, 0, 0, 0];
for (const state of Object.values(out)) levels[state.rail] += 1;
console.log(`${file}: ${Object.keys(out).length} états, ${Math.round(counted)} km de voies comptés (${Math.round(outside)} km hors des états : mer, lacs)`);
console.log(`niveaux de rail 0→5 : ${levels.join(" / ")}`);
