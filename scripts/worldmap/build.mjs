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
//   rivers    fleuves (Natural Earth) : ils freinent la croissance ; les très
//             grands (BORDER_RIVERS) font frontière
//   guides    lignes guides : frontières d'aujourd'hui, puis de 1938, 1914 et
//             1200 là où elles ne doublent pas une frontière déjà tracée
//   seeds     graines : villes et densité de peuplement, ≈ 13 000 provinces
//   grow      croissance des provinces au moindre coût (relief, fleuves, bruit),
//             puis retouches : îles, archipels, lanières, numéros (lib/refine.mjs)
//   shapes    contours : limites intérieures lissées, côtes de Natural Earth
//   attributes terrain, emplacements, noms, voisinages, états par défaut

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { decodePng } from "../../server/hoiElevation.js";
import { classifyTerrain, provinceSlots } from "../../server/hoiTerrain.js";
import polygonClipping from "polygon-clipping";
import { readZip } from "./lib/zip.mjs";
import { shapefileFromZip } from "./lib/shapefile.mjs";
import { assemble, smoothArc, toLngLat, traceArcs } from "./lib/vectorize.mjs";
import { groupArchipelagos, landComponents, mergeStrips, mergeTiny, renumber, respectHistories, unifySmallIslands } from "./lib/refine.mjs";
import {
  H, N, STEP, W, cached, cellKm2, cellOf, fillRings, latOf, linesOf, lngOf, traceLine,
} from "./lib/grid.mjs";

export const WORLDMAP_DIR = path.join(DATA_DIR, "worldmap");
export const SOURCES = path.join(WORLDMAP_DIR, "sources");
export const WORK = path.join(WORLDMAP_DIR, "work");
export const OUT = path.join(WORLDMAP_DIR, "v1");

const STAGES = ["land", "elevation", "rivers", "guides", "seeds", "grow", "shapes", "attributes"];
const fromArg = process.argv.indexOf("--from");
const from = fromArg > 0 ? STAGES.indexOf(process.argv[fromArg + 1]) : -1;
if (fromArg > 0 && from < 0) throw new Error(`--from : une de ${STAGES.join(", ")}`);
// Refaire une étape efface son cache et ceux des suivantes.
if (from >= 0) {
  const doomed = {
    land: ["land"], elevation: ["elevation"], rivers: ["rivers", "bigriver"], guides: ["walls", "combo", "today", "eff1938", "eff1914", "zones"],
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
// rivers : 0 rien, 1 à 3 selon l'importance du fleuve (ils freinent) ; les
// très grands fleuves (BORDER_RIVERS) sont en plus infranchissables : ils font
// frontière entre provinces.
// ---------------------------------------------------------------------------
export const BORDER_RIVERS = [
  "Rhine", "Danube", "Vistula", "Oder", "Elbe", "Dnieper", "Don", "Volga", "Loire", "Nile", "White Nile", "Tigris",
  "Euphrates", "Mississippi", "St. Lawrence", "Yangtze", "Yellow", "Huang", "Mekong", "Amazon", "Paraná", "Paraná River",
  "Congo", "Niger", "Ganges", "Indus",
];
log("Fleuves…");
const riverFeatures = () => ne("ne_10m_rivers_lake_centerlines");
const rivers = cached(WORK, "rivers", Uint8Array, () => {
  const out = new Uint8Array(N);
  for (const feature of riverFeatures()) {
    const rank = Number(feature.properties.scalerank);
    const strength = rank <= 3 ? 3 : rank <= 5 ? 2 : rank <= 6 ? 1 : 0;
    if (!strength) continue;
    for (const line of linesOf(feature.geometry)) {
      traceLine(line, (cell) => { if (land[cell] && out[cell] < strength) out[cell] = strength; });
    }
  }
  return out;
});
const bigRiver = cached(WORK, "bigriver", Uint8Array, () => {
  const out = new Uint8Array(N);
  const names = new Set(BORDER_RIVERS);
  let count = 0;
  for (const feature of riverFeatures()) {
    const { name_en: en, name } = feature.properties;
    if (!names.has(en) && !names.has(name)) continue;
    count += 1;
    for (const line of linesOf(feature.geometry)) traceLine(line, (cell) => { if (land[cell]) out[cell] = 1; });
  }
  log(`  ${count} tronçons de très grands fleuves`);
  return out;
});

// ---------------------------------------------------------------------------
// guides : des « murs » entre cases. Les frontières d'aujourd'hui en sont
// toujours ; puis celles de 1938, 1914 et 1200, sans les bandes étroites nées
// du décalage entre sources (voir SLIVER_DEPTH), et pour 1200 sans ses traits
// schématiques.
// walls : bit 1 = mur avec la case à l'est, bit 2 = avec la case au sud.
// zones : parties de terre que murs et très grands fleuves séparent.
// combo : la combinaison des quatre pays de la case (pour les îles).
// ---------------------------------------------------------------------------
export const GUIDE_YEARS = [
  // [année, lecture, clé du pays, tracé approximatif (on l'ondule), traits schématiques écartés]
  // — les plus sûres d'abord
  ["aujourd'hui", () => ne("ne_10m_admin_0_countries"), (p) => p.ADM0_A3, false, false],
  ["1938", () => readGeojson("world_1938.geojson"), (p) => p.NAME, true, false],
  ["1914", () => readGeojson("world_1914.geojson"), (p) => p.NAME, true, false],
  ["1200", () => readGeojson("world_1200.geojson"), (p) => p.NAME, true, true],
];
// Les frontières historiques sont tracées à grands traits droits : on les fait
// onduler de WARP_CELLS cases (≈ 25 km), à deux échelles (≈ 60 et ≈ 22 km).
const WARP_CELLS = 5;
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

const n4 = (c) => {
  const i = c % W;
  return [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c + W < N ? c + W : -1];
};

// Remplit les cases de terre sans valeur avec la valeur la plus proche (sur terre).
const spreadOverLand = (values) => {
  let frontier = [];
  for (let c = 0; c < N; c += 1) if (land[c] && values[c]) frontier.push(c);
  while (frontier.length) {
    const next = [];
    for (const c of frontier) {
      for (const n of n4(c)) {
        if (n < 0 || !land[n] || values[n]) continue;
        values[n] = values[c];
        next.push(n);
      }
    }
    frontier = next;
  }
};

// Un tracé historique dessiné d'un seul trait sur plus de CRUDE_SEGMENT_DEG est
// schématique (l'est de l'Europe en 1200, par exemple) : on ne s'en sert pas.
const CRUDE_SEGMENT_DEG = 1.1;
// Les petites îles (≤ 3 000 km²) ne sont pas ondulées : leur pays est sûr.
let smallIslandMask = null;
const smallIslands = () => {
  if (smallIslandMask) return smallIslandMask;
  const { comp, km2 } = landComponents(land);
  smallIslandMask = new Uint8Array(N);
  for (let c = 0; c < N; c += 1) if (land[c] && km2[comp[c]] <= 3000) smallIslandMask[c] = 1;
  return smallIslandMask;
};
const guideRaster = ([, load, keyOf, rough, schematicFilter]) => {
  const smallIsland = smallIslands();
  const ids = new Map();
  let values = new Int32Array(N);
  const crude = new Uint8Array(N);
  for (const feature of load()) {
    const key = keyOf(feature.properties ?? {});
    if (!key) continue;
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    const polygons = feature.geometry?.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates : [];
    for (const polygon of polygons) {
      fillRings(values, polygon, ids.get(key));
      if (!schematicFilter) continue;
      for (const ring of polygon) {
        for (let k = 0; k < ring.length - 1; k += 1) {
          const [x0, y0] = ring[k]; const [x1, y1] = ring[k + 1];
          if (Math.hypot((x1 - x0) * Math.cos((y0 * Math.PI) / 180), y1 - y0) > CRUDE_SEGMENT_DEG) traceLine([ring[k], ring[k + 1]], (cell) => { crude[cell] = 1; });
        }
      }
    }
  }
  // Autour des traits schématiques, de quoi couvrir l'ondulation.
  if (schematicFilter) {
    let frontier = [];
    for (let c = 0; c < N; c += 1) if (crude[c]) frontier.push(c);
    for (let d = 1; d <= WARP_CELLS + 2 && frontier.length; d += 1) {
      const next = [];
      for (const c of frontier) for (const n of n4(c)) if (n >= 0 && !crude[n]) { crude[n] = 1; next.push(n); }
      frontier = next;
    }
  }
  if (rough) {
    const warped = new Int32Array(N);
    for (let j = 0; j < H; j += 1) {
      for (let i = 0; i < W; i += 1) {
        const x = i / WARP_SCALE; const y = j / WARP_SCALE;
        const di = Math.round(WARP_CELLS * (warpNoise(x, y, 1) * 0.55 + warpNoise(x * 2.7, y * 2.7, 2) * 0.45));
        const dj = Math.round(WARP_CELLS * (warpNoise(x, y, 3) * 0.55 + warpNoise(x * 2.7, y * 2.7, 4) * 0.45));
        const si = Math.min(W - 1, Math.max(0, i + di)); const sj = Math.min(H - 1, Math.max(0, j + dj));
        // Une case de terre qui pioche en mer, ou d'une petite île, garde son pays non ondulé.
        const c = j * W + i;
        warped[c] = smallIsland[c] ? values[c] : values[sj * W + si] || values[c];
      }
    }
    values = warped;
  }
  for (let c = 0; c < N; c += 1) if (!land[c]) values[c] = 0;
  spreadOverLand(values);
  return { values, count: ids.size, crude };
};

log("Lignes guides…");
// Un morceau (terre d'un même pays pour l'année, entre les murs déjà tracés)
// dont aucun point n'est à plus de SLIVER_DEPTH cases de son bord, et collé à un
// mur existant sur au moins SLIVER_WALL_SHARE de son bord, est une bande née du
// décalage entre sources : il est rendu à son voisin. Tout autre morceau est
// gardé, avec sa frontière entière jusqu'aux murs qu'elle rejoint (pas de trou).
const SLIVER_DEPTH = 3; // ≈ 15 km : bandes de moins de ≈ 30 km de large
const SLIVER_WALL_SHARE = 0.25;
// Et un morceau de moins de SPECK_CELLS cases (poussière née de l'ondulation)
// est toujours rendu à son voisin.
const SPECK_CELLS = 4;
// Et un morceau de pays A qui déborde d'un mur derrière lequel A se trouve
// (l'Andorre de 1938 qui dépasse de celle d'aujourd'hui) est rendu s'il est
// fin ou plus petit que PROTRUSION_CELLS cases (≈ 1 000 km²).
const PROTRUSION_CELLS = 40;
const EFFECTIVE_YEARS = ["1938", "1914"]; // gardées pour les contrôles (check-guides.mjs)
const guides = (() => {
  const names = ["walls", "combo", "today", ...EFFECTIVE_YEARS.map((y) => `eff${y}`)];
  if (names.every((name) => fs.existsSync(path.join(WORK, `${name}.bin`)))) {
    return { walls: cached(WORK, "walls", Uint8Array), combo: cached(WORK, "combo", Int32Array), today: cached(WORK, "today", Int32Array) };
  }
  const walls = new Uint8Array(N);
  const wallNow = (a, b) => {
    const lo = Math.min(a, b); const hi = Math.max(a, b);
    return (walls[lo] & (hi - lo === 1 ? 1 : 2)) !== 0;
  };
  const comboKey = new Float64Array(N);
  const stack = new Int32Array(N);
  let today = null;
  const saved = [];
  for (const year of GUIDE_YEARS) {
    const [name, , , rough, schematicFilter] = year;
    const { values, count, crude } = guideRaster(year);
    let eff = values;
    let slivers = 0; let sliverCells = 0;
    // Aujourd'hui : seules les poussières (méandres de fleuves frontières) sont rendues.
    {
      // Morceaux : composantes 4-connexes de même pays, sans franchir un mur.
      const piece = new Int32Array(N);
      let pieces = 0;
      for (let start = 0; start < N; start += 1) {
        if (!land[start] || piece[start]) continue;
        pieces += 1;
        let top = 0; stack[top++] = start; piece[start] = pieces;
        while (top) {
          const c = stack[--top];
          for (const n of n4(c)) {
            if (n < 0 || !land[n] || piece[n] || values[n] !== values[c] || wallNow(c, n)) continue;
            piece[n] = pieces; stack[top++] = n;
          }
        }
      }
      // Profondeur (distance au bord du morceau) et part de bord le long d'un mur.
      const depth = new Uint8Array(N);
      const boundary = new Int32Array(pieces + 1); const alongWall = new Int32Array(pieces + 1); const protrudes = new Int32Array(pieces + 1);
      let frontier = [];
      for (let c = 0; c < N; c += 1) {
        if (!land[c]) continue;
        let edge = false;
        for (const n of n4(c)) {
          if (n < 0 || !land[n] || piece[n] === piece[c]) continue;
          edge = true; boundary[piece[c]] += 1;
          if (wallNow(c, n)) { alongWall[piece[c]] += 1; if (values[n] === values[c]) protrudes[piece[c]] += 1; }
        }
        if (edge) { depth[c] = 1; frontier.push(c); }
      }
      for (let d = 2; d <= SLIVER_DEPTH + 1 && frontier.length; d += 1) {
        const next = [];
        for (const c of frontier) {
          for (const n of n4(c)) {
            if (n < 0 || !land[n] || depth[n] || piece[n] !== piece[c]) continue;
            depth[n] = d; next.push(n);
          }
        }
        frontier = next;
      }
      const deep = new Uint8Array(pieces + 1);
      const size = new Int32Array(pieces + 1);
      for (let c = 0; c < N; c += 1) if (land[c]) size[piece[c]] += 1;
      for (let c = 0; c < N; c += 1) if (land[c] && (depth[c] === 0 || depth[c] > SLIVER_DEPTH)) deep[piece[c]] = 1;
      const sliver = (p) => boundary[p] > 0 && (size[p] < SPECK_CELLS || (rough && (
        (!deep[p] && alongWall[p] >= SLIVER_WALL_SHARE * boundary[p])
        || (protrudes[p] > 0 && (!deep[p] || size[p] < PROTRUSION_CELLS)))));
      eff = values.slice();
      for (let p = 1; p <= pieces; p += 1) if (sliver(p)) slivers += 1;
      for (let c = 0; c < N; c += 1) if (land[c] && sliver(piece[c])) { eff[c] = 0; sliverCells += 1; }
      // Les cases des bandes prennent le pays du morceau voisin (sans franchir un mur).
      frontier = [];
      for (let c = 0; c < N; c += 1) if (land[c] && eff[c]) frontier.push(c);
      while (frontier.length) {
        const next = [];
        for (const c of frontier) {
          for (const n of n4(c)) {
            if (n < 0 || !land[n] || eff[n] || wallNow(c, n)) continue;
            eff[n] = eff[c]; next.push(n);
          }
        }
        frontier = next;
      }
      for (let c = 0; c < N; c += 1) if (land[c] && !eff[c]) eff[c] = values[c];
    }
    let kept = 0; let schematic = 0;
    for (let c = 0; c < N; c += 1) {
      if (!land[c]) continue;
      const i = c % W;
      for (const [n, bit] of [[i < W - 1 ? c + 1 : -1, 1], [c + W < N ? c + W : -1, 2]]) {
        if (n < 0 || !land[n] || eff[n] === eff[c] || (walls[c] & bit)) continue;
        if (schematicFilter && (crude[c] || crude[n])) { schematic += 1; continue; }
        walls[c] |= bit; kept += 1;
      }
    }
    for (let c = 0; c < N; c += 1) comboKey[c] = comboKey[c] * 4096 + eff[c];
    if (!rough) today = eff;
    if (EFFECTIVE_YEARS.includes(name)) saved.push([`eff${name}`, eff]);
    log(`  ${name} : ${count} pays, ${kept} arêtes de mur ajoutées, ${slivers} ${rough ? "bandes de décalage" : "poussières"} rendues (${sliverCells} cases)${schematicFilter ? `, ${schematic} schématiques` : ""}`);
  }
  const ids = new Map();
  const combo = new Int32Array(N);
  for (let c = 0; c < N; c += 1) {
    if (!land[c]) continue;
    if (!ids.has(comboKey[c])) ids.set(comboKey[c], ids.size + 1);
    combo[c] = ids.get(comboKey[c]);
  }
  fs.mkdirSync(WORK, { recursive: true });
  for (const [name, array] of [["walls", walls], ["combo", combo], ["today", today], ...saved]) {
    fs.writeFileSync(path.join(WORK, `${name}.bin`), Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return { walls, combo, today };
})();
const { walls, combo, today } = guides;

// Un pas entre deux cases voisines (8-connexes) est-il permis ?
const wallBetween = (a, b) => {
  const lo = Math.min(a, b); const hi = Math.max(a, b);
  if (hi - lo === 1) return (walls[lo] & 1) !== 0;
  return (walls[lo] & 2) !== 0;
};
const passable = (c) => land[c] && !bigRiver[c];
const canStep = (c, n) => {
  const d = n - c;
  if (d === 1 || d === -1 || d === W || d === -W) return !wallBetween(c, n);
  // Diagonale : par l'un des deux chemins en deux pas.
  const i = c % W; const ni = n % W;
  const a = c + (ni - i); const b = n - (ni - i);
  return (passable(a) && !wallBetween(c, a) && !wallBetween(a, n)) || (passable(b) && !wallBetween(c, b) && !wallBetween(b, n));
};
// Limite franchissable pour une fusion : pas de mur, pas de très grand fleuve.
const crossable = (a, b) => !wallBetween(a, b) && !bigRiver[a] && !bigRiver[b];

const zones = cached(WORK, "zones", Int32Array, () => {
  const comp = new Int32Array(N);
  const stack = new Int32Array(N);
  let count = 0;
  for (let start = 0; start < N; start += 1) {
    if (!passable(start) || comp[start]) continue;
    count += 1;
    let top = 0; stack[top++] = start; comp[start] = count;
    while (top) {
      const c = stack[--top];
      for (const n of n4(c)) {
        if (n < 0 || !passable(n) || comp[n] || wallBetween(c, n)) continue;
        comp[n] = count; stack[top++] = n;
      }
    }
  }
  return comp;
});
let zoneCount = 0; for (let c = 0; c < N; c += 1) zoneCount = Math.max(zoneCount, zones[c]);
log(`  ${zoneCount} zones (entre murs et très grands fleuves)`);

// ---------------------------------------------------------------------------
// seeds : ≈ 13 000 graines, plus serrées là où il y a du monde.
// ---------------------------------------------------------------------------
export const SEED_TUNING = {
  target: 11800, // + graines des zones sans graine et îlots lointains, − fusions ≈ 13 100 provinces
  coarse: 5, // cases de travail par case grossière (0,25°)
  base: 0.12, // poids d'une terre vide
  densityRef: 15, // hab./km² (des villes) pour un poids de 1 en plus
  densityExp: 0.6,
  densityCap: 5,
  smoothRadius: 4, // cases grossières
  fixedCityPopulation: 300000, // ces villes gardent leur graine en place
  minZoneCells: 4, // une zone plus petite n'a pas sa propre province (Zara en a une)
  lloydPasses: 2,
};
const T = SEED_TUNING;

// Les villes de GeoNames, sans les quartiers : une « ville » à moins de
// SUBURB_KM d'une ville au moins deux fois plus peuplée (arrondissements de
// Paris, arrondissements de Tokyo…) lui ajoute sa population et disparaît.
const SUBURB_KM = 10;
let citiesCache = null;
export const readCities = () => {
  if (citiesCache) return citiesCache;
  const all = readAllCities().sort((a, b) => b.population - a.population);
  const grid = new Map();
  const kept = [];
  for (const city of all) {
    const gx = Math.floor(city.lng * 5); const gy = Math.floor(city.lat * 5);
    let parent = null;
    for (let dx = -1; dx <= 1 && !parent; dx += 1) for (let dy = -1; dy <= 1 && !parent; dy += 1) {
      for (const other of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
        const km = Math.hypot((other.lng - city.lng) * Math.cos((city.lat * Math.PI) / 180), other.lat - city.lat) * 111.32;
        if (km <= SUBURB_KM && other.population >= 2 * city.population) { parent = other; break; }
      }
    }
    if (parent) { parent.population += city.population; continue; }
    const copy = { ...city };
    kept.push(copy);
    const k = `${gx}:${gy}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(copy);
  }
  citiesCache = kept;
  return kept;
};
const readAllCities = () => {
  const zip = readZip(path.join(SOURCES, "cities15000.zip"));
  return zip.read("cities15000.txt").toString("utf8").split("\n").filter(Boolean).map((line) => {
    const f = line.split("\t");
    return { id: Number(f[0]), name: f[1], ascii: f[2], lat: Number(f[4]), lng: Number(f[5]), code: f[7], country: f[8], population: Number(f[14]) || 0 };
  })
    // Pas les quartiers ni les arrondissements (PPLX : « Paris 15 Vaugirard »).
    .filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng) && city.code !== "PPLX");
};

const CW = Math.ceil(W / T.coarse); const CH = Math.ceil(H / T.coarse);
const coarseOf = (cell) => {
  const i = cell % W; const j = (cell - i) / W;
  return Math.floor(j / T.coarse) * CW + Math.floor(i / T.coarse);
};

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

const hilbert = (x0, y0, order) => {
  let x = x0; let y = y0; let d = 0;
  for (let s = order / 2; s > 0; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0; const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
  }
  return d;
};
const random = (seed) => {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const zoneCells = new Int32Array(zoneCount + 1);
for (let c = 0; c < N; c += 1) zoneCells[zones[c]] += 1;
const tinyZone = (zone) => zoneCells[zone] < T.minZoneCells;

log("Graines…");
const seeds = cached(WORK, "seeds", Int32Array, () => {
  const rand = random(1936);
  const citiesByCoarse = new Map();
  for (const city of readCities().sort((a, b) => b.population - a.population)) {
    const cell = cellOf(city.lng, city.lat);
    if (cell < 0 || !passable(cell)) continue;
    const k = coarseOf(cell);
    if (!citiesByCoarse.has(k)) citiesByCoarse.set(k, []);
    citiesByCoarse.get(k).push({ cell, population: city.population });
  }
  const weight = new Float64Array(CW * CH);
  const landCellsOf = new Map();
  for (let c = 0; c < N; c += 1) {
    if (!passable(c) || tinyZone(zones[c])) continue;
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
  // Chaque zone assez grande a au moins une graine.
  const seeded = new Set(chosen.map(([cell]) => zones[cell]));
  const cellsOfZone = new Map();
  for (let c = 0; c < N; c += 1) {
    const z = zones[c];
    if (!z || seeded.has(z) || tinyZone(z)) continue;
    if (!cellsOfZone.has(z)) cellsOfZone.set(z, []);
    cellsOfZone.get(z).push(c);
  }
  for (const cells of cellsOfZone.values()) chosen.push([cells[Math.floor(cells.length / 2)], 0]);
  log(`  ${chosen.length} graines (${cellsOfZone.size} ajoutées pour des zones sans graine)`);
  return Int32Array.from(chosen.flat());
});

// ---------------------------------------------------------------------------
// grow : chaque graine s'étend au moindre coût ; puis les retouches.
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

const heapCells = new Int32Array(N);
const heapPos = new Int32Array(N);
const dist = new Float32Array(N);

const grow = (seedCells) => {
  const label = new Int32Array(N);
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
    label[cell] = k + 1; dist[cell] = 0;
    heapCells[size] = cell; heapPos[cell] = size; size += 1; up(size - 1);
  });
  while (size) {
    const c = heapCells[0];
    size -= 1; heapPos[c] = -2;
    if (size) { heapCells[0] = heapCells[size]; heapPos[heapCells[0]] = 0; down(0); }
    const own = label[c]; const dc = dist[c];
    const i = c % W; const j = (c - i) / W;
    for (let dj = -1; dj <= 1; dj += 1) {
      const y = j + dj; if (y < 0 || y >= H) continue;
      for (let di = -1; di <= 1; di += 1) {
        if (!di && !dj) continue;
        const x = i + di; if (x < 0 || x >= W) continue;
        const n = y * W + x;
        if (!passable(n) || heapPos[n] === -2 || !canStep(c, n)) continue;
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
  // Les cases sans province (lits des très grands fleuves, poches) : d'abord
  // de proche en proche sur terre, sans franchir un mur ; puis (îlots) la
  // province la plus proche à moins de 100 km, par terre ou par mer.
  // Les poches que les murs de plusieurs années découpent (moins de 4 cases,
  // sans graine) prennent une voisine de même histoire : même pays en 1938,
  // 1914 et aujourd'hui, sinon en 1938 et aujourd'hui.
  const eff1938 = cached(WORK, "eff1938", Int32Array);
  const eff1914 = cached(WORK, "eff1914", Int32Array);
  const stages = [
    (c, n) => !wallBetween(c, n),
    (c, n) => eff1938[c] === eff1938[n] && eff1914[c] === eff1914[n] && today[c] === today[n],
    (c, n) => eff1938[c] === eff1938[n] && today[c] === today[n],
  ];
  for (const allowed of stages) {
    let wave = [];
    for (let c = 0; c < N; c += 1) if (label[c]) wave.push(c);
    while (wave.length) {
      const next = [];
      for (const c of wave) {
        for (const n of n4(c)) {
          if (n < 0 || !land[n] || label[n] || !allowed(c, n)) continue;
          label[n] = label[c]; next.push(n);
        }
      }
      wave = next;
    }
  }
  // Par la mer, un îlot ne rejoint qu'une province de même histoire (même pays
  // en 1938, en 1914 et aujourd'hui) ; sinon il fera sa propre province.
  const REACH = 20;
  const carry = new Int32Array(N);
  const origin = new Int32Array(N).fill(-1);
  let frontier = [];
  for (let c = 0; c < N; c += 1) if (label[c]) { carry[c] = label[c]; origin[c] = c; frontier.push(c); }
  // Un pays inconnu (0 : îlot absent des sources) s'accorde avec tout.
  const same = (x, y) => !x || !y || x === y;
  const sameHistory = (a, b) => same(eff1938[a], eff1938[b]) && same(eff1914[a], eff1914[b]) && same(today[a], today[b]);
  for (let d = 1; d <= REACH && frontier.length; d += 1) {
    const next = [];
    for (const c of frontier) {
      for (const n of n4(c)) {
        if (n < 0 || carry[n]) continue;
        if (land[n] && !label[n] && !sameHistory(n, origin[c])) continue;
        carry[n] = carry[c]; origin[n] = origin[c];
        if (land[n] && !label[n]) label[n] = carry[c];
        next.push(n);
      }
    }
    frontier = next;
  }
  let extra = 0; let nextLabel = count;
  for (let start = 0; start < N; start += 1) {
    if (!land[start] || label[start]) continue;
    nextLabel += 1; extra += 1;
    label[start] = nextLabel;
    const seen = new Set([start]);
    const first = start;
    let wave = [start];
    for (let d = 1; d <= REACH && wave.length; d += 1) {
      const next = [];
      for (const c of wave) {
        for (const n of n4(c)) {
          if (n < 0 || seen.has(n)) continue;
          seen.add(n);
          if (land[n] && !label[n] && sameHistory(n, first)) label[n] = nextLabel;
          next.push(n);
        }
      }
      wave = next;
    }
  }
  log(`  ${extra} provinces d'îlots lointains`);
  // Filtre majoritaire (pas à travers un mur ni un très grand fleuve).
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
      for (const [l, k] of counts) {
        if (l !== label[c] && k >= 5) { next[c] = l; changed += 1; break; }
      }
    }
    label.set(next);
    log(`  filtre majoritaire ${pass + 1} : ${changed} cases`);
  }
  // Retouches : îles, archipels, lanières, numéros.
  const islands = landComponents(land);
  log(`  petites îles réunies : ${unifySmallIslands({ land, labels: label, today: combo, islands })} cases`);
  const archipelagos = groupArchipelagos({ land, labels: label, combo, islands });
  log(`  archipels : ${archipelagos.dust} provinces de poussières d'îles, ${archipelagos.merges} regroupements`);
  log(`  provinces d'une à trois cases fondues : ${mergeTiny({ land, labels: label, islands, histories: [eff1938, today, eff1914] })}`);
  log(`  lanières fondues dans leur voisine : ${mergeStrips({ land, labels: label, crossable, islands })}`);
  const histories = respectHistories({ land, labels: label, histories: [eff1938, eff1914] });
  log(`  cases rendues au pays de leur province (1938, 1914) : ${histories.moved}, petites provinces d'histoire unique : ${histories.created}`);
  log(`  ${renumber({ land, labels: label })} provinces numérotées`);
  return label;
});

let provinceCount = 0; for (let c = 0; c < N; c += 1) provinceCount = Math.max(provinceCount, labels[c]);
log(`  ${provinceCount} provinces`);

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


// ---------------------------------------------------------------------------
// attributes : ce que chaque province porte pour toujours (tous scénarios).
//   provinces.json      [{ id, name, city, terrain, slots, coastal, areaKm2,
//                          population, anchor, center, elevation, state }]
//   adjacency.json      { id: [[voisine, "terre" | "fleuve"]…] }
//   states-default.json découpage mondial par défaut en états (admin-1)
//   meta.json           version, numéros, sources et licences
// ---------------------------------------------------------------------------
export const MAP_VERSION = 1;
export const SEA_ID_RANGE = [20000, 29999]; // réservés aux zones maritimes (plus tard)

log("Attributs…");
{
  const started = Date.now();
  const count = provinceCount;
  const cells = new Float64Array(count + 1); const km2 = new Float64Array(count + 1);
  const sx = new Float64Array(count + 1); const sy = new Float64Array(count + 1);
  const eSum = new Float64Array(count + 1); const eSq = new Float64Array(count + 1); const eMax = new Float64Array(count + 1).fill(-Infinity);
  const coastal = new Uint8Array(count + 1);
  const adjacency = new Map();
  const link = (a, b, kind) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!adjacency.has(x)) adjacency.set(x, new Map());
      const m = adjacency.get(x);
      if (m.get(y) !== "terre") m.set(y, kind); // une limite de terre ferme l'emporte
    }
  };
  for (let c = 0; c < N; c += 1) {
    const l = labels[c];
    if (!land[c] || !l) continue;
    const i = c % W; const j = (c - i) / W;
    const a = cellKm2(j);
    cells[l] += 1; km2[l] += a; sx[l] += lngOf(i) * a; sy[l] += latOf(j) * a;
    const e = Math.max(0, elevation[c]);
    eSum[l] += e; eSq[l] += e * e; eMax[l] = Math.max(eMax[l], e);
    for (const n of n4(c)) {
      if (n < 0) continue;
      if (!land[n]) { coastal[l] = 1; continue; }
      const m = labels[n];
      if (m && m !== l && n > c) link(l, m, bigRiver[c] || bigRiver[n] ? "fleuve" : "terre");
    }
  }
  // Villes : la plus peuplée nomme la province ; toutes comptent dans sa population.
  const population = new Float64Array(count + 1);
  const bestCity = new Array(count + 1).fill(null);
  const cityList = readCities();
  for (const city of cityList) {
    const cell = cellOf(city.lng, city.lat);
    if (cell < 0 || !land[cell] || !labels[cell]) continue;
    const l = labels[cell];
    population[l] += city.population;
    if (!bestCity[l] || city.population > bestCity[l].population) bestCity[l] = city;
  }
  // Point où bâtir sans ville : la case de la province la plus proche de son centre.
  const anchorCell = new Int32Array(count + 1).fill(-1);
  const anchorDist = new Float64Array(count + 1).fill(Infinity);
  for (let c = 0; c < N; c += 1) {
    const l = labels[c];
    if (!land[c] || !l || bestCity[l]) continue;
    const i = c % W; const j = (c - i) / W;
    const d = (lngOf(i) - sx[l] / km2[l]) ** 2 + (latOf(j) - sy[l] / km2[l]) ** 2;
    if (d < anchorDist[l]) { anchorDist[l] = d; anchorCell[l] = c; }
  }
  // États par défaut : la région admin-1 majoritaire (Natural Earth).
  const admin1 = ne("ne_10m_admin_1_states_provinces");
  const admin1Raster = new Int32Array(N);
  admin1.forEach((feature, k) => {
    const g = feature.geometry;
    for (const polygon of g.type === "Polygon" ? [g.coordinates] : g.coordinates) fillRings(admin1Raster, polygon, k + 1);
  });
  const stateVotes = new Map();
  for (let c = 0; c < N; c += 1) {
    const l = labels[c];
    if (!land[c] || !l || !admin1Raster[c]) continue;
    if (!stateVotes.has(l)) stateVotes.set(l, new Map());
    const m = stateVotes.get(l);
    m.set(admin1Raster[c], (m.get(admin1Raster[c]) ?? 0) + 1);
  }
  const stateOf = new Array(count + 1).fill(null);
  const states = {};
  for (const [l, m] of stateVotes) {
    const k = [...m].sort((a, b) => b[1] - a[1])[0][0];
    const p = admin1[k - 1].properties;
    const code = p.adm1_code || `adm1-${k}`;
    stateOf[l] = code;
    if (!states[code]) states[code] = { name: p.name || p.name_en || code, country: p.admin || "", iso: p.iso_a2 || "", provinces: [] };
    states[code].provinces.push(l);
  }
  // Une province sans vote (îlot hors admin-1) : l'état de sa voisine la plus proche.
  for (let l = 1; l <= count; l += 1) {
    if (stateOf[l]) continue;
    const neighbour = [...(adjacency.get(l)?.keys() ?? [])].find((m) => stateOf[m]);
    if (neighbour) { stateOf[l] = stateOf[neighbour]; states[stateOf[l]].provinces.push(l); }
  }
  // Noms : la ville ; sinon la ville la plus proche, « Ville – n », uniques.
  const cellsByCity = cityList.filter((city) => city.population >= 15000);
  const grid = new Map();
  for (const city of cellsByCity) {
    const k = `${Math.floor(city.lng)}:${Math.floor(city.lat)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(city);
  }
  const nearestCity = ([x, y]) => {
    for (let r = 0; r <= 8; r += 1) {
      let best = null; let bestD = Infinity;
      for (let dx = -r; dx <= r; dx += 1) for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const city of grid.get(`${Math.floor(x) + dx}:${Math.floor(y) + dy}`) ?? []) {
          const d = ((city.lng - x) * Math.cos((y * Math.PI) / 180)) ** 2 + (city.lat - y) ** 2;
          if (d < bestD) { bestD = d; best = city; }
        }
      }
      if (best) return best.name;
    }
    return "";
  };
  const round = (v) => Math.round(v * 1e4) / 1e4;
  const provinces = [];
  for (let l = 1; l <= count; l += 1) {
    if (!cells[l]) { provinces.push({ id: l, empty: true }); continue; }
    const center = [round(sx[l] / km2[l]), round(sy[l] / km2[l])];
    const city = bestCity[l];
    const anchor = city ? [round(city.lng), round(city.lat)]
      : anchorCell[l] >= 0 ? [round(lngOf(anchorCell[l] % W)), round(latOf(Math.floor(anchorCell[l] / W)))] : center;
    const mean = eSum[l] / cells[l];
    const elevationStats = { mean: Math.round(mean), relief: Math.round(Math.sqrt(Math.max(0, eSq[l] / cells[l] - mean * mean))), max: Math.round(eMax[l]) };
    const terrain = classifyTerrain({ lng: center[0], lat: center[1], elevation: elevationStats, population: population[l], areaKm2: km2[l], coastal: Boolean(coastal[l]) });
    provinces.push({
      id: l,
      name: city ? city.name : nearestCity(anchor) || states[stateOf[l]]?.name || `Province ${l}`,
      city: city ? city.name : "",
      terrain,
      slots: provinceSlots(terrain, population[l]),
      coastal: Boolean(coastal[l]),
      areaKm2: Math.round(km2[l]),
      population: Math.round(population[l]),
      anchor,
      center,
      elevation: elevationStats.mean,
      state: stateOf[l],
    });
  }
  const cityNames = new Set(provinces.filter((p) => p.city).map((p) => p.name));
  const unnamed = new Map();
  for (const p of provinces) {
    if (p.empty || p.city) continue;
    if (!unnamed.has(p.name)) unnamed.set(p.name, []);
    unnamed.get(p.name).push(p);
  }
  for (const [base, group] of unnamed) {
    if (group.length === 1 && !cityNames.has(base)) continue;
    group.forEach((p, k) => { p.name = `${base} – ${k + 1}`; });
  }
  // Deux provinces du même nom (Paris en France et au Texas) : la plus peuplée
  // garde le nom seul, les autres prennent celui de leur état.
  const byName = new Map();
  for (const p of provinces) if (!p.empty) { if (!byName.has(p.name)) byName.set(p.name, []); byName.get(p.name).push(p); }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.population - a.population).slice(1).forEach((p) => { if (p.state) p.name = `${p.name} (${states[p.state].name})`; });
  }

  const adjacencyOut = {};
  for (const [l, m] of adjacency) adjacencyOut[l] = [...m].sort((a, b) => a[0] - b[0]);
  const terrains = {};
  for (const p of provinces) if (!p.empty) terrains[p.terrain] = (terrains[p.terrain] ?? 0) + 1;
  const meta = {
    version: MAP_VERSION,
    generatedAt: new Date().toISOString(),
    landProvinces: count,
    landIdRange: [1, count],
    seaIdRange: SEA_ID_RANGE,
    states: Object.keys(states).length,
    terrains,
    grid: { step: STEP, latTop: 84, latBottom: -58 },
    tuning: { seeds: SEED_TUNING, grow: GROW_TUNING, borderRivers: BORDER_RIVERS, sliverDepth: SLIVER_DEPTH, sliverWallShare: SLIVER_WALL_SHARE },
    sources: [
      { name: "Natural Earth 10 m (terres, îles, lacs, fleuves, pays, admin-1)", licence: "domaine public", url: "https://www.naturalearthdata.com/" },
      { name: "GeoNames cities15000", licence: "CC BY 4.0", url: "https://www.geonames.org/" },
      { name: "historical-basemaps (1200, 1914, 1938)", licence: "GPL-3.0", url: "https://github.com/aourednik/historical-basemaps" },
      { name: "Terrain Tiles (Terrarium, zoom 5)", licence: "ouverte, attribution Mapzen", url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md" },
    ],
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "provinces.json"), JSON.stringify(provinces));
  fs.writeFileSync(path.join(OUT, "adjacency.json"), JSON.stringify(adjacencyOut));
  fs.writeFileSync(path.join(OUT, "states-default.json"), JSON.stringify({ states, provinceState: Object.fromEntries(provinces.filter((p) => !p.empty).map((p) => [p.id, p.state])) }));
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
  log(`  ${provinces.length} provinces, ${Object.keys(states).length} états par défaut, terrains ${JSON.stringify(terrains)} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}

export { land, elevation, rivers, zones };
