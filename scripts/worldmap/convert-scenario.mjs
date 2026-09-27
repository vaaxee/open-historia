#!/usr/bin/env node
// Carte mondiale (phase 5, étape C) : convertit un ancien scénario (régions en
// GeoJSON) vers la carte mondiale. Chaque province prend la région qui couvre
// la plus grande part de sa surface : le propriétaire de cette région (avec les
// changements du scénario) devient le sien, et la région devient son état. Les
// états gardent donc les identifiants des anciennes régions : les changements
// de territoire d'une partie en cours (regionOwnershipOverrides) s'appliquent
// tels quels.
//
//   node --max-old-space-size=8192 scripts/worldmap/convert-scenario.mjs <scenarioId>
//
// Écrit dans le dossier du scénario :
//   provinces.v1.json      { mapVersion, owners[], states[], stateInfo{} }
//                          (owners[k], states[k] : province k + 1)
//   conversion-v1.json     la liste des doutes, à corriger à la main
// La carte mondiale doit être générée (server/data/worldmap/, trame de travail comprise).

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { N, W, cellKm2, fillRings } from "./lib/grid.mjs";

const scenarioId = process.argv[2];
if (!scenarioId) {
  console.error("usage: node scripts/worldmap/convert-scenario.mjs <scenarioId>");
  process.exit(1);
}
const WM = path.join(DATA_DIR, "worldmap");
const scenarioDir = path.join(DATA_DIR, "scenarios", scenarioId);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const load = (name, Type) => { const b = fs.readFileSync(path.join(WM, "work", `${name}.bin`)); return new Type(b.buffer, b.byteOffset, b.byteLength / Type.BYTES_PER_ELEMENT); };
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);

export const OWNER_DOUBT_SHARE = 0.7; // une province dont moins de 70 % va à un seul pays est douteuse

const meta = readJson(path.join(WM, "v1", "meta.json"));
const provinces = readJson(path.join(WM, "v1", "provinces.json"));
const adjacency = readJson(path.join(WM, "v1", "adjacency.json"));
const land = load("land", Uint8Array);
const labels = load("labels", Int32Array);
const count = meta.landProvinces;

log(`Scénario ${scenarioId}…`);
const regions = readJson(path.join(scenarioDir, "regions.geojson")).features
  .filter((f) => !f.properties?.typeId || f.properties.typeId === "land");
const overrides = readJson(path.join(scenarioDir, "world.json")).regionOwnershipOverrides ?? {};
const regionId = (f, k) => String(f.properties?.id ?? f.properties?.GID_1 ?? `region-${k}`);
const ownerOf = (f, k) => String(overrides[regionId(f, k)] ?? f.properties?.owner ?? "").trim();

// Les anciennes régions sur la trame de la carte mondiale.
const raster = new Int32Array(N);
regions.forEach((f, k) => {
  const g = f.geometry;
  for (const polygon of g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : []) fillRings(raster, polygon, k + 1);
});

// Votes par surface : province → région, et province → propriétaire.
const regionVotes = Array.from({ length: count + 1 }, () => new Map());
const ownerVotes = Array.from({ length: count + 1 }, () => new Map());
const total = new Float64Array(count + 1);
const unknown = new Float64Array(count + 1);
const ownerArea = new Map(); // surface de chaque ancien pays (pour repérer ceux qui disparaissent)
for (let c = 0; c < N; c += 1) {
  const l = labels[c];
  if (!land[c] || !l) continue;
  const a = cellKm2(Math.floor(c / W));
  total[l] += a;
  const r = raster[c];
  if (!r) { unknown[l] += a; continue; }
  regionVotes[l].set(r, (regionVotes[l].get(r) ?? 0) + a);
  const owner = ownerOf(regions[r - 1], r - 1);
  ownerVotes[l].set(owner, (ownerVotes[l].get(owner) ?? 0) + a);
  ownerArea.set(owner, (ownerArea.get(owner) ?? 0) + a);
}

const owners = new Array(count).fill("");
const states = new Array(count).fill("");
const doubts = { mixed: [], outside: [], outsideAuto: [], corrected: [], forced: [], missingCountries: [], splitStates: [], emptyStates: [] };
const pct = (v) => Math.round(v * 100);
const describe = (id) => ({ id, name: provinces[id - 1].name, center: provinces[id - 1].center, areaKm2: provinces[id - 1].areaKm2 });

for (let id = 1; id <= count; id += 1) {
  const rv = [...regionVotes[id]].sort((a, b) => b[1] - a[1]);
  const ov = [...ownerVotes[id]].sort((a, b) => b[1] - a[1]);
  if (!rv.length) {
    doubts.outside.push({ ...describe(id), note: "hors de l'ancienne carte" });
    continue;
  }
  // L'état : la région majoritaire parmi celles du propriétaire majoritaire.
  const owner = ov[0][0];
  const [region] = rv.find(([r]) => ownerOf(regions[r - 1], r - 1) === owner) ?? rv[0];
  owners[id - 1] = owner;
  states[id - 1] = regionId(regions[region - 1], region - 1);
  const known = total[id] - unknown[id];
  const share = ov[0][1] / known;
  if (share < OWNER_DOUBT_SHARE) {
    doubts.mixed.push({ ...describe(id), owner, share: pct(share), other: ov[1]?.[0] ?? "", otherShare: pct((ov[1]?.[1] ?? 0) / known) });
  }
  // Une province surtout inconnue de l'ancienne carte (sa côte y est ailleurs) : douteuse si elle est grande.
  if (unknown[id] / total[id] > 0.75 && provinces[id - 1].areaKm2 >= 2000) doubts.outside.push({ ...describe(id), owner, note: `${pct(unknown[id] / total[id])} % hors de l'ancienne carte` });
}

// ---------------------------------------------------------------------------
// Morceaux : l'ancienne carte peut être décalée localement (la Prusse-Orientale
// de WW2+ reste mal calée de quelques dizaines de km). La nouvelle carte, elle,
// ne coupe jamais une frontière de 1938 ni d'aujourd'hui : on regroupe les
// provinces voisines de même pays en 1938 et aujourd'hui, et chaque morceau
// prend le propriétaire qui y tient au moins PIECE_SHARE de la surface. Un
// décalage local se noie ainsi dans le morceau.
// ---------------------------------------------------------------------------
export const PIECE_SHARE = 0.75;
const eff1938 = load("eff1938", Int32Array);
const todayRaster = load("today", Int32Array);
const keyOfProvince = new Array(count + 1).fill("");
{
  const votes = Array.from({ length: count + 1 }, () => new Map());
  for (let c = 0; c < N; c += 1) {
    const l = labels[c];
    if (!land[c] || !l) continue;
    const k = `${eff1938[c]}:${todayRaster[c]}`;
    votes[l].set(k, (votes[l].get(k) ?? 0) + 1);
  }
  for (let id = 1; id <= count; id += 1) keyOfProvince[id] = [...votes[id]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
const pieceOf = new Int32Array(count + 1);
const pieces = [];
for (let start = 1; start <= count; start += 1) {
  if (pieceOf[start] || !owners[start - 1]) continue;
  const members = [start]; pieceOf[start] = pieces.length + 1;
  for (let k = 0; k < members.length; k += 1) {
    for (const [n] of adjacency[members[k]] ?? []) {
      if (pieceOf[n] || !owners[n - 1] || keyOfProvince[n] !== keyOfProvince[start]) continue;
      pieceOf[n] = pieces.length + 1; members.push(n);
    }
  }
  pieces.push(members);
}
doubts.corrected = [];
for (const members of pieces) {
  const votes = new Map(); let sum = 0;
  for (const id of members) for (const [owner, a] of ownerVotes[id]) { votes.set(owner, (votes.get(owner) ?? 0) + a); sum += a; }
  const [owner, a] = [...votes].sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
  if (!owner || a / sum < PIECE_SHARE) continue;
  // L'état d'une province rendue au propriétaire du morceau : sa région de ce
  // propriétaire, sinon l'état le plus fréquent de ce propriétaire dans le morceau.
  const stateVotes = new Map();
  for (const id of members) if (owners[id - 1] === owner) stateVotes.set(states[id - 1], (stateVotes.get(states[id - 1]) ?? 0) + 1);
  const pieceState = [...stateVotes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
  for (const id of members) {
    if (owners[id - 1] === owner) continue;
    const own = [...regionVotes[id]].filter(([r]) => ownerOf(regions[r - 1], r - 1) === owner).sort((x, y) => y[1] - x[1])[0];
    doubts.corrected.push({ ...describe(id), from: owners[id - 1], owner, pieceShare: pct(a / sum) });
    owners[id - 1] = owner;
    states[id - 1] = own ? regionId(regions[own[0] - 1], own[0] - 1) : pieceState;
  }
}
// Les provinces partagées : seulement celles qu'aucun morceau n'a tranchées.
doubts.mixed = doubts.mixed.filter((entry) => owners[entry.id - 1] === entry.owner
  && !doubts.corrected.some((c) => c.id === entry.id)
  && (() => { const members = pieces[pieceOf[entry.id] - 1] ?? [entry.id]; return members.length === 1 || members.some((id) => owners[id - 1] !== entry.owner); })());

// Les provinces hors de l'ancienne carte (îlots, Grand Nord au-delà de la
// carte de HOI4) : le propriétaire et l'état de la province attribuée la plus
// proche. Seules celles de plus de OUTSIDE_DOUBT_KM2 restent dans les doutes.
export const OUTSIDE_DOUBT_KM2 = 2000;
const assigned = [];
for (let id = 1; id <= count; id += 1) if (owners[id - 1]) assigned.push(id);
const km = ([x0, y0], [x1, y1]) => {
  const r = Math.PI / 180;
  const a = Math.sin(((y1 - y0) * r) / 2) ** 2 + Math.cos(y0 * r) * Math.cos(y1 * r) * Math.sin(((x1 - x0) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
};
for (const entry of doubts.outside) {
  if (owners[entry.id - 1]) continue;
  let best = 0; let bestKm = Infinity;
  for (const id of assigned) {
    const d = km(entry.center, provinces[id - 1].center);
    if (d < bestKm) { bestKm = d; best = id; }
  }
  if (!best) continue;
  owners[entry.id - 1] = owners[best - 1]; states[entry.id - 1] = states[best - 1];
  entry.owner = owners[entry.id - 1];
  entry.note += `, rattachée à ${provinces[best - 1].name} (${Math.round(bestKm)} km)`;
  if (entry.areaKm2 < OUTSIDE_DOUBT_KM2) entry.auto = true;
}
doubts.outsideAuto = doubts.outside.filter((entry) => entry.auto);
doubts.outside = doubts.outside.filter((entry) => !entry.auto);

// Un ancien pays sans aucune province (trop petit) reçoit celle où il pèse le
// plus, si ça ne vide pas son propriétaire actuel.
const provincesOf = (owner) => owners.reduce((n, o) => n + (o === owner ? 1 : 0), 0);
for (const [owner, area] of [...ownerArea].sort((a, b) => a[1] - b[1])) {
  if (!owner || provincesOf(owner) > 0) continue;
  let best = 0; let bestShare = 0;
  for (let id = 1; id <= count; id += 1) {
    const v = ownerVotes[id].get(owner);
    if (!v) continue;
    const share = v / total[id];
    if (share > bestShare && provincesOf(owners[id - 1]) > 1) { best = id; bestShare = share; }
  }
  if (!best) { doubts.missingCountries.push({ owner, areaKm2: Math.round(area) }); continue; }
  const previous = owners[best - 1];
  const [region] = [...regionVotes[best]].filter(([r]) => ownerOf(regions[r - 1], r - 1) === owner).sort((a, b) => b[1] - a[1])[0];
  owners[best - 1] = owner;
  states[best - 1] = regionId(regions[region - 1], region - 1);
  doubts.forced.push({ ...describe(best), owner, previous, share: pct(bestShare), areaOfCountryKm2: Math.round(area) });
}

// États : nom (la plus grande ville de leurs provinces), morceaux séparés,
// anciennes régions sans province.
const stateProvinces = new Map();
owners.forEach((owner, k) => {
  if (!states[k]) return;
  if (!stateProvinces.has(states[k])) stateProvinces.set(states[k], []);
  stateProvinces.get(states[k]).push(k + 1);
});
const stateInfo = {};
for (const [state, ids] of stateProvinces) {
  const byPopulation = ids.map((id) => provinces[id - 1]).sort((a, b) => (b.population || 0) - (a.population || 0));
  const region = regions.find((f, k) => regionId(f, k) === state);
  const own = String(region?.properties?.name ?? "").trim();
  const name = own && !/#/.test(own) ? own : (byPopulation[0].city || byPopulation[0].name);
  stateInfo[state] = { name, provinces: ids.length };
  // Morceaux : composantes par voisinage terrestre ; un morceau compte s'il fait
  // au moins 2 000 km² (les îles rattachées ne font pas un état « coupé »).
  const set = new Set(ids); const seen = new Set(); let parts = 0;
  for (const start of ids) {
    if (seen.has(start)) continue;
    let area = 0;
    const stack = [start]; seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      area += provinces[id - 1].areaKm2;
      for (const [n] of adjacency[id] ?? []) if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
    if (area >= 2000) parts += 1;
  }
  if (parts > 1) doubts.splitStates.push({ state, name, parts, provinces: ids.length, owner: owners[ids[0] - 1] });
}
regions.forEach((f, k) => {
  const id = regionId(f, k);
  if (!stateProvinces.has(id)) doubts.emptyStates.push({ state: id, owner: ownerOf(f, k) });
});

// Le propriétaire de chaque état au départ du scénario : une partie ne compte
// comme changement que ce qui en diffère (voir runtime/worldmap/borders.js).
const stateOwners = Object.fromEntries(regions.map((f, k) => [regionId(f, k), ownerOf(f, k)]));
const scenario = { mapVersion: meta.version, scenario: scenarioId, generatedAt: new Date().toISOString(), owners, states, stateInfo, stateOwners };
fs.writeFileSync(path.join(scenarioDir, "provinces.v1.json"), JSON.stringify(scenario));
doubts.mixed.sort((a, b) => a.share - b.share);
fs.writeFileSync(path.join(scenarioDir, "conversion-v1.json"), JSON.stringify({ scenario: scenarioId, threshold: OWNER_DOUBT_SHARE, doubts }, null, 2));
const countries = new Set(owners.filter(Boolean));
log(`${count} provinces, ${countries.size} pays, ${stateProvinces.size} états`);
log(`Morceaux : ${pieces.length}, ${doubts.corrected.length} provinces rendues au propriétaire de leur morceau`);
log(`Doutes : ${doubts.mixed.length} provinces partagées (< ${pct(OWNER_DOUBT_SHARE)} % à un pays), ${doubts.outside.length} hors de l'ancienne carte (+ ${doubts.outsideAuto.length} îlots rattachés d'office), ${doubts.forced.length} données d'office à un petit pays, ${doubts.missingCountries.length} pays sans province, ${doubts.splitStates.length} états en plusieurs morceaux, ${doubts.emptyStates.length} anciennes régions sans province`);
