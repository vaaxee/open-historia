// Couche HOI4 — moteur déterministe (phase 0).
//
// Run tests: node --test src/runtime/hoi/engine.test.js
// Import-free apart from gameDates.js, so it runs without node_modules.
//
// Principe : l'IA raconte, le moteur compte. Tout ce qui se chiffre (stocks,
// production, pénuries) vit dans world.hoi et n'avance QUE par ces fonctions
// pures, appelées une fois par saut dans applySimulationResult (gameplay.js).
//
// La couche est inerte tant que world.hoi n'existe pas : une partie ordinaire
// d'Open Historia ne voit aucune différence.
//
// Forme de world.hoi :
// {
//   version: 1,
//   lastDate: "1936-01-01",          // date du dernier calcul
//   lastReport: { ... } | null,      // résumé du dernier saut, lu par le prompt (phase 1)
//   nations: {
//     [polity]: {
//       stocks:      { acier: 40, petrole: 20, ... },
//       extraction:  { acier: 12, ... },          // par mois de 30 jours
//       factories:   { civilian: 28, military: 11 },
//       lines: [{
//         id, equipment,
//         factories,                              // usines militaires affectées
//         efficiency,                             // 0.1 → efficiencyCap
//         unitCost,                               // capacité industrielle par unité
//         resources: { acier: 1 },                // par usine et par mois
//         progress,                               // fraction d'unité en cours
//         produced,                               // unités sorties depuis le début
//       }],
//       modifiers: [{ id, target: "production", value: -0.1, untilDate }],
//     }
//   }
// }

import { addGameDays, compareGameDates, diffGameDays } from "../gameDates.js";
import { advanceResearch, emptyResearchReport, normalizeBonuses, normalizeResearch } from "./research.js";
import {
  HOI_BUILDING_TYPES,
  advanceConstruction,
  statusForBuilding,
  sumContributions,
  syncBuildingsWithMarkers,
} from "./buildings.js";

export const HOI_VERSION = 1;

// Réglages d'équilibrage : un seul endroit à modifier.
export const HOI_TUNING = Object.freeze({
  daysPerMonth: 30,
  // Capacité industrielle produite par une usine militaire en un jour.
  capacityPerFactoryPerDay: 1,
  efficiencyFloor: 0.1,
  efficiencyCap: 0.9,
  // Part de l'écart au plafond comblée chaque jour de production.
  efficiencyGrowthPerDay: 0.01,
  // Bornes d'un modificateur, quelle que soit sa source (IA comprise).
  modifierMin: -0.5,
  modifierMax: 0.5,
  // Un saut plus long est calculé en tranches, pour que les pénuries et
  // l'efficacité évoluent en cours de route plutôt qu'en un seul bloc.
  maxStepDays: 30,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Création / normalisation
// ---------------------------------------------------------------------------

export const createNation = ({
  stocks = {},
  extraction = {},
  factories = {},
  lines = [],
  modifiers = [],
} = {}) => normalizeNation({ stocks, extraction, factories, lines, modifiers });

export const normalizeLine = (line, index = 0) => {
  if (!isObject(line)) return null;
  return {
    id: String(line.id || `line-${index + 1}`),
    equipment: String(line.equipment || "équipement"),
    factories: Math.max(0, Math.floor(num(line.factories))),
    // Borne absolue ici ; le plafond propre à la nation (techs comprises) est
    // appliqué par advanceNation.
    efficiency: clamp(num(line.efficiency, HOI_TUNING.efficiencyFloor), HOI_TUNING.efficiencyFloor, 0.99),
    unitCost: Math.max(0.01, num(line.unitCost, 1)),
    resources: Object.fromEntries(
      Object.entries(isObject(line.resources) ? line.resources : {})
        .map(([key, value]) => [key, Math.max(0, num(value))])
        .filter(([, value]) => value > 0),
    ),
    progress: Math.max(0, num(line.progress)),
    produced: Math.max(0, Math.floor(num(line.produced))),
  };
};

export const normalizeModifier = (modifier, index = 0) => {
  if (!isObject(modifier)) return null;
  const value = clamp(num(modifier.value), HOI_TUNING.modifierMin, HOI_TUNING.modifierMax);
  if (!value) return null;
  return {
    id: String(modifier.id || `mod-${index + 1}`),
    // Phase 0 : un seul type de cible. D'autres (recherche, stabilité) viendront.
    target: "production",
    value,
    untilDate: modifier.untilDate ? String(modifier.untilDate) : null,
    label: modifier.label ? String(modifier.label) : "",
  };
};

export const normalizeNation = (nation) => {
  const source = isObject(nation) ? nation : {};
  const cleanMap = (map) => Object.fromEntries(
    Object.entries(isObject(map) ? map : {}).map(([key, value]) => [key, Math.max(0, num(value))]),
  );
  return {
    stocks: cleanMap(source.stocks),
    extraction: cleanMap(source.extraction),
    factories: {
      civilian: Math.max(0, Math.floor(num(source.factories?.civilian))),
      military: Math.max(0, Math.floor(num(source.factories?.military))),
    },
    lines: (Array.isArray(source.lines) ? source.lines : []).map(normalizeLine).filter(Boolean),
    modifiers: (Array.isArray(source.modifiers) ? source.modifiers : []).map(normalizeModifier).filter(Boolean),
    // Phase 2 : ce que les technologies ont acquis (research.js).
    bonuses: normalizeBonuses(source.bonuses),
    research: normalizeResearch(source.research),
    // Phase 3 : la file de chantiers, dans l'ordre (identifiants de structures).
    constructionQueue: [...new Set((Array.isArray(source.constructionQueue) ? source.constructionQueue : [])
      .map((id) => String(id ?? "").trim()).filter(Boolean))],
    // Ce que ses bâtiments lui apportent, relevé par le moteur à chaque saut et à
    // l'installation (buildings.js) : lu par economyOps, la recherche et les panneaux.
    buildingBonus: normalizeBuildingBonus(source.buildingBonus),
  };
};

const normalizeBuildingBonus = (value) => ({
  civilian: round2(Math.max(0, num(value?.civilian))),
  military: round2(Math.max(0, num(value?.military))),
  extraction: Object.fromEntries(
    Object.entries(isObject(value?.extraction) ? value.extraction : {})
      .map(([key, amount]) => [key, round2(Math.max(0, num(amount)))])
      .filter(([, amount]) => amount > 0),
  ),
});

// Les usines d'une nation, bâtiments compris (phase 3).
export const effectiveFactories = (nation, bonus = nation?.buildingBonus) => ({
  civilian: round2(num(nation?.factories?.civilian) + num(bonus?.civilian)),
  military: round2(num(nation?.factories?.military) + num(bonus?.military)),
});

// Plafond d'efficacité d'une nation : le réglage commun, plus ses techs.
export const nationEfficiencyCap = (nation) =>
  clamp(HOI_TUNING.efficiencyCap + num(nation?.bonuses?.efficiencyCap), HOI_TUNING.efficiencyFloor, 0.99);

// Active la couche sur une partie : world.hoi est créé avec les nations fournies.
// `series` : la série de valeurs de départ utilisée (presets.js), pour l'affichage.
export const enableHoiLayer = (world, { startDate, nations = {}, series = null } = {}) => ({
  ...(isObject(world) ? world : {}),
  hoi: {
    version: HOI_VERSION,
    lastDate: startDate ? String(startDate) : null,
    lastReport: null,
    series: series ? String(series) : null,
    nations: Object.fromEntries(Object.entries(nations).map(([key, value]) => [key, normalizeNation(value)])),
  },
});

// La clé de world.hoi.nations qui désigne `polity`, sans tenir compte de la casse
// ni des espaces autour : l'IA écrit « germany » ou « Germany » pour la même nation.
export const findNationKey = (hoi, polity) => {
  const nations = isObject(hoi?.nations) ? hoi.nations : {};
  const wanted = String(polity ?? "").trim();
  if (!wanted) return null;
  if (Object.prototype.hasOwnProperty.call(nations, wanted)) return wanted;
  const lower = wanted.toLowerCase();
  return Object.keys(nations).find((key) => key.toLowerCase() === lower) ?? null;
};

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

// Modificateur de production total d'une nation à une date donnée.
export const productionModifier = (nation, date) => {
  const active = nation.modifiers.filter((modifier) => (
    modifier.target === "production"
    && (!modifier.untilDate || !date || compareGameDates(date, modifier.untilDate) < 0)
  ));
  const total = active.reduce((sum, modifier) => sum + modifier.value, 0);
  return clamp(total, HOI_TUNING.modifierMin, HOI_TUNING.modifierMax);
};

// Avance une nation de `days` jours. Pur : renvoie une nouvelle nation et un rapport.
// `bonus` : ce que ses bâtiments apportent (usines, extraction), phase 3.
export const advanceNation = (inputNation, days, { date = null, bonus: bonusOverride = null } = {}) => {
  const nation = normalizeNation(inputNation);
  const bonus = bonusOverride ?? nation.buildingBonus;
  const report = { days, produced: {}, shortages: {}, extracted: {} };
  if (!(days > 0)) return { nation, report };

  const T = HOI_TUNING;
  const monthShare = days / T.daysPerMonth;
  const stocks = { ...nation.stocks };

  // 1. Extraction, bâtiments compris.
  const extraction = { ...nation.extraction };
  for (const [resource, perMonth] of Object.entries(bonus?.extraction ?? {})) {
    extraction[resource] = num(extraction[resource]) + num(perMonth);
  }
  for (const [resource, perMonth] of Object.entries(extraction)) {
    const gained = perMonth * monthShare;
    stocks[resource] = num(stocks[resource]) + gained;
    report.extracted[resource] = round2(gained);
  }

  // Des usines militaires détruites ralentissent toutes les lignes au prorata :
  // les lignes ne peuvent pas employer plus d'usines que le pays n'en a.
  const assigned = nation.lines.reduce((sum, line) => sum + line.factories, 0);
  const available = effectiveFactories(nation, bonus).military;
  const staffing = assigned > 0 ? Math.min(1, available / assigned) : 1;

  // 2. Production, ligne par ligne, dans l'ordre de priorité (ordre du tableau).
  const modifier = productionModifier(nation, date);
  const cap = nationEfficiencyCap(nation);
  const lines = nation.lines.map((line) => {
    if (!line.factories) return line;

    // Besoin en ressources sur la période ; une pénurie réduit la production
    // au prorata de la ressource la plus manquante.
    let supplyRatio = 1;
    const needs = {};
    for (const [resource, perFactoryPerMonth] of Object.entries(line.resources)) {
      const need = perFactoryPerMonth * line.factories * monthShare;
      needs[resource] = need;
      const have = num(stocks[resource]);
      if (need > 0 && have < need) {
        supplyRatio = Math.min(supplyRatio, have / need);
        report.shortages[resource] = round2(num(report.shortages[resource]) + (need - have));
      }
    }
    for (const [resource, need] of Object.entries(needs)) {
      stocks[resource] = Math.max(0, num(stocks[resource]) - need * supplyRatio);
    }

    const capacity = line.factories * T.capacityPerFactoryPerDay * days
      * line.efficiency * (1 + modifier) * supplyRatio * staffing;
    const total = line.progress + capacity / line.unitCost;
    const units = Math.floor(total);
    if (units > 0) report.produced[line.equipment] = num(report.produced[line.equipment]) + units;

    // L'efficacité monte vers le plafond tant que la ligne tourne.
    const gap = Math.max(0, cap - line.efficiency);
    const growth = 1 - (1 - T.efficiencyGrowthPerDay) ** (days * supplyRatio);
    return {
      ...line,
      progress: round2(total - units),
      produced: line.produced + units,
      efficiency: round2(clamp(line.efficiency + gap * growth, T.efficiencyFloor, Math.max(cap, line.efficiency))),
    };
  });

  // 3. Les modificateurs échus disparaissent.
  const modifiers = nation.modifiers.filter((m) => !m.untilDate || !date || compareGameDates(date, m.untilDate) < 0);

  for (const key of Object.keys(stocks)) stocks[key] = round2(stocks[key]);
  return { nation: { ...nation, stocks, lines, modifiers }, report };
};

const mergeReports = (a, b) => {
  const add = (x, y) => {
    const out = { ...x };
    for (const [key, value] of Object.entries(y)) out[key] = round2(num(out[key]) + value);
    return out;
  };
  return {
    days: a.days + b.days,
    produced: add(a.produced, b.produced),
    shortages: add(a.shortages, b.shortages),
    extracted: add(a.extracted, b.extracted),
    researched: [...(a.researched ?? []), ...(b.researched ?? [])],
    built: [...(a.built ?? []), ...(b.built ?? [])],
    repaired: [...(a.repaired ?? []), ...(b.repaired ?? [])],
  };
};

// Les structures de la carte qui portent un bâtiment, rangées par pays suivi.
const buildingsByNation = (hoi, markers) => {
  const owned = {};
  markers.forEach((marker, index) => {
    if (!marker?.building) return;
    const key = findNationKey(hoi, marker.ownerCode);
    if (!key) return;
    (owned[key] ??= []).push({ index, marker });
  });
  return owned;
};

// Relevé de ce que les bâtiments apportent à chaque nation, sans rien avancer :
// après une installation ou des dégâts, pour que panneaux et economyOps lisent
// des usines à jour.
export const refreshBuildingBonuses = (world) => {
  if (!isObject(world) || !isObject(world.hoi)) return world;
  const owned = buildingsByNation(world.hoi, Array.isArray(world.markers) ? world.markers : []);
  const nations = Object.fromEntries(Object.entries(world.hoi.nations || {}).map(([key, raw]) => [
    key,
    { ...normalizeNation(raw), buildingBonus: sumContributions((owned[key] ?? []).map((entry) => entry.marker.building)) },
  ]));
  return { ...world, hoi: { ...world.hoi, nations } };
};

// Point d'entrée appelé par applySimulationResult après les impacts IA.
// Inerte sans world.hoi ou sans jours écoulés.
// `player` : le pays du joueur. Le moteur choisit les recherches et les chantiers
// de tous les autres ; les siens, c'est le joueur qui les choisit (panneaux).
export const advanceHoiLayer = (world, { fromDate, toDate, player = "" } = {}) => {
  if (!isObject(world) || !isObject(world.hoi)) return world;
  const days = diffGameDays(fromDate, toDate);
  if (!(days > 0)) return world;

  const tree = world.hoi.tech?.tree ?? null;
  const playerKey = findNationKey(world.hoi, player);

  // Phase 3 : les structures racontées depuis le dernier saut deviennent des
  // chantiers, et un état posé par le récit devient un état chiffré. Seulement
  // une fois les bâtiments installés (ensureHoiBuildings), pour qu'une structure
  // d'avant la couche ne soit pas prise pour un chantier neuf.
  let markers = Array.isArray(world.markers) ? [...world.markers] : [];
  const queues = Object.fromEntries(Object.entries(world.hoi.nations || {}).map(([key, raw]) => [key, normalizeNation(raw).constructionQueue]));
  let syncedQueues = queues;
  if (world.hoi.buildingsInstalled) {
    const synced = syncBuildingsWithMarkers(markers, {
      resolveNation: (owner) => findNationKey(world.hoi, owner),
      resources: [...new Set(Object.values(world.hoi.nations || {}).flatMap((nation) => [
        ...Object.keys(nation?.stocks ?? {}), ...Object.keys(nation?.extraction ?? {}),
      ]))],
      queues,
    });
    markers = synced.markers;
    syncedQueues = synced.queues;
  }
  const owned = buildingsByNation(world.hoi, markers);

  const nations = {};
  const reports = {};
  for (const [polity, raw] of Object.entries(world.hoi.nations || {})) {
    let nation = { ...normalizeNation(raw), constructionQueue: syncedQueues[polity] ?? [] };
    let buildings = (owned[polity] ?? []).map((entry) => ({ ...entry }));
    let report = { days: 0, produced: {}, shortages: {}, extracted: {}, built: [], repaired: [], ...emptyResearchReport() };
    let remaining = days;
    let elapsed = 0;
    while (remaining > 0) {
      const step = Math.min(HOI_TUNING.maxStepDays, remaining);
      elapsed += step;
      const stepDate = addDaysSafe(fromDate, elapsed);
      const bonus = sumContributions(buildings.map((entry) => entry.marker.building));
      nation = { ...nation, buildingBonus: bonus };
      const result = advanceNation(nation, step, { date: stepDate, bonus });
      const research = advanceResearch(result.nation, step, { date: stepDate, tree, auto: polity !== playerKey });
      const construction = advanceConstruction(buildings, research.nation.constructionQueue, step, {
        effectiveCivilian: effectiveFactories(research.nation, bonus).civilian,
        auto: polity !== playerKey,
      });
      buildings = construction.owned;
      nation = { ...research.nation, constructionQueue: construction.queue };
      report = mergeReports(report, { ...result.report, researched: research.researched, ...construction.report });
      remaining -= step;
    }
    // Le relevé final, et l'état affiché de chaque structure.
    nation = { ...nation, buildingBonus: sumContributions(buildings.map((entry) => entry.marker.building)) };
    for (const { index, marker } of buildings) {
      markers[index] = { ...marker, status: statusForBuilding(marker.building, marker.status) };
    }
    nations[polity] = nation;
    reports[polity] = report;
  }

  return {
    ...world,
    markers,
    hoi: {
      ...world.hoi,
      version: HOI_VERSION,
      lastDate: toDate,
      lastReport: { fromDate, toDate, days, nations: reports },
      nations,
    },
  };
};

// Petite aide locale : date + n jours, ou la date d'origine si le calcul échoue
// (addGameDays renvoie alors "", pas null).
const addDaysSafe = (date, days) => addGameDays(date, days) || date;

// ---------------------------------------------------------------------------
// Texte pour le prompt (branché en phase 1)
// ---------------------------------------------------------------------------

// Une ligne par autre puissance : usines, pénuries du dernier saut. Les plus
// industrielles d'abord, bornées à `limit` pour ne pas gonfler le prompt.
const buildOtherNationsLines = (world, playerKey, limit) => {
  const nations = world.hoi.nations;
  const reports = world.hoi.lastReport?.nations ?? {};
  return Object.entries(nations)
    .filter(([key]) => key !== playerKey)
    .map(([key, nation]) => ({
      key,
      nation,
      weight: num(nation?.factories?.civilian) + num(nation?.factories?.military),
    }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ key, nation }) => {
      const shortages = Object.keys(reports[key]?.shortages ?? {});
      const lines = (Array.isArray(nation.lines) ? nation.lines : [])
        .filter((entry) => entry.factories > 0)
        .map((entry) => `${entry.equipment} ${entry.factories}`)
        .join(", ");
      const techs = world.hoi.tech?.tree ? (nation.research?.done ?? []).length : 0;
      return `- ${key} : ${num(nation.factories?.civilian)} civiles / ${num(nation.factories?.military)} militaires`
        + (lines ? ` (lignes : ${lines})` : "")
        + (techs ? `, ${techs} techs` : "")
        + (shortages.length ? ` — pénurie de ${shortages.join(", ")}` : "")
        + ".";
    });
};

// La recherche d'une nation, pour le prompt : en cours, emplacements libres,
// acquises au dernier saut, et les équipements de l'arbre déjà débloqués — l'IA
// ne doit pas raconter les autres. Rien tant que la partie n'a pas d'arbre.
const buildResearchPromptLines = (hoi, nation, report) => {
  const tree = hoi?.tech?.tree;
  if (!tree || !Array.isArray(tree.techs)) return [];
  const byId = new Map(tree.techs.map((tech) => [tech.id, tech]));
  const research = nation.research ?? { done: [], slots: [] };
  const active = research.slots
    .map((slot) => {
      const tech = byId.get(slot.techId);
      return tech ? `${tech.name} [id ${tech.id}] ${Math.min(99, Math.round((slot.progress / Math.max(1, tech.days)) * 100))} %` : null;
    })
    .filter(Boolean);
  const done = new Set(research.done);
  const unlocked = Object.entries(tree.equipment ?? {})
    .filter(([, spec]) => done.has(spec.techId))
    .map(([id]) => id);
  const locked = Object.keys(tree.equipment ?? {}).filter((id) => !unlocked.includes(id));
  const out = [`Recherche : ${active.join(" ; ") || "aucune en cours"} (${done.size} techs acquises).`];
  if (report?.researched?.length) out.push(`Acquises au dernier saut : ${report.researched.join(", ")}.`);
  if (unlocked.length) out.push(`Équipements débloqués par la recherche : ${unlocked.join(", ")}.`);
  if (locked.length) out.push(`Pas encore débloqués (ne pas les faire apparaître) : ${locked.join(", ")}.`);
  return out;
};

// Les bâtiments d'une nation, pour le prompt (phase 3) : par type, chantiers en
// cours, dégâts, et ce qui s'est passé au dernier saut. Rien avant l'installation.
const buildBuildingPromptLines = (world, key, nation, report) => {
  if (!world.hoi?.buildingsInstalled) return [];
  const owned = (Array.isArray(world.markers) ? world.markers : [])
    .filter((marker) => marker?.building && findNationKey(world.hoi, marker.ownerCode) === key);
  const effective = effectiveFactories(nation);
  const out = [`Usines effectives (bâtiments compris) : ${effective.civilian} civiles, ${effective.military} militaires.`];
  if (!owned.length) return [...out, "Bâtiments : aucun sur la carte."];
  const counts = new Map();
  for (const marker of owned) {
    const label = HOI_BUILDING_TYPES[marker.building.type]?.label ?? marker.building.type;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  out.push(`Bâtiments : ${[...counts].map(([label, count]) => `${count} ${label}`).join(", ")}.`);
  const building = owned.filter((marker) => marker.building.construction)
    .map((marker) => `${marker.name} ${Math.min(99, Math.round((marker.building.construction.progress / marker.building.construction.cost) * 100))} %`);
  if (building.length) out.push(`Chantiers : ${building.slice(0, 6).join(" ; ")}.`);
  const damaged = owned.filter((marker) => marker.building.condition < 100)
    .map((marker) => `${marker.name} ${Math.round(marker.building.condition)} %`);
  if (damaged.length) out.push(`Endommagés (réparations en cours, automatiques) : ${damaged.slice(0, 6).join(" ; ")}.`);
  if (report?.built?.length) out.push(`Terminés au dernier saut : ${report.built.join(", ")}.`);
  return out;
};

// `others` : nombre d'autres puissances résumées en une ligne (0 = aucune).
export const buildEconomyPromptBlock = (world, polity, { others = 0 } = {}) => {
  const key = findNationKey(world?.hoi, polity);
  if (!key) return "";
  const nation = world.hoi.nations[key];
  const report = world.hoi.lastReport?.nations?.[key];
  const lines = [`[ÉCONOMIE — ${key}]`];
  lines.push(`Stocks : ${Object.entries(nation.stocks).map(([k, v]) => `${k} ${v}`).join(", ") || "aucun"}.`);
  lines.push(`Usines : ${nation.factories.civilian} civiles, ${nation.factories.military} militaires.`);
  const production = (Array.isArray(nation.lines) ? nation.lines : [])
    .map((entry) => `${entry.equipment} [id ${entry.id}] ${entry.factories} usines, efficacité ${Math.round(entry.efficiency * 100)} %`)
    .join(" ; ");
  if (production) lines.push(`Lignes : ${production}.`);
  const modifiers = (Array.isArray(nation.modifiers) ? nation.modifiers : [])
    .map((m) => `${m.label || m.id} ${m.value > 0 ? "+" : ""}${Math.round(m.value * 100)} %${m.untilDate ? ` jusqu'au ${m.untilDate}` : ""}`)
    .join(", ");
  if (modifiers) lines.push(`Modificateurs actifs : ${modifiers}.`);
  if (report) {
    const produced = Object.entries(report.produced).map(([k, v]) => `${v} ${k}`).join(", ");
    const short = Object.entries(report.shortages).map(([k, v]) => `${k} (manque ${v})`).join(", ");
    lines.push(`Dernier saut (${report.days} j) : production ${produced || "nulle"}.`);
    if (short) lines.push(`Pénuries : ${short}. Le récit doit en tenir compte.`);
  }
  lines.push(...buildResearchPromptLines(world.hoi, nation, report));
  lines.push(...buildBuildingPromptLines(world, key, nation, report));
  if (others > 0) {
    const rest = buildOtherNationsLines(world, key, others);
    if (rest.length) lines.push("Autres puissances :", ...rest);
  }
  return lines.join("\n");
};
