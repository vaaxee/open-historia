#!/usr/bin/env node
// Carte mondiale unique (phase 5, étape A) : génère une fois la carte des
// provinces, commune à tous les scénarios.
//
//   node --max-old-space-size=8192 scripts/worldmap/build.mjs [--from <étape>]
//
// Entrées : server/data/worldmap/sources/ (scripts/worldmap/fetch-sources.mjs)
// et les tuiles d'altitude du zoom 5 (scripts/hoi-fetch-elevation.mjs --zoom 5).
// Sorties : server/data/worldmap/v1/. Les étapes lourdes sont gardées dans
// server/data/worldmap/work/ : --from <étape> refait cette étape et les suivantes.
//
// Étapes :
//   land      terres et mers (Natural Earth 10 m), grands lacs en eau
//   elevation altitude de chaque case (Terrain Tiles, zoom 5)
//   rivers    grands fleuves (Natural Earth), qui freinent la croissance
//   zones     lignes guides : pays de 1200, 1914, 1938 et d'aujourd'hui ; une
//             province ne chevauche jamais deux combinaisons
//   seeds     graines : villes et densité de peuplement, ≈ 13 000 provinces
//   grow      croissance des provinces au moindre coût (relief, fleuves, bruit)
//   shapes    contours : limites intérieures lissées, côtes de Natural Earth
//   attributes terrain, emplacements, noms, voisinages, états par défaut

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { decodePng } from "../../server/hoiElevation.js";
import polygonClipping from "polygon-clipping";
import { readZip } from "./lib/zip.mjs";
import { shapefileFromZip } from "./lib/shapefile.mjs";
import { assemble, smoothArc, toLngLat, traceArcs } from "./lib/vectorize.mjs";
import {
  H, N, STEP, W, cached, cellOf, colOf, fillRings, latOf, linesOf, lngOf, ringsOf, rowOf, traceLine,
} from "./lib/grid.mjs";

export const WORLDMAP_DIR = path.join(DATA_DIR, "worldmap");
export const SOURCES = path.join(WORLDMAP_DIR, "sources");
export const WORK = path.join(WORLDMAP_DIR, "work");
export const OUT = path.join(WORLDMAP_DIR, "v1");

const STAGES = ["land", "elevation", "rivers", "zones", "seeds", "grow", "shapes", "attributes"];
const fromArg = process.argv.indexOf("--from");
const from = fromArg > 0 ? STAGES.indexOf(process.argv[fromArg + 1]) : -1;
if (fromArg > 0 && from < 0) throw new Error(`--from : une de ${STAGES.join(", ")}`);
// Refaire une étape efface son cache et ceux des suivantes.
if (from >= 0) {
  const doomed = {
    land: ["land"], elevation: ["elevation"], rivers: ["rivers"], zones: ["zones"],
    seeds: ["seeds"], grow: ["labels"], shapes: [], attributes: [],
  };
  for (const stage of STAGES.slice(from)) for (const name of doomed[stage]) fs.rmSync(path.join(WORK, `${name}.bin`), { force: true });
}

const ne = (name) => shapefileFromZip(readZip(path.join(SOURCES, `${name}.zip`)));
const readGeojson = (name) => JSON.parse(fs.readFileSync(path.join(SOURCES, name), "utf8")).features;
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);

// Surface approchée d'un anneau en km² (degrés ramenés à la latitude).
const ringKm2 = (ring) => {
  let sum = 0;
  for (let k = 0; k < ring.length - 1; k += 1) {
    const [x0, y0] = ring[k]; const [x1, y1] = ring[k + 1];
    sum += (x0 * y1 - x1 * y0) * Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  }
  return Math.abs(sum / 2) * 111.32 ** 2;
};

// ---------------------------------------------------------------------------
// land : 1 = terre, 0 = eau
// ---------------------------------------------------------------------------
export const LAKE_MIN_KM2 = 3000;
log("Terres et eaux…");
const land = cached(WORK, "land", Uint8Array, () => {
  const out = new Uint8Array(N);
  const tiny = [];
  for (const feature of [...ne("ne_10m_land"), ...ne("ne_10m_minor_islands")]) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      fillRings(out, polygon, 1);
      // Une île plus petite qu'une case n'en remplirait aucune : on garde sa case.
      if (ringKm2(polygon[0]) < 60) tiny.push(polygon[0]);
    }
  }
  for (const ring of tiny) {
    const x = ring.reduce((sum, [lng]) => sum + lng, 0) / ring.length;
    const y = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    const cell = cellOf(x, y);
    if (cell >= 0) out[cell] = 1;
  }
  for (const feature of ne("ne_10m_lakes")) {
    for (const polygon of feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates) {
      if (ringKm2(polygon[0]) >= LAKE_MIN_KM2) fillRings(out, [polygon[0]], 0);
    }
  }
  return out;
});
let landCells = 0; for (let c = 0; c < N; c += 1) landCells += land[c];
log(`  ${landCells} cases de terre sur ${N}`);

// ---------------------------------------------------------------------------
// elevation : mètres, par case (mosaïque des tuiles Terrarium du zoom 5)
// ---------------------------------------------------------------------------
const Z = 5; const TILES = 2 ** Z; const SIZE = 256 * TILES;
log("Altitude…");
const elevation = cached(WORK, "elevation", Int16Array, () => {
  const mosaic = new Int16Array(SIZE * SIZE);
  for (let x = 0; x < TILES; x += 1) {
    for (let y = 0; y < TILES; y += 1) {
      const file = path.join(DATA_DIR, "hoi-elevation", "terrarium", String(Z), String(x), `${y}.png`);
      const { width, pixels, channels } = decodePng(fs.readFileSync(file));
      for (let py = 0; py < 256; py += 1) {
        for (let px = 0; px < 256; px += 1) {
          const k = (py * width + px) * channels;
          const value = pixels[k] * 256 + pixels[k + 1] + pixels[k + 2] / 256 - 32768;
          mosaic[(y * 256 + py) * SIZE + x * 256 + px] = Math.max(-32768, Math.min(32767, Math.round(value)));
        }
      }
    }
  }
  const out = new Int16Array(N);
  for (let j = 0; j < H; j += 1) {
    const rad = (latOf(j) * Math.PI) / 180;
    const py = Math.min(SIZE - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * SIZE)));
    for (let i = 0; i < W; i += 1) {
      const px = Math.min(SIZE - 1, Math.floor(((lngOf(i) + 180) / 360) * SIZE));
      out[j * W + i] = mosaic[py * SIZE + px];
    }
  }
  return out;
});

// ---------------------------------------------------------------------------
// rivers : 0 rien, 1 à 3 selon l'importance du fleuve
// ---------------------------------------------------------------------------
log("Fleuves…");
const rivers = cached(WORK, "rivers", Uint8Array, () => {
  const out = new Uint8Array(N);
  for (const feature of ne("ne_10m_rivers_lake_centerlines")) {
    const rank = Number(feature.properties.scalerank);
    const strength = rank <= 3 ? 3 : rank <= 5 ? 2 : rank <= 6 ? 1 : 0;
    if (!strength) continue;
    for (const line of linesOf(feature.geometry)) {
      traceLine(line, (cell) => { if (land[cell] && out[cell] < strength) out[cell] = strength; });
    }
  }
  return out;
});

// ---------------------------------------------------------------------------
// zones : composantes de terre de même combinaison (pays 1200, 1914, 1938,
// aujourd'hui). Les bandes étroites nées du décalage entre les sources sont
// rendues à leur voisine.
// ---------------------------------------------------------------------------
export const GUIDE_YEARS = [
  // [année, lecture, clé du pays, tracé approximatif (on l'ondule)]
  ["1200", () => readGeojson("world_1200.geojson"), (p) => p.NAME, true],
  ["1914", () => readGeojson("world_1914.geojson"), (p) => p.NAME, true],
  ["1938", () => readGeojson("world_1938.geojson"), (p) => p.NAME, true],
  ["aujourd'hui", () => ne("ne_10m_admin_0_countries"), (p) => p.ADM0_A3, false],
];
// Les frontières historiques sont tracées à grands traits droits : on les fait
// onduler d'environ WARP_CELLS cases (≈ 20 km), l'ordre de grandeur de leur
// imprécision. Celles d'aujourd'hui (Natural Earth) restent exactes.
const WARP_CELLS = 4;
const WARP_SCALE = 12;
const warpHash = (x, y, salt) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const warpNoise = (x, y, salt) => {
  const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
  const a = warpHash(x0, y0, salt); const b = warpHash(x0 + 1, y0, salt); const c = warpHash(x0, y0 + 1, salt); const d = warpHash(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
};
const SLIVER_CORE = 3; // une zone doit faire au moins ≈ 2 × 3 cases de large quelque part

// Remplit les cases de terre sans valeur avec la valeur la plus proche (sur terre).
// Avec same : seulement entre cases de même valeur dans same.
const spreadOverLand = (values, same = null) => {
  let frontier = [];
  for (let c = 0; c < N; c += 1) if (land[c] && values[c]) frontier.push(c);
  while (frontier.length) {
    const next = [];
    for (const c of frontier) {
      const i = c % W;
      for (const n of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n < 0 || n >= N || !land[n] || values[n]) continue;
        if (same && same[n] !== same[c]) continue;
        values[n] = values[c];
        next.push(n);
      }
    }
    frontier = next;
  }
};

// Composantes 4-connexes de terre de même valeur : Int32 (0 = eau).
const components = (values) => {
  const comp = new Int32Array(N);
  let count = 0;
  const stack = new Int32Array(N);
  for (let start = 0; start < N; start += 1) {
    if (!land[start] || comp[start]) continue;
    count += 1;
    let top = 0; stack[top++] = start; comp[start] = count;
    const value = values[start];
    while (top) {
      const c = stack[--top]; const i = c % W;
      for (const n of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n < 0 || n >= N || !land[n] || comp[n] || values[n] !== value) continue;
        comp[n] = count; stack[top++] = n;
      }
    }
  }
  return { comp, count };
};

log("Lignes guides…");
const zones = cached(WORK, "zones", Int32Array, () => {
  const combo = new Float64Array(N);
  let today = null;
  for (const [year, load, keyOf, rough] of GUIDE_YEARS) {
    const ids = new Map();
    let values = new Int32Array(N);
    for (const feature of load()) {
      const key = keyOf(feature.properties ?? {});
      if (!key) continue;
      if (!ids.has(key)) ids.set(key, ids.size + 1);
      const id = ids.get(key);
      const polygons = feature.geometry?.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates : [];
      for (const polygon of polygons) fillRings(values, polygon, id);
    }
    if (rough) {
      const warped = new Int32Array(N);
      for (let j = 0; j < H; j += 1) {
        for (let i = 0; i < W; i += 1) {
          const x = i / WARP_SCALE; const y = j / WARP_SCALE;
          // Deux échelles : ≈ 60 km et ≈ 25 km, pour qu'aucun trait ne reste droit longtemps.
          const di = Math.round(WARP_CELLS * (warpNoise(x, y, 1) * 0.5 + warpNoise(x * 2.4, y * 2.4, 2) * 0.5));
          const dj = Math.round(WARP_CELLS * (warpNoise(x, y, 3) * 0.5 + warpNoise(x * 2.4, y * 2.4, 4) * 0.5));
          const si = Math.min(W - 1, Math.max(0, i + di)); const sj = Math.min(H - 1, Math.max(0, j + dj));
          warped[j * W + i] = values[sj * W + si];
        }
      }
      values = warped;
    }
    for (let c = 0; c < N; c += 1) if (!land[c]) values[c] = 0;
    spreadOverLand(values);
    if (!rough) today = values;
    for (let c = 0; c < N; c += 1) combo[c] = combo[c] * 4096 + values[c];
    log(`  ${year} : ${ids.size} pays`);
  }
  // Les combinaisons en numéros.
  const ids = new Map();
  const zone = new Int32Array(N);
  for (let c = 0; c < N; c += 1) {
    if (!land[c]) continue;
    const key = combo[c];
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    zone[c] = ids.get(key);
  }
  // Distance (en cases, 4-connexe) à la limite de zone la plus proche.
  const depth = new Uint8Array(N);
  let frontier = [];
  for (let c = 0; c < N; c += 1) {
    if (!land[c]) continue;
    const i = c % W;
    for (const n of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (n >= 0 && n < N && land[n] && zone[n] !== zone[c]) { depth[c] = 1; frontier.push(c); break; }
    }
  }
  for (let d = 2; d <= SLIVER_CORE && frontier.length; d += 1) {
    const next = [];
    for (const c of frontier) {
      const i = c % W;
      for (const n of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n < 0 || n >= N || !land[n] || depth[n] || zone[n] !== zone[c]) continue;
        depth[n] = d; next.push(n);
      }
    }
    frontier = next;
  }
  // Une composante sans case profonde est une bande : ses cases prennent la
  // zone voisine (de proche en proche depuis les composantes solides).
  const { comp, count } = components(zone);
  const solid = new Uint8Array(count + 1);
  for (let c = 0; c < N; c += 1) if (land[c] && (depth[c] === 0 || depth[c] >= SLIVER_CORE)) solid[comp[c]] = 1;
  const kept = new Int32Array(N);
  let slivers = 0;
  for (let c = 0; c < N; c += 1) {
    if (!land[c]) continue;
    if (solid[comp[c]]) kept[c] = zone[c]; else slivers += 1;
  }
  // D'abord de proche en proche entre cases du même pays d'aujourd'hui (la
  // frontière exacte l'emporte sur la trace approximative), puis le reste.
  spreadOverLand(kept, today);
  spreadOverLand(kept);
  log(`  ${ids.size} combinaisons, ${count} composantes dont ${count - solid.reduce((s, v) => s + v, 0)} bandes (${slivers} cases rendues)`);
  // Les composantes finales, numérotées.
  return components(kept).comp;
});
let zoneCount = 0; for (let c = 0; c < N; c += 1) zoneCount = Math.max(zoneCount, zones[c]);
log(`  ${zoneCount} zones guides`);


// ---------------------------------------------------------------------------
// seeds : ≈ 13 000 graines, plus serrées là où il y a du monde.
// ---------------------------------------------------------------------------
export const SEED_TUNING = {
  target: 11900, // + graines des zones guides et îlots lointains ≈ 13 000 provinces
  coarse: 5, // cases de travail par case grossière (0,25°)
  base: 0.12, // poids d'une terre vide
  densityRef: 15, // hab./km² (des villes) pour un poids de 1 en plus
  densityExp: 0.6,
  densityCap: 5,
  smoothRadius: 4, // cases grossières
  fixedCityPopulation: 300000, // ces villes gardent leur graine en place
  minZoneCells: 12, // une zone guide plus petite n'a pas sa propre province
  lloydPasses: 2,
};
const T = SEED_TUNING;

export const readCities = () => {
  const zip = readZip(path.join(SOURCES, "cities15000.zip"));
  return zip.read("cities15000.txt").toString("utf8").split("\n").filter(Boolean).map((line) => {
    const f = line.split("\t");
    return { id: Number(f[0]), name: f[1], ascii: f[2], lat: Number(f[4]), lng: Number(f[5]), country: f[8], population: Number(f[14]) || 0 };
  }).filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng));
};

const CW = Math.ceil(W / T.coarse); const CH = Math.ceil(H / T.coarse);
const coarseOf = (cell) => {
  const i = cell % W; const j = (cell - i) / W;
  return Math.floor(j / T.coarse) * CW + Math.floor(i / T.coarse);
};

// Poids de peuplement de chaque case grossière (lissé), puis facteur par case.
const densityFactor = (() => {
  const people = new Float64Array(CW * CH);
  const km2 = new Float64Array(CW * CH);
  for (const city of readCities()) {
    const cell = cellOf(city.lng, city.lat);
    if (cell >= 0) people[coarseOf(cell)] += city.population;
  }
  for (let j = 0; j < H; j += 1) {
    const area = (STEP * 111.32) ** 2 * Math.cos((latOf(j) * Math.PI) / 180);
    for (let i = 0; i < W; i += 1) if (land[j * W + i]) km2[Math.floor(j / T.coarse) * CW + Math.floor(i / T.coarse)] += area;
  }
  const r = T.smoothRadius;
  const factor = new Float32Array(CW * CH);
  for (let cj = 0; cj < CH; cj += 1) {
    for (let ci = 0; ci < CW; ci += 1) {
      if (!km2[cj * CW + ci]) continue;
      let p = 0; let a = 0;
      for (let dj = -r; dj <= r; dj += 1) {
        for (let di = -r; di <= r; di += 1) {
          const y = cj + dj; const x = ci + di;
          if (y < 0 || y >= CH || x < 0 || x >= CW) continue;
          const w = Math.exp(-(di * di + dj * dj) / (r * r));
          p += w * people[y * CW + x]; a += w * km2[y * CW + x];
        }
      }
      const density = a ? p / a : 0;
      factor[cj * CW + ci] = T.base + Math.min(T.densityCap, (density / T.densityRef) ** T.densityExp);
    }
  }
  return factor;
})();

// Ordre de Hilbert des cases grossières : des graines bien réparties.
const hilbert = (x, y, order) => {
  let d = 0;
  for (let s = order / 2; s > 0; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0; const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
  }
  return d;
};
const random = (seed) => { // hasard reproductible
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const zoneCells = new Int32Array(zoneCount + 1);
for (let c = 0; c < N; c += 1) zoneCells[zones[c]] += 1;
const tinyZone = (zone) => zoneCells[zone] < T.minZoneCells;

log("Graines…");
// seeds.bin : [case, fixe (0/1)] × n
const seeds = cached(WORK, "seeds", Int32Array, () => {
  const rand = random(1936);
  // Les villes de chaque case grossière, la plus peuplée d'abord.
  const citiesByCoarse = new Map();
  for (const city of readCities().sort((a, b) => b.population - a.population)) {
    const cell = cellOf(city.lng, city.lat);
    if (cell < 0 || !land[cell]) continue;
    const k = coarseOf(cell);
    if (!citiesByCoarse.has(k)) citiesByCoarse.set(k, []);
    citiesByCoarse.get(k).push({ cell, population: city.population });
  }
  // Poids de chaque case grossière = surface de terre × facteur.
  const weight = new Float64Array(CW * CH);
  const landCellsOf = new Map();
  for (let c = 0; c < N; c += 1) {
    if (!land[c] || tinyZone(zones[c])) continue;
    const k = coarseOf(c); const j = Math.floor(c / W);
    weight[k] += Math.cos((latOf(j) * Math.PI) / 180) * densityFactor[k];
    if (!landCellsOf.has(k)) landCellsOf.set(k, []);
    landCellsOf.get(k).push(c);
  }
  const total = weight.reduce((s, v) => s + v, 0);
  const order = [...landCellsOf.keys()].sort((a, b) => hilbert(a % CW, Math.floor(a / CW), 2048) - hilbert(b % CW, Math.floor(b / CW), 2048));
  const chosen = [];
  const taken = new Set();
  let acc = rand();
  for (const k of order) {
    acc += (T.target * weight[k]) / total;
    while (acc >= 1) {
      acc -= 1;
      const city = (citiesByCoarse.get(k) ?? []).find((entry) => !taken.has(entry.cell) && !tinyZone(zones[entry.cell]));
      const cells = landCellsOf.get(k);
      const cell = city ? city.cell : cells[Math.floor(rand() * cells.length)];
      if (taken.has(cell)) continue;
      taken.add(cell);
      chosen.push([cell, city && city.population >= T.fixedCityPopulation ? 1 : 0]);
    }
  }
  // Chaque zone guide assez grande a au moins une graine.
  const seeded = new Set(chosen.map(([cell]) => zones[cell]));
  const cellsOfZone = new Map();
  for (let c = 0; c < N; c += 1) {
    const z = zones[c];
    if (!z || seeded.has(z) || tinyZone(z)) continue;
    if (!cellsOfZone.has(z)) cellsOfZone.set(z, []);
    cellsOfZone.get(z).push(c);
  }
  for (const cells of cellsOfZone.values()) chosen.push([cells[Math.floor(cells.length / 2)], 0]);
  log(`  ${chosen.length} graines (${cellsOfZone.size} ajoutées pour des zones guides sans graine)`);
  return Int32Array.from(chosen.flat());
});

// ---------------------------------------------------------------------------
// grow : chaque graine s'étend au moindre coût.
// ---------------------------------------------------------------------------
export const GROW_TUNING = {
  noise: 0.75, // amplitude du bruit (bordures irrégulières)
  noiseScale: 6, // cases par maille du bruit (≈ 30 km)
  climbKmPerMeter: 0.025, // monter ou descendre de 400 m ≈ 10 km de plus
  river: [0, 12, 30, 60], // km de plus pour entrer dans un fleuve, selon son rang
};
const G = GROW_TUNING;

const hash2 = (x, y) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const valueNoise = (x, y) => {
  const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0); const b = hash2(x0 + 1, y0); const c = hash2(x0, y0 + 1); const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const noise = new Float32Array(N);
for (let c = 0; c < N; c += 1) {
  if (!land[c]) continue;
  const i = c % W; const j = (c - i) / W;
  const n = valueNoise(i / G.noiseScale, j / G.noiseScale) * 0.5
    + valueNoise(i / (G.noiseScale / 2.5) + 71, j / (G.noiseScale / 2.5) + 13) * 0.3
    + valueNoise(i / 1.5 + 37, j / 1.5 + 91) * 0.2;
  noise[c] = 1 + G.noise * (n * 2 - 1);
}
const kmPerStepY = STEP * 111.32;
const kmPerStepX = new Float32Array(H).map((_, j) => kmPerStepY * Math.cos((latOf(j) * Math.PI) / 180));

// Tas binaire avec clé modifiable.
const heapCells = new Int32Array(N);
const heapPos = new Int32Array(N);
const dist = new Float32Array(N);

const grow = (seedCells) => {
  const label = new Int32Array(N);
  const seedZone = new Int32Array(seedCells.length + 1);
  dist.fill(Infinity); heapPos.fill(-1);
  let size = 0;
  const up = (start) => {
    let k = start;
    const c = heapCells[k]; const d = dist[c];
    while (k > 0) {
      const p = (k - 1) >> 1; const pc = heapCells[p];
      if (dist[pc] <= d) break;
      heapCells[k] = pc; heapPos[pc] = k; k = p;
    }
    heapCells[k] = c; heapPos[c] = k;
  };
  const down = (start) => {
    let k = start;
    const c = heapCells[k]; const d = dist[c];
    for (;;) {
      const l = 2 * k + 1; if (l >= size) break;
      const r = l + 1;
      const m = r < size && dist[heapCells[r]] < dist[heapCells[l]] ? r : l;
      if (dist[heapCells[m]] >= d) break;
      heapCells[k] = heapCells[m]; heapPos[heapCells[k]] = k; k = m;
    }
    heapCells[k] = c; heapPos[c] = k;
  };
  seedCells.forEach((cell, k) => {
    label[cell] = k + 1; seedZone[k + 1] = zones[cell]; dist[cell] = 0;
    heapCells[size] = cell; heapPos[cell] = size; size += 1; up(size - 1);
  });
  while (size) {
    const c = heapCells[0];
    size -= 1; heapPos[c] = -2;
    if (size) { heapCells[0] = heapCells[size]; heapPos[heapCells[0]] = 0; down(0); }
    const own = label[c]; const zone = seedZone[own]; const dc = dist[c];
    const i = c % W; const j = (c - i) / W;
    for (let dj = -1; dj <= 1; dj += 1) {
      const y = j + dj; if (y < 0 || y >= H) continue;
      for (let di = -1; di <= 1; di += 1) {
        if (!di && !dj) continue;
        const x = i + di; if (x < 0 || x >= W) continue;
        const n = y * W + x;
        if (!land[n] || heapPos[n] === -2) continue;
        const nz = zones[n];
        if (nz !== zone && !tinyZone(nz)) continue;
        const dx = (di * (kmPerStepX[j] + kmPerStepX[y])) / 2; const dy = dj * kmPerStepY;
        const step = (Math.sqrt(dx * dx + dy * dy) * (noise[c] + noise[n])) / 2
          + Math.abs(elevation[n] - elevation[c]) * G.climbKmPerMeter
          + (rivers[n] > rivers[c] ? G.river[rivers[n]] : 0);
        const d = dc + step;
        if (d < dist[n]) {
          dist[n] = d; label[n] = own;
          if (heapPos[n] === -1) { heapCells[size] = n; heapPos[n] = size; size += 1; }
          up(heapPos[n]);
        }
      }
    }
  }
  return label;
};

const n4 = (c) => {
  const i = c % W;
  return [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c + W < N ? c + W : -1];
};

// Relaxation (Lloyd) : chaque graine libre va au barycentre pondéré de sa province.
log("Croissance…");
const labels = cached(WORK, "labels", Int32Array, () => {
  const count = seeds.length / 2;
  let cells = Array.from({ length: count }, (_, k) => seeds[2 * k]);
  const fixed = Array.from({ length: count }, (_, k) => seeds[2 * k + 1] === 1);
  let label = null;
  for (let pass = 0; pass <= T.lloydPasses; pass += 1) {
    const started = Date.now();
    label = grow(cells);
    log(`  passe ${pass + 1} : ${((Date.now() - started) / 1000).toFixed(0)} s`);
    if (pass === T.lloydPasses) break;
    const sx = new Float64Array(count + 1); const sy = new Float64Array(count + 1); const sw = new Float64Array(count + 1);
    for (let c = 0; c < N; c += 1) {
      const l = label[c]; if (!l) continue;
      const i = c % W; const j = (c - i) / W;
      const w = densityFactor[coarseOf(c)] * Math.cos((latOf(j) * Math.PI) / 180);
      sx[l] += w * i; sy[l] += w * j; sw[l] += w;
    }
    const best = new Float64Array(count + 1).fill(Infinity);
    const next = cells.slice();
    for (let c = 0; c < N; c += 1) {
      const l = label[c]; if (!l || fixed[l - 1]) continue;
      const i = c % W; const j = (c - i) / W;
      const d = (i - sx[l] / sw[l]) ** 2 + (j - sy[l] / sw[l]) ** 2;
      if (d < best[l]) { best[l] = d; next[l - 1] = c; }
    }
    cells = next;
  }
  // Les terres sans province (îlots, zones minuscules isolées) prennent la
  // province la plus proche à moins de 100 km, par terre ou par mer.
  const REACH = 20;
  const carry = new Int32Array(N); // province portée jusqu'à une case d'eau
  let frontier = [];
  for (let c = 0; c < N; c += 1) if (label[c]) { carry[c] = label[c]; frontier.push(c); }
  for (let d = 1; d <= REACH && frontier.length; d += 1) {
    const next = [];
    for (const c of frontier) {
      for (const n of n4(c)) {
        if (n < 0 || carry[n]) continue;
        carry[n] = carry[c];
        if (land[n]) label[n] = carry[c];
        next.push(n);
      }
    }
    frontier = next;
  }
  // Ce qui reste : des îlots lointains. Chacun devient une province, qui
  // rassemble les îlots à moins de 100 km.
  let extra = 0; let nextLabel = count;
  for (let start = 0; start < N; start += 1) {
    if (!land[start] || label[start]) continue;
    nextLabel += 1; extra += 1;
    label[start] = nextLabel;
    const seen = new Set([start]);
    let wave = [start];
    for (let d = 1; d <= REACH && wave.length; d += 1) {
      const next = [];
      for (const c of wave) {
        for (const n of n4(c)) {
          if (n < 0 || seen.has(n)) continue;
          seen.add(n);
          if (land[n] && !label[n]) label[n] = nextLabel;
          next.push(n);
        }
      }
      wave = next;
    }
  }
  log(`  ${extra} provinces d'îlots lointains`);
  // Filtre majoritaire : une case dont la province est minoritaire autour
  // d'elle (5 voisines sur 8 ou plus d'une autre, de la même zone guide)
  // passe à celle-ci. Enlève les pointes d'une case avant le tracé.
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = 0;
    const next = label.slice();
    for (let c = 0; c < N; c += 1) {
      if (!land[c]) continue;
      const i = c % W; const j = (c - i) / W;
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) continue;
      const counts = new Map();
      for (const n of [c - 1, c + 1, c - W, c + W, c - W - 1, c - W + 1, c + W - 1, c + W + 1]) {
        if (!land[n] || zones[n] !== zones[c]) continue;
        counts.set(label[n], (counts.get(label[n]) ?? 0) + 1);
      }
      for (const [l, count] of counts) {
        if (l !== label[c] && count >= 5) { next[c] = l; changed += 1; break; }
      }
    }
    label.set(next);
    log(`  filtre majoritaire ${pass + 1} : ${changed} cases`);
  }
  return label;
});

let provinceCount = 0; for (let c = 0; c < N; c += 1) provinceCount = Math.max(provinceCount, labels[c]);
log(`  ${provinceCount} provinces`);
export { labels };


// ---------------------------------------------------------------------------
// shapes : les contours. Chaque province déborde de COAST_BUFFER cases en mer,
// ses limites avec ses voisines sont tracées et lissées, puis celles qui
// touchent l'eau sont découpées sur la vraie côte (Natural Earth, par tuiles
// de 1°, grands lacs retirés).
// ---------------------------------------------------------------------------
export const COAST_BUFFER = 3;
const TILE = 1;

// Découpe d'un anneau par un rectangle (Sutherland-Hodgman).
const clipRing = (ring, [x0, y0, x1, y1]) => {
  let points = ring.slice(0, -1);
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cut] of edges) {
    if (!points.length) break;
    const out = [];
    for (let k = 0; k < points.length; k += 1) {
      const a = points[k]; const b = points[(k + 1) % points.length];
      const ia = inside(a); const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    points = out;
  }
  if (points.length < 3) return null;
  points.push(points[0]);
  return points;
};

const tileKey = (tx, ty) => `${tx}:${ty}`;
const landTiles = (() => {
  const tiles = new Map();
  const add = (polygon, sign) => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [x, y] of polygon[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let tx = Math.floor(minX / TILE); tx <= Math.floor(maxX / TILE); tx += 1) {
      for (let ty = Math.floor(minY / TILE); ty <= Math.floor(maxY / TILE); ty += 1) {
        const rect = [tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE];
        const outer = clipRing(polygon[0], rect);
        if (!outer) continue;
        const piece = [outer, ...polygon.slice(1).map((hole) => clipRing(hole, rect)).filter(Boolean)];
        const k = tileKey(tx, ty);
        if (!tiles.has(k)) tiles.set(k, { land: [], lakes: [] });
        tiles.get(k)[sign > 0 ? "land" : "lakes"].push(piece);
      }
    }
  };
  for (const feature of [...ne("ne_10m_land"), ...ne("ne_10m_minor_islands")]) {
    for (const polygon of feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates) add(polygon, 1);
  }
  for (const feature of ne("ne_10m_lakes")) {
    for (const polygon of feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates) {
      if (ringKm2(polygon[0]) >= LAKE_MIN_KM2) add([polygon[0]], -1);
    }
  }
  return tiles;
})();
const clipCache = new Map();
const landIn = (tx, ty) => {
  const k = tileKey(tx, ty);
  if (clipCache.has(k)) return clipCache.get(k);
  const tile = landTiles.get(k);
  let result = [];
  if (tile?.land.length) {
    try {
      result = polygonClipping.union(...tile.land.map((p) => [p]));
      if (tile.lakes.length) result = polygonClipping.difference(result, ...tile.lakes.map((p) => [p]));
    } catch {
      result = tile.land;
    }
  }
  clipCache.set(k, result);
  return result;
};

log("Contours…");
const shapesFile = path.join(OUT, "provinces.geojson");
if (from >= 0 && from <= STAGES.indexOf("shapes")) fs.rmSync(shapesFile, { force: true });
if (!fs.existsSync(shapesFile)) {
  const started = Date.now();
  // La trame étendue en mer.
  const extended = labels.slice();
  let wave = [];
  for (let c = 0; c < N; c += 1) if (labels[c]) wave.push(c);
  for (let d = 1; d <= COAST_BUFFER && wave.length; d += 1) {
    const next = [];
    for (const c of wave) {
      for (const n of n4(c)) {
        if (n < 0 || extended[n]) continue;
        extended[n] = extended[c];
        next.push(n);
      }
    }
    wave = next;
  }
  const coastal = new Uint8Array(provinceCount + 1);
  for (let c = 0; c < N; c += 1) if (extended[c] && !land[c]) coastal[extended[c]] = 1;
  const arcs = traceArcs(extended);
  log(`  ${arcs.length} arcs tracés (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  const pieces = new Map();
  for (const arc of arcs) {
    const points = smoothArc(arc, { tolerance: 0.8, passes: 2 }).map(toLngLat);
    if (arc.left) {
      if (!pieces.has(arc.left)) pieces.set(arc.left, []);
      pieces.get(arc.left).push({ points, closed: arc.closed });
    }
    if (arc.right) {
      if (!pieces.has(arc.right)) pieces.set(arc.right, []);
      pieces.get(arc.right).push({ points: points.slice().reverse(), closed: arc.closed });
    }
  }
  const features = [];
  let broken = 0; let clipFailed = 0; let empty = 0;
  for (let id = 1; id <= provinceCount; id += 1) {
    const own = pieces.get(id);
    if (!own) { empty += 1; continue; }
    const assembled = assemble(own);
    broken += assembled.broken;
    let polygons = assembled.polygons;
    if (coastal[id] && polygons.length) {
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (const polygon of polygons) for (const [x, y] of polygon[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const landPieces = [];
      for (let tx = Math.floor(minX / TILE); tx <= Math.floor(maxX / TILE); tx += 1) {
        for (let ty = Math.floor(minY / TILE); ty <= Math.floor(maxY / TILE); ty += 1) landPieces.push(...landIn(tx, ty));
      }
      try {
        polygons = landPieces.length ? polygonClipping.intersection(polygons, landPieces) : [];
      } catch {
        // Repli : morceau de côte par morceau de côte (des coutures entre tuiles
        // peuvent rester, mais la province ne déborde pas en mer).
        const kept = [];
        for (const piece of landPieces) {
          try { kept.push(...polygonClipping.intersection(polygons, [piece])); } catch { clipFailed += 1; }
        }
        polygons = kept;
      }
    }
    if (!polygons.length) { empty += 1; continue; }
    features.push({
      type: "Feature",
      properties: { id },
      geometry: polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons },
    });
    if (id % 2000 === 0) log(`  ${id} / ${provinceCount}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(shapesFile, JSON.stringify({ type: "FeatureCollection", features }));
  log(`  ${features.length} provinces écrites, ${empty} vides, ${broken} anneaux ouverts, ${clipFailed} découpes ratées (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}

export { land, elevation, rivers, zones };
