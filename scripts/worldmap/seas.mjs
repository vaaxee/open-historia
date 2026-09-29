// Phase 7.8 — les zones de mer de la carte mondiale.
//
//   node scripts/worldmap/seas.mjs [scenarioId]
//
// La carte réservait les identifiants 20000–29999 aux zones de mer sans en
// dessiner aucune. Ce script les découpe dans la trame des provinces à 0,1°
// (grid-0.1.bin.gz, 0 = pas de terre) :
//   - des graines tous les 6° près des côtes (à moins de 3° d'une terre) et tous
//     les 18° au large, placées sur la mer ;
//   - chaque case de mer rejoint la graine la plus proche PAR LA MER (parcours en
//     largeur à partir de toutes les graines, la longitude bouclant) : une zone
//     ne traverse jamais une terre ;
//   - une zone de moins de 25 cases (un petit lac) est écartée.
// Pour chaque zone : son centre, sa taille, ses zones voisines, et les états du
// scénario dont une province la touche. Écrit
// server/data/worldmap/v1/seas-<scenarioId>.json ; les tuiles et les états ne
// changent pas. OH_DATA_DIR désigne un autre dossier de données.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";
import { seaAt } from "../../src/runtime/worldmap/seaNames.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const DATA = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
const scenarioId = process.argv[2] || "hoi4-states-copy-copy-2";
const V1 = path.join(DATA, "worldmap", "v1");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const SEA_TUNING = Object.freeze({ coastalStep: 60, openStep: 180, coastalReach: 30, minCells: 25, firstId: 20000 });

// Le découpage lui-même, pur : `grid` (Uint16Array, largeur × hauteur, 0 = mer),
// `stateOf(province)` → id d'état. Renvoie { zones, cellZone }.
export const buildSeaZones = ({ grid, width, height, step = 0.1, latTop = 84, stateOf = () => "", tuning = SEA_TUNING }) => {
  const N = width * height;
  const isSea = (i) => grid[i] === 0;
  const neighbours = (i) => {
    const x = i % width; const y = (i - x) / width;
    const out = [y * width + ((x + 1) % width), y * width + ((x - 1 + width) % width)];
    if (y > 0) out.push(i - width);
    if (y < height - 1) out.push(i + width);
    return out;
  };
  // Distance à la terre (en cases, bornée) : les graines côtières.
  const toLand = new Int16Array(N).fill(-1);
  let frontier = [];
  for (let i = 0; i < N; i += 1) if (!isSea(i)) { toLand[i] = 0; frontier.push(i); }
  for (let d = 1; d <= tuning.coastalReach && frontier.length; d += 1) {
    const next = [];
    for (const i of frontier) for (const j of neighbours(i)) if (toLand[j] < 0 && isSea(j)) { toLand[j] = d; next.push(j); }
    frontier = next;
  }
  const seeds = [];
  const seedAt = (x0, y0, size) => {
    // La case de mer la plus proche du centre du carreau.
    let best = -1; let bestD = Infinity;
    const cx = x0 + size / 2; const cy = y0 + size / 2;
    for (let y = y0; y < Math.min(height, y0 + size); y += 2) {
      for (let x = x0; x < Math.min(width, x0 + size); x += 2) {
        const i = y * width + x;
        if (!isSea(i)) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  };
  const coastal = (x0, y0, size) => {
    for (let y = y0; y < Math.min(height, y0 + size); y += 4) {
      for (let x = x0; x < Math.min(width, x0 + size); x += 4) { const i = y * width + x; if (isSea(i) && toLand[i] >= 1) return true; }
    }
    return false;
  };
  for (let y0 = 0; y0 < height; y0 += tuning.openStep) {
    for (let x0 = 0; x0 < width; x0 += tuning.openStep) {
      if (coastal(x0, y0, tuning.openStep)) {
        for (let y1 = y0; y1 < y0 + tuning.openStep; y1 += tuning.coastalStep) {
          for (let x1 = x0; x1 < x0 + tuning.openStep; x1 += tuning.coastalStep) {
            const seed = seedAt(x1, y1, tuning.coastalStep);
            if (seed >= 0) seeds.push(seed);
          }
        }
      } else {
        const seed = seedAt(x0, y0, tuning.openStep);
        if (seed >= 0) seeds.push(seed);
      }
    }
  }
  // Chaque case de mer rejoint la graine la plus proche par la mer.
  const cellZone = new Int32Array(N).fill(-1);
  let wave = [];
  seeds.forEach((seed, index) => { cellZone[seed] = index; wave.push(seed); });
  while (wave.length) {
    const next = [];
    for (const i of wave) for (const j of neighbours(i)) if (cellZone[j] < 0 && isSea(j)) { cellZone[j] = cellZone[i]; next.push(j); }
    wave = next;
  }
  // Les zones : taille, centre, voisines, états côtiers.
  const stats = seeds.map(() => ({ cells: 0, sx: 0, sy: 0, sxs: 0, sxc: 0, neighbours: new Set(), states: new Set() }));
  for (let i = 0; i < N; i += 1) {
    const zone = cellZone[i];
    if (zone < 0) continue;
    const x = i % width; const y = (i - x) / width;
    const s = stats[zone];
    s.cells += 1;
    const lng = -180 + (x + 0.5) * step;
    s.sxs += Math.sin((lng * Math.PI) / 180); s.sxc += Math.cos((lng * Math.PI) / 180);
    s.sy += latTop - (y + 0.5) * step;
    for (const j of neighbours(i)) {
      if (isSea(j)) { if (cellZone[j] >= 0 && cellZone[j] !== zone) s.neighbours.add(cellZone[j]); }
      else { const state = stateOf(grid[j]); if (state) s.states.add(state); }
    }
  }
  const kept = new Map();
  stats.forEach((s, index) => { if (s.cells >= tuning.minCells) kept.set(index, tuning.firstId + kept.size); });
  const zones = {};
  for (const [index, id] of kept) {
    const s = stats[index];
    zones[id] = {
      center: [Math.round((Math.atan2(s.sxs, s.sxc) * 180) / Math.PI * 100) / 100, Math.round((s.sy / s.cells) * 100) / 100],
      cells: s.cells,
      neighbours: [...s.neighbours].filter((n) => kept.has(n)).map((n) => kept.get(n)).sort((a, b) => a - b),
      coastalStates: [...s.states].sort(),
    };
  }
  return { zones, cellZone, kept };
};

// Test G avec Jev : des lacs et des réservoirs (Baïkal, Rybinsk…) passaient pour
// la mer, et les zones portaient le nom d'un état côtier. Chaque zone reçoit le
// nom de sa mer (seaNames.js) ; les zones reliées entre elles forment des
// étendues d'eau ; la plus grande est l'océan mondial, une autre n'est gardée que
// si c'est une mer fermée connue (mer Noire, Caspienne…) assez grande. Le reste
// est marqué `lake` (les identifiants ne changent pas). Pur.
export const classifySeaZones = (zones) => {
  const ids = Object.keys(zones);
  const component = new Map();
  const groups = [];
  for (const id of ids) {
    if (component.has(id)) continue;
    const group = [];
    const stack = [id];
    component.set(id, groups.length);
    while (stack.length) {
      const current = stack.pop();
      group.push(current);
      for (const next of zones[current]?.neighbours ?? []) {
        const key = String(next);
        if (zones[key] && !component.has(key)) { component.set(key, groups.length); stack.push(key); }
      }
    }
    groups.push(group);
  }
  const cellsOf = (group) => group.reduce((sum, id) => sum + (zones[id].cells ?? 0), 0);
  const ocean = groups.reduce((best, group, index) => (cellsOf(group) > cellsOf(groups[best] ?? []) ? index : best), 0);
  const out = {};
  groups.forEach((group, index) => {
    const cells = cellsOf(group);
    // Une étendue séparée est une mer si l'une de ses zones tombe dans une mer
    // fermée connue, et qu'elle en a la taille.
    const enclosed = group.map((id) => seaAt(...zones[id].center)).find((sea) => sea.enclosed && cells >= sea.minCells);
    for (const id of group) {
      const sea = seaAt(...zones[id].center);
      const lake = index !== ocean && !enclosed;
      out[id] = { ...zones[id], name: { fr: sea.fr, en: sea.en }, sea: sea.id, ...(lake ? { lake: true } : {}) };
    }
  });
  return out;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const meta = readJson(path.join(V1, "meta.json"));
  const { width, height, step, latTop } = meta.coarseGrid;
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(V1, meta.coarseGrid.file)));
  const grid = new Uint16Array(bytes.buffer, bytes.byteOffset, width * height);
  const scenario = readJson(path.join(DATA, "scenarios", scenarioId, "provinces.v1.json"));
  const started = Date.now();
  const built = buildSeaZones({ grid, width, height, step, latTop, stateOf: (province) => scenario.states?.[province - 1] ?? "" });
  const zones = classifySeaZones(built.zones);
  const stateSeas = {};
  // Les rives d'un lac ne sont pas des côtes.
  for (const [id, zone] of Object.entries(zones)) if (!zone.lake) for (const state of zone.coastalStates) (stateSeas[state] ??= []).push(Number(id));
  const lakes = Object.values(zones).filter((zone) => zone.lake);
  console.log(`${lakes.length} zones de lacs écartées (${lakes.reduce((sum, zone) => sum + zone.cells, 0)} cases)`);
  // OH_SEAS_OUT : écrire ailleurs (un essai sans toucher aux données servies).
  const file = process.env.OH_SEAS_OUT || path.join(V1, `seas-${scenarioId}.json`);
  fs.writeFileSync(file, JSON.stringify({ version: 1, scenarioId, generatedAt: new Date().toISOString(), tuning: SEA_TUNING, zones, stateSeas }));
  const coastal = Object.values(zones).filter((zone) => zone.coastalStates.length).length;
  console.log(`${file}: ${Object.keys(zones).length} zones de mer (${coastal} côtières), ${Object.keys(stateSeas).length} états côtiers, en ${Date.now() - started} ms`);
}
