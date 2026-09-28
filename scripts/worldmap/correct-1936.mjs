#!/usr/bin/env node
// Carte mondiale (phase 5, étape C) : corrige un scénario converti pour qu'il
// suive les frontières du 1er janvier 1936, sans toucher au scénario d'origine.
//
//   node --max-old-space-size=8192 scripts/worldmap/correct-1936.mjs <scenarioId>
//
// Part toujours de la conversion brute (provinces.v1.converted.json, gardée la
// première fois), écrit provinces.v1.json (corrigé) et corrections-1936.json.
//
// Règles, la première qui s'applique :
//   1. compléments 1936 (guides-1936.mjs) : Dantzig ville libre, Tanger zone
//      internationale, Ifni espagnol, Zara et Lagosta italiennes, Touva ;
//   2. Autriche d'aujourd'hui → Autriche ; Tchéquie, Slovaquie et Ruthénie
//      subcarpatique → Tchécoslovaquie (la carte de 1938 est postérieure à
//      l'Anschluss, à Munich, à Teschen et au premier arbitrage de Vienne) ;
//   3. Djibouti → France ; Maroc espagnol de 1914 → Espagne ; sud de Sakhaline
//      japonais ;
//   4. petits pays et cas à part (Islande, Liechtenstein, Monaco, Saint-Marin,
//      Vatican, Malte, Gibraltar, Andorre) : la conversion est gardée ;
//   5. en Europe et en Méditerranée : le pays de la carte de 1938, rapporté au
//      pays du scénario (table HB1938, sinon celui qui couvre au moins 80 % de ce
//      pays de 1938 dans la conversion) ;
//   6. ailleurs : la conversion est gardée.

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { N, cellOf } from "./lib/grid.mjs";
import { PERIOD_ALIASES_1936 } from "./aliases-1936.mjs";
import { CAPITALS_1936 } from "./capitals-1936.mjs";
import { FLAGS_1936 } from "./flags-1936.mjs";
import { GUIDES_1936, GUIDES_1936_ADMIN1 } from "./guides-1936.mjs";

const scenarioId = process.argv[2];
if (!scenarioId) {
  console.error("usage: node scripts/worldmap/correct-1936.mjs <scenarioId>");
  process.exit(1);
}
const WM = path.join(DATA_DIR, "worldmap");
const dir = path.join(DATA_DIR, "scenarios", scenarioId);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const load = (name, Type) => { const b = fs.readFileSync(path.join(WM, "work", `${name}.bin`)); return new Type(b.buffer, b.byteOffset, b.byteLength / Type.BYTES_PER_ELEMENT); };

const rawFile = path.join(dir, "provinces.v1.converted.json");
const outFile = path.join(dir, "provinces.v1.json");
if (!fs.existsSync(rawFile)) fs.copyFileSync(outFile, rawFile);
const raw = readJson(rawFile);
const provinces = readJson(path.join(WM, "v1", "provinces.json"));
const defaultStates = readJson(path.join(WM, "v1", "states-default.json")).states;
const count = provinces.length;

// Les noms des pays de 1938 et 1914, dans l'ordre où la génération les a
// numérotés (build.mjs, guideRaster) ; ceux des compléments 1936.
const namesOf = (file) => {
  const names = [""]; const seen = new Set();
  for (const f of readJson(path.join(WM, "sources", file)).features) {
    const k = f.properties?.NAME;
    if (!k || seen.has(k)) continue;
    seen.add(k); names.push(k);
  }
  return names;
};
const names1938 = namesOf("world_1938.geojson");
const names1914 = namesOf("world_1914.geojson");
const extraNames = ["", ...GUIDES_1936.map((g) => g.name), ...GUIDES_1936_ADMIN1.map((g) => g.name)];

const land = load("land", Uint8Array);
const labels = load("labels", Int32Array);
const eff1938 = load("eff1938", Int32Array);
const eff1914 = load("eff1914", Int32Array);
const extras = load("eff1936x", Int32Array);
const majority = (raster) => {
  const votes = Array.from({ length: count + 1 }, () => new Map());
  for (let c = 0; c < N; c += 1) {
    const l = labels[c];
    if (!land[c] || !l) continue;
    votes[l].set(raster[c], (votes[l].get(raster[c]) ?? 0) + 1);
  }
  return votes.map((m) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
};
const hb1938 = majority(eff1938).map((v) => names1938[v] ?? "");
const hb1914 = majority(eff1914).map((v) => names1914[v] ?? "");
const extra = majority(extras).map((v) => extraNames[v] ?? "");

// Pays de 1938 → pays du scénario (WW2+).
export const HB1938 = {
  Germany: "Germany", Poland: "Poland", Lithuania: "Lithuania", Latvia: "Latvia", Estonia: "Estonia", Finland: "Finland",
  USSR: "Soviet Union", Romania: "Romania", Hungary: "Hungary", Czechoslovakia: "Czechoslovakia", Yugoslavia: "Yugoslavia",
  Bulgaria: "Bulgaria", Greece: "Greece", Albania: "Albania", Italy: "Italy", Switzerland: "Switzerland", France: "France",
  Belgium: "Belgium", Netherlands: "Netherlands", Luxembourg: "Luxembourg", "United Kingdom": "United Kingdom", Ireland: "Ireland",
  Denmark: "Denmark", Norway: "Norway", Sweden: "Sweden", Spain: "Spain", Portugal: "Portugal", Turkey: "Turkey",
  "Syria (France)": "French Syria", "Mandatory Palestine (GB)": "Mandatory Palestine", "Mesopotamia (GB)": "Iraq",
  Egypt: "United Kingdom", Libya: "Italy", "Algeria (France)": "France", Tunisia: "France", "Morocco (France)": "France",
  Iran: "Iran", Hejaz: "Saudi Arabia", "Saudi Arabia": "Saudi Arabia", Hail: "Saudi Arabia", "Emirate of Bin Shal'an": "Saudi Arabia",
};
// Les pays que la correction ajoute : couleur et nom sur la carte, et leur fiche
// pour l'IA (note, alias, étiquette, drapeau), que chaque nouvelle partie sur la
// carte mondiale reçoit (server/libraryStore.js, createGame).
export const NEW_OWNERS = {
  "Free City of Danzig": {
    color: [196, 164, 110],
    label: "Dantzig",
    aliases: ["Danzig", "Free City of Danzig", "Freie Stadt Danzig", "Wolne Miasto Gdańsk", "Gdańsk"],
    tags: ["non-aligned"],
    flag: FLAGS_1936["Free City of Danzig"],
    note: "Semi-autonomous city-state under League of Nations protection since 1920 (Treaty of Versailles), carved out of West Prussia at the mouth of the Vistula. "
      + "About 410,000 inhabitants, overwhelmingly German-speaking. Poland runs its customs, railways and foreign relations and keeps a munitions depot at Westerplatte; "
      + "the port competes with Polish Gdynia next door. Senate President Arthur Greiser (NSDAP, since November 1934), Gauleiter Albert Forster; "
      + "League High Commissioner Seán Lester. The local Nazi party dominates the Senate, harasses the opposition and seeks reunion with Germany.",
  },
  "Tangier International Zone": {
    color: [170, 150, 130],
    label: "Tanger",
    aliases: ["Tangier", "Tangier Zone", "Tanger", "Tánger", "Zone internationale de Tanger"],
    tags: ["non-aligned"],
    flag: FLAGS_1936["Tangier International Zone"],
    note: "International zone at the Strait of Gibraltar, under the 1923 Tangier Statute (revised 1928): nominally under the Sultan of Morocco, represented by a Mendoub, "
      + "but governed by an international Legislative Assembly and a Committee of Control of the consuls of France, Spain, the United Kingdom, Italy, Belgium, the Netherlands, "
      + "Portugal and Sweden. Administrator: Joseph Le Fur (France). About 60,000 inhabitants (Moroccans, Spaniards, Jews, Europeans). "
      + "Demilitarised and neutral, with a gendarmerie; a free port and a hub of trade, banking, smuggling and espionage, coveted by Spain and Italy.",
  },
  Bahrain: {
    color: [196, 60, 70],
    label: "Bahreïn",
    aliases: ["Bahrain", "Bahreïn", "Bahrein", "Baḥrayn"],
    tags: ["british puppet"],
    flag: FLAGS_1936.Bahrain,
    note: "Sheikhdom under British protection (treaties of 1861, 1880 and 1892): the Al Khalifa rule at home, Britain holds its foreign relations and defence. "
      + "Ruler: Sheikh Hamad bin Isa Al Khalifa; British Political Agent in Manama, and Charles Belgrave as the ruler's adviser since 1926. About 90,000 inhabitants. "
      + "Oil struck in 1932 (Bahrain Petroleum Company, an American concession) is replacing the collapsing pearl trade; Persia and Ibn Saud both press claims on the islands.",
  },
};
const EXTRA_ALIASES = {
  Danzig: ["Danzig", "Free City of Danzig"], Tangier: ["Tangier", "Tanger", "Tangier Zone"], Ifni: ["Ifni", "Sidi Ifni"],
  Zara: ["Zara"], Lagosta: ["Lagosta"], Karelia: ["Karelian Isthmus", "Viipuri"], Tuva: ["Tannu Tuva", "Tuva"],
};
// Pays d'aujourd'hui → colonie de 1936 (frontières inchangées).
const WEST_AFRICA_1936 = {
  NGA: "United Kingdom", GHA: "United Kingdom", SLE: "United Kingdom", GMB: "United Kingdom", SHN: "United Kingdom", GNB: "Portugal",
};
// Les autres territoires coloniaux de 1936 dont les anciennes régions du
// scénario étaient mal calées (enquête du 28 septembre 2026). Pays
// d'aujourd'hui → propriétaire de 1936, ou { défaut, régions admin-1 → autre
// propriétaire } quand le pays d'aujourd'hui réunit deux colonies. Des pays du
// scénario, ou ajoutés par la correction (NEW_OWNERS : Bahreïn).
const COLONIES_1936 = {
  // Cameroun français ; la bande ouest (Sud-Ouest, Nord-Ouest) était le Cameroun britannique.
  CMR: { owner: "France", byRegion: { "Sud-Ouest": "United Kingdom", "Nord-Ouest": "United Kingdom" } },
  SOL: "United Kingdom", LSO: "United Kingdom", SWZ: "United Kingdom", MWI: "United Kingdom",
  MUS: "United Kingdom", SYC: "United Kingdom", SGP: "United Kingdom",
  ERI: "Italy",
  SAH: "Spain", GNQ: "Spain",
  CPV: "Portugal", STP: "Portugal",
  COM: "France",
  PNG: "Dominion of Australia",
  // Royaume du Yémen au nord ; le protectorat d'Aden au sud était britannique.
  YEM: { owner: "Yemen", byRegion: { Lahij: "United Kingdom", Abyan: "United Kingdom", "Al Dali'": "United Kingdom", Shabwah: "United Kingdom", Hadramawt: "United Kingdom", "Al Mahrah": "United Kingdom", Aden: "United Kingdom" } },
  OMN: "Oman",
  MMR: "British Raj",
  // Bahreïn, protectorat britannique : un pays ajouté par la correction (NEW_OWNERS).
  BHR: "Bahrain",
};
const colonialOwner = (today, regionName) => {
  const entry = COLONIES_1936[today];
  if (!entry) return "";
  return typeof entry === "string" ? entry : entry.byRegion[regionName] ?? entry.owner;
};
const EXTRA_OWNER = { Danzig: "Free City of Danzig", Tangier: "Tangier International Zone", Ifni: "Spain", Zara: "Italy", Lagosta: "Italy", Karelia: "Finland", Tuva: "Tannu Tuva" };
// Pays d'aujourd'hui dont tout le territoire appartenait en 1936 à un seul pays
// (frontières inchangées, ou pays de 1936 plus grand) : on s'y fie plutôt qu'à la
// carte de 1938, qui comporte des erreurs grossières (Anatolie grecque,
// Transjordanie irakienne…). Hatay, Petsamo… sont traités avant.
export const TODAY_1936 = {
  BEL: "Belgium", NLD: "Netherlands", LUX: "Luxembourg", CHE: "Switzerland", FRA: "France", ESP: "Spain", PRT: "Portugal",
  DNK: "Denmark", SWE: "Sweden", NOR: "Norway", IRL: "Ireland", GBR: "United Kingdom", HUN: "Hungary", ALB: "Albania",
  ITA: "Italy", EST: "Estonia", LVA: "Latvia", ROU: "Romania", DEU: "Germany", FIN: "Finland", TUR: "Turkey",
  SRB: "Yugoslavia", BIH: "Yugoslavia", MNE: "Yugoslavia", MKD: "Yugoslavia", KOS: "Yugoslavia",
  SYR: "French Syria", LBN: "French Syria", JOR: "British Transjordan", ISR: "Mandatory Palestine", PSX: "Mandatory Palestine",
  IRQ: "Iraq", KWT: "British Kuwait", SAU: "Saudi Arabia", IRN: "Iran", EGY: "United Kingdom", LBY: "Italy", TUN: "France", DZA: "France",
  CYP: "United Kingdom", CYN: "United Kingdom",
};
const UKRAINE_1936 = {
  "L'viv": "Poland", "Ivano-Frankivs'k": "Poland", "Ternopil'": "Poland", Volyn: "Poland", Rivne: "Poland",
  Chernivtsi: "Romania", Transcarpathia: "Czechoslovakia",
};
const KEEP_TODAY = new Set(["ISL", "LIE", "MCO", "SMR", "VAT", "MLT", "GIB", "AND"]);
// La frontière finno-soviétique de 1920 dans l'isthme (le long de la Sestra).
const SESTRA = [[29.97, 60.13], [30.12, 60.21], [30.27, 60.32], [30.45, 60.42], [30.7, 60.52], [31.02, 60.62]];
const sestraLatitude = (lng) => {
  if (lng <= SESTRA[0][0]) return SESTRA[0][1];
  for (let i = 1; i < SESTRA.length; i += 1) {
    const [x0, y0] = SESTRA[i - 1]; const [x1, y1] = SESTRA[i];
    if (lng <= x1) return y0 + ((lng - x0) * (y1 - y0)) / (x1 - x0);
  }
  return SESTRA[SESTRA.length - 1][1];
};
const inEuropeMed = ([lng, lat]) => lng >= -25 && lng <= 50 && lat >= 27 && lat <= 72;

// Correspondance automatique : le pays du scénario qui couvre au moins 80 % d'un pays de 1938.
const cover = new Map();
provinces.forEach((p, k) => {
  const h = hb1938[k + 1]; const o = raw.owners[k];
  if (!h || !o) return;
  if (!cover.has(h)) cover.set(h, new Map());
  cover.get(h).set(o, (cover.get(h).get(o) ?? 0) + p.areaKm2);
});
const autoMap = {};
for (const [h, m] of cover) {
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  const [o, a] = [...m].sort((x, y) => y[1] - x[1])[0];
  if (a / total >= 0.8) autoMap[h] = o;
}

const stateName = (k) => defaultStates[provinces[k].state]?.name ?? "";
const owners = raw.owners.slice();
const rules = new Array(count).fill("");
for (let k = 0; k < count; k += 1) {
  const p = provinces[k]; const id = k + 1; const today = p.country;
  let owner = null; let rule = "";
  if (extra[id]) { owner = EXTRA_OWNER[extra[id]]; rule = `complément 1936 (${extra[id]})`; }
  else if (today === "AUT") { owner = "Austria"; rule = "Autriche de 1936"; }
  else if (today === "CZE" || today === "SVK" || /zakarpat|transcarpath/i.test(stateName(k))) { owner = "Czechoslovakia"; rule = "Tchécoslovaquie de 1936"; }
  else if (today === "DJI") { owner = "France"; rule = "Côte française des Somalis"; }
  // Libéria : frontières de 1936 = celles d'aujourd'hui. Les anciennes régions
  // du scénario, mal calées, donnaient Monrovia au Royaume-Uni et le nord
  // (Foya, Gbarnga, Ganta) à la France.
  else if (today === "LBR") { owner = "Liberia"; rule = "Libéria (frontières inchangées depuis 1936)"; }
  // Afrique de l'Ouest britannique et portugaise : même défaut de calage (la
  // moitié du Nigeria, la Sierra Leone, la Gambie, la Guinée-Bissau et une partie
  // du Ghana étaient françaises). Frontières coloniales = frontières
  // d'aujourd'hui ; le Ghana comprend le Togo britannique, le Nigeria le
  // Cameroun septentrional britannique.
  else if (WEST_AFRICA_1936[today]) { owner = WEST_AFRICA_1936[today]; rule = `Afrique de l'Ouest de 1936 (${today})`; }
  else if (colonialOwner(today, stateName(k))) { owner = colonialOwner(today, stateName(k)); rule = `territoire colonial de 1936 (${today})`; }
  else if (today === "MAR" && hb1914[id] === "Spanish Morocco") { owner = "Spain"; rule = "Maroc espagnol"; }
  else if (/sakhalin/i.test(stateName(k)) && hb1938[id] === "Empire of Japan") { owner = "Imperialist Japan"; rule = "Karafuto"; }
  // La carte de 1938 (historical-basemaps) donne la Mazurie à la Pologne : la
  // Prusse-Orientale de 1936 reprend la voïvodie de Varmie-Mazurie, sauf le
  // district de Soldau (Działdowo), polonais depuis 1920.
  else if (today === "POL" && stateName(k) === "Warmian-Masurian") {
    const [lng, lat] = p.center;
    const soldau = lng >= 19.9 && lng <= 20.6 && lat >= 53.1 && lat <= 53.4;
    owner = soldau ? "Poland" : "Germany"; rule = soldau ? "district de Soldau (polonais depuis 1920)" : "Prusse-Orientale de 1936";
  }
  // Isthme de Carélie : au nord de la frontière de la Sestra, finlandais.
  else if (today === "RUS" && stateName(k) === "Leningrad" && p.center[0] < 31.1 && p.center[1] > sestraLatitude(p.center[0])) { owner = "Finland"; rule = "isthme de Carélie finlandais"; }
  // District de Marienwerder (Kwidzyn), à l'est de la Vistule : allemand en 1936
  // (Prusse-Orientale), polonais sur la carte de 1938.
  else if (today === "POL" && p.center[0] >= 18.9 && p.center[0] <= 19.6 && p.center[1] >= 53.6 && p.center[1] <= 54.0 && stateName(k) === "Pomeranian") { owner = "Germany"; rule = "district de Marienwerder"; }
  else if (today === "TUR" && stateName(k) === "Hatay") { owner = "French Syria"; rule = "Sandjak d'Alexandrette (Hatay)"; }
  // Petsamo : la carte de 1938 le donne à la Norvège ; finlandais de 1920 à 1944.
  else if (today === "RUS" && p.center[1] > 68.8 && p.center[0] > 27 && p.center[0] < 32.2) { owner = "Finland"; rule = "Petsamo"; }
  // Ukraine occidentale : les oblasts d'aujourd'hui suivent les frontières de
  // 1936 mieux que la carte de 1938 (qui fait la Pocucie roumaine).
  else if (today === "UKR" && UKRAINE_1936[stateName(k)]) { owner = UKRAINE_1936[stateName(k)]; rule = `oblast de ${stateName(k)} en 1936`; }
  else if (KEEP_TODAY.has(today)) { rule = "cas à part (conversion gardée)"; }
  else if (TODAY_1936[today] && inEuropeMed(p.center)) { owner = TODAY_1936[today]; rule = `frontières inchangées depuis 1936 (${today})`; }
  else if (inEuropeMed(p.center) && hb1938[id]) {
    const mapped = HB1938[hb1938[id]] ?? autoMap[hb1938[id]];
    if (mapped) { owner = mapped; rule = `carte de 1938 (${hb1938[id]})`; }
  }
  if (owner && owner !== owners[k]) { owners[k] = owner; rules[k] = rule; }
  else if (!owner && rule) rules[k] = "";
}

// États : une province qui change de pays quitte son ancien état ; les
// provinces d'un même ancien état passées au même pays en forment un nouveau.
const slug = (s) => s.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/(^-|-$)/g, "").toLowerCase();
const states = raw.states.slice();
const stateInfo = { ...raw.stateInfo };
const stateOwners = { ...(raw.stateOwners ?? {}) };
const groups = new Map();
for (let k = 0; k < count; k += 1) {
  if (owners[k] === raw.owners[k]) continue;
  // Un complément 1936 (Dantzig, Ifni, l'isthme de Carélie…) forme son propre état.
  const key = extra[k + 1] ? `${slug(extra[k + 1])}~${slug(owners[k])}` : `${raw.states[k] || "hors-etat"}~${slug(owners[k])}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(k);
}
// Un morceau fait de parties éloignées (Kwidzyn en Prusse-Orientale et Głogów en
// Silésie, venus d'une même ancienne région) donne un état par partie d'un seul
// tenant (voisinages terrestres) : la plus grande garde le numéro, les autres
// prennent « -2 », « -3 »…
const adjacency = readJson(path.join(WM, "v1", "adjacency.json"));
for (const [key, ks] of [...groups]) {
  const set = new Set(ks); const seen = new Set(); const parts = [];
  for (const start of ks) {
    if (seen.has(start)) continue;
    const part = []; const stack = [start]; seen.add(start);
    while (stack.length) {
      const k = stack.pop(); part.push(k);
      for (const [n] of adjacency[k + 1] ?? []) if (set.has(n - 1) && !seen.has(n - 1)) { seen.add(n - 1); stack.push(n - 1); }
    }
    parts.push(part);
  }
  if (parts.length < 2) continue;
  parts.sort((a, b) => b.length - a.length);
  groups.set(key, parts[0]);
  parts.slice(1).forEach((part, n) => groups.set(`${key}-${n + 2}`, part));
}
for (const [key, ks] of groups) {
  const best = ks.map((k) => provinces[k]).sort((a, b) => (b.population || 0) - (a.population || 0))[0];
  for (const k of ks) states[k] = key;
  stateInfo[key] = { name: best.city || best.name, provinces: ks.length };
  stateOwners[key] = owners[ks[0]];
}
for (const [state, info] of Object.entries(stateInfo)) {
  const n = states.filter((s) => s === state).length;
  if (!n) delete stateInfo[state]; else info.provinces = n;
}
// Les noms des états, après la correction (l'IA les lit : « Province #BBBBBB »
// ne lui dit rien) : la ville la plus peuplée ; sinon la région admin-1
// majoritaire ; sinon la province la plus grande. Uniques : un doublon prend
// sa région admin-1, puis son pays, entre parenthèses.
{
  const members = new Map();
  states.forEach((state, k) => { if (state) { if (!members.has(state)) members.set(state, []); members.get(state).push(k); } });
  const base = new Map(); const admin = new Map();
  for (const [state, ks] of members) {
    const byPopulation = ks.map((k) => provinces[k]).filter((p) => p.city).sort((a, b) => (b.population || 0) - (a.population || 0));
    const votes = new Map();
    for (const k of ks) votes.set(stateName(k), (votes.get(stateName(k)) ?? 0) + provinces[k].areaKm2);
    const region = [...votes].filter(([n]) => n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const largest = ks.map((k) => provinces[k]).sort((a, b) => b.areaKm2 - a.areaKm2)[0];
    admin.set(state, region);
    const extraName = EXTRA_ALIASES[extra[ks[0] + 1]]?.[0];
    base.set(state, byPopulation[0]?.city || extraName || region || largest.name.replace(/ – \d+$/, ""));
  }
  const count = new Map();
  for (const name of base.values()) count.set(name, (count.get(name) ?? 0) + 1);
  const taken = new Set();
  for (const [state, name] of base) {
    let final = name;
    if (count.get(name) > 1 && admin.get(state) && admin.get(state) !== name) final = `${name} (${admin.get(state)})`;
    if (taken.has(final)) final = `${name} (${stateOwners[state] || owners[members.get(state)[0]]})`;
    for (let n = 2; taken.has(final); n += 1) final = `${name} ${n}`;
    taken.add(final);
    // Les autres noms d'un état des compléments 1936 (« Danzig » pour Gdańsk),
    // pour que l'IA le trouve sous le nom de l'époque.
    // …et les noms de 1936 de l'état ou de ses villes (aliases-1936.mjs : Vilnius → Wilno).
    const period = [base.get(state), ...members.get(state).map((k) => provinces[k].city)].filter(Boolean).flatMap((n) => PERIOD_ALIASES_1936[n] ?? []);
    const aliases = [...new Set([...members.get(state).map((k) => EXTRA_ALIASES[extra[k + 1]]).filter(Boolean).flat(), ...period])].filter((n) => n !== final);
    stateInfo[state] = { ...(stateInfo[state] ?? {}), name: final, provinces: members.get(state).length, ...(aliases.length ? { aliases } : {}) };
  }
}


// ---------------------------------------------------------------------------
// Rapport : les points de contrôle, puis toutes les différences en Europe et
// en Méditerranée entre la conversion (WW2+) et le résultat.
// ---------------------------------------------------------------------------
// La province de terre la plus proche d'un point (une ville côtière peut tomber
// sur une case de mer).
const at = (lng, lat) => {
  for (let r = 0; r <= 4; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) for (let dy = -r; dy <= r; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const l = labels[cellOf(lng + dx * 0.05, lat + dy * 0.05)];
      if (l) return l;
    }
  }
  return 0;
};
// Les capitales de 1936 (capitals-1936.mjs) : chacune doit tomber dans un état
// de son pays. Écrites avec leur état, pour que l'IA sache laquelle prendre.
const capitals = {};
const capitalErrors = [];
// La province de la ville elle-même (son nom d'aujourd'hui ou de 1936) chez ce
// pays ; le point seulement à défaut : Kaunas, à 23,90° E, tombait sinon dans la
// province voisine, et la capitale lituanienne dans l'état d'Alytus.
const cityProvince = (polity, city) => {
  const names = new Set([city]);
  for (const [today, period] of Object.entries(PERIOD_ALIASES_1936)) if (today === city || period.includes(city)) { names.add(today); period.forEach((n) => names.add(n)); }
  const hits = provinces.filter((p, k) => !p.empty && owners[k] === polity && names.has(p.city));
  return hits.length ? hits.sort((a, b) => (b.population || 0) - (a.population || 0))[0].id : 0;
};
for (const [polity, [city, lng, lat]] of Object.entries(CAPITALS_1936)) {
  const id = cityProvince(polity, city) || at(lng, lat);
  const owner = id ? owners[id - 1] : "";
  if (owner !== polity) { capitalErrors.push(`${polity} : ${city} tombe chez « ${owner || "(mer)"} »`); continue; }
  capitals[polity] = { city, state: states[id - 1], stateName: stateInfo[states[id - 1]]?.name ?? "", province: id };
}
const polities = new Set(owners.filter(Boolean));
const withoutCapital = [...polities].filter((p) => !capitals[p]).sort();

fs.writeFileSync(outFile, JSON.stringify({
  ...raw, correctedTo: "1936-01-01", correctedAt: new Date().toISOString(), owners, states, stateInfo, stateOwners, newOwners: NEW_OWNERS, capitals,
}));
console.log(`Capitales : ${Object.keys(capitals).length} placées, ${capitalErrors.length} hors de leur pays${capitalErrors.length ? ` (${capitalErrors.join(" ; ")})` : ""}, ${withoutCapital.length} pays sans capitale${withoutCapital.length ? ` (${withoutCapital.join(", ")})` : ""}`);

const CHECKS = [
  ["Allemagne", [["Stettin", 14.55, 53.43, "Germany"], ["Köslin", 16.18, 54.19, "Germany"], ["Breslau", 17.04, 51.11, "Germany"], ["Oppeln", 17.93, 50.67, "Germany"],
    ["Königsberg", 20.5, 54.7, "Germany"], ["Allenstein", 20.48, 53.78, "Germany"], ["Marienwerder", 18.93, 53.73, "Germany"], ["Sarrebruck", 7.0, 49.23, "Germany"], ["Cologne (Rhénanie)", 6.96, 50.94, "Germany"],
    ["Coblence (Rhénanie)", 7.59, 50.36, "Germany"], ["Dantzig", 18.65, 54.35, "Free City of Danzig"], ["Memel", 21.13, 55.7, "Lithuania"]]],
  ["Pologne", [["Varsovie", 21.01, 52.23, "Poland"], ["Gdynia", 18.53, 54.52, "Poland"], ["Posen", 16.93, 52.41, "Poland"], ["Katowice", 19.02, 50.26, "Poland"],
    ["Wilno", 25.28, 54.69, "Poland"], ["Lwów", 24.03, 49.84, "Poland"], ["Stanisławów", 24.71, 48.92, "Poland"], ["Kołomyja", 25.04, 48.53, "Poland"], ["Czernowitz", 25.94, 48.29, "Romania"], ["Tarnopol", 25.59, 49.55, "Poland"]]],
  ["Italie", [["Pola (Istrie)", 13.85, 44.87, "Italy"], ["Trieste", 13.77, 45.65, "Italy"], ["Fiume", 14.44, 45.33, "Italy"], ["Zara", 15.23, 44.12, "Italy"], ["Rhodes", 28.2, 36.4, "Italy"]]],
  ["Finlande", [["Vyborg", 28.75, 60.71, "Finland"], ["Isthme de Carélie (Terijoki)", 29.7, 60.18, "Finland"], ["Kivennapa", 30.1, 60.33, "Finland"], ["Sertolovo (Rautu)", 30.38, 60.65, "Finland"], ["Sestroretsk (URSS)", 29.95, 60.08, "Soviet Union"], ["Petsamo", 31.18, 69.55, "Finland"], ["Île Wrangel (URSS)", -178.9, 71.26, "Soviet Union"], ["Tchoukotka (URSS)", -175.6, 71.37, "Soviet Union"]]],
  ["Maroc, Afrique, Levant", [["Tétouan", -5.37, 35.57, "Spain"], ["Nador", -2.93, 35.17, "Spain"], ["Al Hoceïma (Rif)", -3.93, 35.25, "Spain"], ["Ifni", -10.17, 29.38, "Spain"],
    ["Tanger", -5.8, 35.77, "Tangier International Zone"], ["Djibouti", 43.15, 11.59, "France"], ["Tadjoura", 42.88, 11.79, "France"], ["Antioche (Hatay)", 36.16, 36.2, "French Syria"], ["Amman", 35.93, 31.95, "British Transjordan"],
    ["Aydın (Anatolie)", 27.84, 37.85, "Turkey"], ["Mardin", 40.73, 37.31, "Turkey"], ["Khoy (Iran)", 44.95, 38.55, "Iran"], ["Koweït", 47.98, 29.37, "British Kuwait"]]],
  ["Colonies d'Afrique", [["Yaoundé (Cameroun français)", 11.52, 3.87, "France"], ["Douala (Cameroun français)", 9.7, 4.05, "France"],
    ["Buea (Cameroun britannique)", 9.24, 4.16, "United Kingdom"], ["Bamenda (Cameroun britannique)", 10.15, 5.96, "United Kingdom"],
    ["Hargeisa (Somaliland)", 44.06, 9.56, "United Kingdom"], ["Maseru (Basutoland)", 27.48, -29.31, "United Kingdom"],
    ["Mbabane (Swaziland)", 31.13, -26.32, "United Kingdom"], ["Zomba (Nyassaland)", 35.32, -15.39, "United Kingdom"],
    ["Asmara (Érythrée)", 38.93, 15.33, "Italy"], ["Villa Cisneros (Sahara espagnol)", -15.93, 23.72, "Spain"],
    ["Bata (Guinée espagnole)", 9.77, 1.86, "Spain"], ["Praia (Cap-Vert)", -23.51, 14.93, "Portugal"], ["São Tomé", 6.73, 0.34, "Portugal"],
    ["Moroni (Comores)", 43.26, -11.7, "France"], ["Port-Louis (Maurice)", 57.5, -20.16, "United Kingdom"], ["Victoria (Seychelles)", 55.45, -4.62, "United Kingdom"]]],
  ["Colonies d'Asie et d'Arabie", [["Sanaa (Yémen)", 44.21, 15.35, "Yemen"], ["Aden (protectorat)", 45.03, 12.79, "United Kingdom"], ["Mukalla (Hadramaout)", 49.12, 14.54, "United Kingdom"],
    ["Mascate (Oman)", 58.41, 23.59, "Oman"], ["Nizwa (Oman)", 57.53, 22.93, "Oman"], ["Singapour", 103.85, 1.29, "United Kingdom"],
    ["Port Moresby (Papouasie)", 147.18, -9.44, "Dominion of Australia"], ["Rabaul (Nouvelle-Guinée)", 152.18, -4.2, "Dominion of Australia"],
    ["Lae (Nouvelle-Guinée)", 147.0, -6.72, "Dominion of Australia"], ["Rangoun (Birmanie)", 96.16, 16.8, "British Raj"], ["Mandalay (Birmanie)", 96.08, 21.97, "British Raj"],
    ["Manama (Bahreïn)", 50.58, 26.22, "Bahrain"]]],
  ["Afrique de l'Ouest", [["Monrovia", -10.8, 6.3, "Liberia"], ["Gbarnga", -9.47, 7.0, "Liberia"], ["Harper", -7.72, 4.38, "Liberia"],
    ["Freetown (Sierra Leone)", -13.23, 8.48, "United Kingdom"], ["Lagos (Nigeria)", 3.39, 6.45, "United Kingdom"], ["Kano (Nigeria)", 8.52, 12.0, "United Kingdom"],
    ["Accra (Côte-de-l'Or)", -0.19, 5.6, "United Kingdom"], ["Ho (Togo britannique)", 0.47, 6.6, "United Kingdom"], ["Bathurst (Gambie)", -16.58, 13.45, "United Kingdom"],
    ["Bissau (Guinée portugaise)", -15.6, 11.86, "Portugal"], ["Georgetown (Ascension)", -14.41, -7.93, "United Kingdom"],
    ["Conakry (Guinée)", -13.7, 9.54, "France"], ["Abidjan (Côte d'Ivoire)", -4.03, 5.35, "France"], ["Lomé (Togo français)", 1.22, 6.13, "France"], ["Dakar (Sénégal)", -17.44, 14.69, "France"]]],
  ["Asie", [["Toyohara (sud de Sakhaline)", 142.73, 46.96, "Imperialist Japan"], ["Okha (nord de Sakhaline)", 142.95, 53.57, "Soviet Union"], ["Kyzyl (Touva)", 94.45, 51.72, "Tannu Tuva"]]],
  ["1936 contre 1938", [["Vienne", 16.37, 48.21, "Austria"], ["Innsbruck", 11.4, 47.27, "Austria"], ["Karlsbad (Sudètes)", 12.87, 50.23, "Czechoslovakia"],
    ["Reichenberg (Sudètes)", 15.06, 50.77, "Czechoslovakia"], ["Zaolzie (Karviná)", 18.54, 49.85, "Czechoslovakia"], ["Kassa (Košice)", 21.26, 48.72, "Czechoslovakia"],
    ["Ungvár (Oujhorod)", 22.3, 48.62, "Czechoslovakia"]]],
];
const checks = CHECKS.map(([group, items]) => ({
  group,
  items: items.map(([name, lng, lat, expected]) => {
    const id = at(lng, lat);
    const got = id ? owners[id - 1] : "(mer)";
    return { name, expected, got, ok: got === expected, province: id ? provinces[id - 1].name : "" };
  }),
}));

const differences = new Map();
for (let k = 0; k < count; k += 1) {
  if (owners[k] === raw.owners[k] || !inEuropeMed(provinces[k].center)) continue;
  const key = `${raw.owners[k] || "?"} → ${owners[k]}`;
  if (!differences.has(key)) differences.set(key, { from: raw.owners[k], to: owners[k], km2: 0, provinces: [], rules: new Set() });
  const d = differences.get(key);
  d.km2 += provinces[k].areaKm2; d.provinces.push(provinces[k].name); d.rules.add(rules[k]);
}
const report = {
  scenario: scenarioId,
  checks,
  differences: [...differences.values()].sort((a, b) => b.km2 - a.km2).map((d) => ({ ...d, rules: [...d.rules] })),
  changedOutsideEuropeMed: owners.filter((o, k) => o !== raw.owners[k] && !inEuropeMed(provinces[k].center)).length,
  // Le détail, par règle : une règle qui déborde de sa région se voit ici.
  outsideEuropeMed: Object.entries(owners.reduce((acc, o, k) => {
    if (o === raw.owners[k] || inEuropeMed(provinces[k].center)) return acc;
    const key = `${raw.owners[k] || "?"} → ${o} (${rules[k]})`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {})).map(([change, count]) => ({ change, provinces: count })),
  autoMap,
};
fs.writeFileSync(path.join(dir, "corrections-1936.json"), JSON.stringify(report, null, 2));
const failed = checks.flatMap((g) => g.items.filter((i) => !i.ok).map((i) => `${i.name} : ${i.got} (attendu ${i.expected})`));
console.log(`${owners.filter((o, k) => o !== raw.owners[k]).length} provinces changées, ${report.differences.length} différences en Europe et Méditerranée`);
console.log(`Contrôles : ${checks.reduce((s, g) => s + g.items.length, 0) - failed.length} bons, ${failed.length} faux${failed.length ? ` — ${failed.join(" ; ")}` : ""}`);
