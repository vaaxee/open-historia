// Couche HOI4 — les bâtiments et la construction (phase 3).
//
// Run tests: node --test src/runtime/hoi/buildings.test.js
// Import-free: engine.js imports this module.
//
// Un bâtiment est une structure de la carte (world.markers) qui porte en plus
// `marker.building`, géré par le moteur :
//   { type, level, condition, resource?, capacity?, legacy?, construction? }
//     level        0 (chantier pas encore fini) à maxLevel
//     condition    état, 0 à 100 ; sous 25 le bâtiment ne produit plus rien
//     resource     la ressource d'une mine
//     capacity     { civilian, military } d'un complexe industriel de départ
//     legacy       structure antérieure à la couche : typée, sans effet économique
//     construction { kind: "build"|"upgrade", targetLevel, progress, cost }
//
// Le propriétaire reste marker.ownerCode. La file de chantiers d'un pays est
// world.hoi.nations[pays].constructionQueue (identifiants de structures), et les
// réparations passent avant, d'elles-mêmes.

export const BUILDING_TUNING = Object.freeze({
  // Points de construction produits par une usine civile et par jour.
  pointsPerFactoryPerDay: 5,
  // Au plus autant d'usines civiles sur un même chantier (comme HOI4).
  maxFactoriesPerProject: 15,
  // Part des usines civiles réservée aux biens de consommation.
  consumerGoodsShare: 0.2,
  // Sous cet état, un bâtiment ne produit plus rien.
  minWorkingCondition: 25,
  // Une réparation complète coûte cette part du coût d'un niveau, par niveau.
  repairShareOfCost: 0.5,
  // Un bâtiment signalé « endommagé » par le récit tombe au plus à cet état.
  narratedDamageCondition: 60,
  // Bornes d'une opération de dégâts (economyOps "damage").
  damageMin: 0.1,
  damageMax: 0.5,
  // Complexes industriels créés au départ : un pays les reçoit à partir de ce
  // nombre d'usines, dans au plus ce nombre de villes.
  complexMinFactories: 10,
  complexMaxCities: 4,
  complexFactoriesPerCity: 12,
});

// Le catalogue. `match` lit le type (kind) et le nom d'une structure racontée,
// en anglais et en français ; l'ordre compte (le plus précis d'abord).
export const HOI_BUILDING_TYPES = Object.freeze({
  complexe_industriel: Object.freeze({
    label: "complexe industriel", icon: "industry", maxLevel: 1, cost: 0,
    effect: Object.freeze({ kind: "capacity" }),
    match: /industrial complex|complexe industriel/,
  }),
  usine_militaire: Object.freeze({
    label: "usine militaire", icon: "arms", maxLevel: 5, cost: 7200,
    effect: Object.freeze({ kind: "military", perLevel: 1 }),
    match: /military factory|arms (factory|plant|works)|armament|munition|ordnance|arsenal|tank (factory|plant|works)|aircraft (factory|plant|works)|usine militaire|usine d'armement|manufacture d'armes/,
  }),
  raffinerie_synthetique: Object.freeze({
    label: "raffinerie synthétique", icon: "synthetic", maxLevel: 3, cost: 8000,
    effect: Object.freeze({ kind: "extraction", resource: "caoutchouc", perLevel: 2 }),
    match: /synthetic (rubber|fuel)|buna|raffinerie synth|caoutchouc synth/,
  }),
  acierie: Object.freeze({
    label: "aciérie", icon: "steel", maxLevel: 3, cost: 7000,
    effect: Object.freeze({ kind: "extraction", resource: "acier", perLevel: 4 }),
    match: /steel ?works|steel mill|foundry|acier(ie|ies)|aciérie|fonderie|haut[- ]fourneau/,
  }),
  raffinerie: Object.freeze({
    label: "raffinerie", icon: "refinery", maxLevel: 3, cost: 6000,
    effect: Object.freeze({ kind: "extraction", resource: "petrole", perLevel: 3 }),
    match: /refiner|raffiner|oil ?field|puits de pétrole|derrick/,
  }),
  mine: Object.freeze({
    label: "mine", icon: "mine", maxLevel: 3, cost: 4000,
    effect: Object.freeze({ kind: "extraction", resource: null, perLevel: 3 }),
    match: /\bmine\b|mining|quarry|colliery|coal ?field|mine de|minière|carrière|houillère/,
  }),
  usine_civile: Object.freeze({
    label: "usine civile", icon: "factory", maxLevel: 5, cost: 10800,
    effect: Object.freeze({ kind: "civilian", perLevel: 1 }),
    match: /civilian factory|factory|plant\b|works\b|industrial|usine|manufacture/,
  }),
  fort: Object.freeze({
    label: "fort", icon: "fort", maxLevel: 5, cost: 1500,
    effect: Object.freeze({ kind: "none", stat: "défense" }),
    match: /\bfort\b|fortress|fortif|bunker|citadel|casemate|blockhaus|maginot|ligne de défense|defensive line/,
  }),
  radar: Object.freeze({
    label: "radar", icon: "radar", maxLevel: 3, cost: 2000,
    effect: Object.freeze({ kind: "none", stat: "détection" }),
    match: /radar/,
  }),
  aerodrome: Object.freeze({
    label: "aérodrome", icon: "airfield", maxLevel: 5, cost: 3000,
    effect: Object.freeze({ kind: "none", stat: "capacité aérienne" }),
    match: /airfield|air ?base|air ?strip|aerodrome|aérodrome|base aérienne|airport|aéroport/,
  }),
  port: Object.freeze({
    label: "port", icon: "port", maxLevel: 5, cost: 4000,
    effect: Object.freeze({ kind: "none", stat: "capacité navale" }),
    match: /\bport\b|harbou?r|naval base|base navale|dock|shipyard|chantier naval|arsenal maritime/,
  }),
});

// Les types qu'un joueur peut lancer lui-même (pas le complexe de départ).
export const CONSTRUCTIBLE_TYPES = Object.freeze(Object.keys(HOI_BUILDING_TYPES).filter((type) => type !== "complexe_industriel"));

// Les types qu'une tech peut réserver. Pas les usines, les mines, les forts ni
// les ports : ils restent constructibles d'emblée, quel que soit l'arbre.
export const TECH_GATEABLE_BUILDINGS = Object.freeze(["raffinerie_synthetique", "acierie", "radar", "raffinerie", "aerodrome"]);

const MINE_RESOURCES = [
  [/coal|charbon|houill|lignite/, "charbon"],
  [/iron|steel|fer\b|acier/, "acier"],
  [/chrom/, "chrome"],
  [/tungst|wolfram/, "tungstene"],
  [/bauxite|alumin/, "aluminium"],
  [/oil|pétrole|petrole/, "petrole"],
  [/rubber|caoutchouc|hévéa/, "caoutchouc"],
];

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => text(value).toLowerCase();

// « de Paris », mais « d'Essen », « d'Osaka » : l'élision devant une voyelle.
export const ofPlace = (name) => {
  const place = text(name);
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(place) ? `d'${place}` : `de ${place}`;
};

// ---------------------------------------------------------------------------
// Forme
// ---------------------------------------------------------------------------

export const normalizeBuilding = (value) => {
  if (!isObject(value)) return null;
  const type = text(value.type);
  const spec = HOI_BUILDING_TYPES[type];
  if (!spec) return null;
  const level = Math.round(clamp(num(value.level, 1), 0, spec.maxLevel));
  const building = {
    type,
    level,
    condition: round2(clamp(num(value.condition, 100), 0, 100)),
  };
  if (type === "mine") building.resource = text(value.resource) || "acier";
  if (type === "complexe_industriel") {
    building.capacity = {
      civilian: Math.max(0, Math.floor(num(value.capacity?.civilian))),
      military: Math.max(0, Math.floor(num(value.capacity?.military))),
    };
  }
  if (value.legacy === true) building.legacy = true;
  const construction = value.construction;
  if (isObject(construction) && level < spec.maxLevel) {
    const targetLevel = Math.round(clamp(num(construction.targetLevel, level + 1), level + 1, spec.maxLevel));
    building.construction = {
      kind: construction.kind === "upgrade" ? "upgrade" : "build",
      targetLevel,
      progress: round2(Math.max(0, num(construction.progress))),
      cost: Math.max(1, round2(num(construction.cost, spec.cost * (targetLevel - level)))),
    };
  }
  return building;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Le type d'une structure racontée, d'après son kind puis son nom ; null si rien
// ne correspond (une ambassade reste une simple structure).
export const buildingTypeFor = (kind, name = "") => {
  const byKind = fold(kind);
  if (HOI_BUILDING_TYPES[byKind.replace(/\s+/g, "_")]) return byKind.replace(/\s+/g, "_");
  for (const source of [byKind, fold(name)]) {
    if (!source) continue;
    for (const [type, spec] of Object.entries(HOI_BUILDING_TYPES)) {
      if (spec.match.test(source)) return type;
    }
  }
  return null;
};

// La ressource d'une mine, d'après son nom ; `available` borne aux ressources
// de la partie.
export const mineResourceFor = (name, available = null) => {
  const source = fold(name);
  const found = MINE_RESOURCES.find(([pattern]) => pattern.test(source))?.[1] ?? "acier";
  if (available && available.length && !available.includes(found)) return available.includes("acier") ? "acier" : available[0];
  return found;
};

// Un type verrouillé par l'arbre : une tech le débloque et le pays ne l'a pas.
export const isBuildingTypeUnlocked = (type, nation, tree) => {
  if (!HOI_BUILDING_TYPES[type]) return false;
  const gate = (tree?.techs ?? []).find((tech) => (tech.effects ?? []).some((effect) => effect.type === "building" && effect.building === type));
  return !gate || (nation?.research?.done ?? []).includes(gate.id);
};

export const constructibleTypesFor = (nation, tree) => CONSTRUCTIBLE_TYPES.filter((type) => isBuildingTypeUnlocked(type, nation, tree));

// ---------------------------------------------------------------------------
// Effets
// ---------------------------------------------------------------------------

// Ce qu'un bâtiment apporte à son pays, selon son niveau et son état.
export const buildingContribution = (building) => {
  const out = { civilian: 0, military: 0, extraction: {} };
  if (!building || building.legacy) return out;
  const spec = HOI_BUILDING_TYPES[building.type];
  if (!spec) return out;
  if (building.condition < BUILDING_TUNING.minWorkingCondition) return out;
  const factor = building.condition / 100;
  const { effect } = spec;
  if (effect.kind === "capacity") {
    out.civilian = (building.capacity?.civilian ?? 0) * factor;
    out.military = (building.capacity?.military ?? 0) * factor;
  } else if (effect.kind === "civilian") {
    out.civilian = building.level * effect.perLevel * factor;
  } else if (effect.kind === "military") {
    out.military = building.level * effect.perLevel * factor;
  } else if (effect.kind === "extraction") {
    const resource = effect.resource ?? building.resource ?? "acier";
    out.extraction[resource] = round2(building.level * effect.perLevel * factor);
  }
  out.civilian = round2(out.civilian);
  out.military = round2(out.military);
  return out;
};

// La somme pour une liste de bâtiments.
export const sumContributions = (buildings) => {
  const total = { civilian: 0, military: 0, extraction: {} };
  for (const building of buildings) {
    const part = buildingContribution(building);
    total.civilian += part.civilian;
    total.military += part.military;
    for (const [key, value] of Object.entries(part.extraction)) total.extraction[key] = round2((total.extraction[key] ?? 0) + value);
  }
  total.civilian = round2(total.civilian);
  total.military = round2(total.military);
  return total;
};

// Ce qu'un bâtiment fait, en une phrase courte (fiche, panneau, prompt).
export const describeBuildingEffect = (building) => {
  const spec = HOI_BUILDING_TYPES[building?.type];
  if (!spec) return "";
  if (building.legacy && spec.effect.kind !== "none") return "déjà compté dans l'économie de départ";
  const part = buildingContribution({ ...building, legacy: false });
  if (spec.effect.kind === "capacity") return `+${part.civilian} usines civiles, +${part.military} usines militaires`;
  if (spec.effect.kind === "civilian") return `+${part.civilian} usines civiles`;
  if (spec.effect.kind === "military") return `+${part.military} usines militaires`;
  if (spec.effect.kind === "extraction") {
    const [[resource, amount] = ["", 0]] = Object.entries(part.extraction);
    return `+${amount} ${resource} par mois`;
  }
  return `${spec.effect.stat} niveau ${building.level}`;
};

// Des pays qui ont encore assez d'usines abstraites pour des complexes.
export const needsComplexes = (nations) => Object.values(nations ?? {})
  .some((nation) => Math.floor(num(nation?.factories?.civilian)) + Math.floor(num(nation?.factories?.military)) >= BUILDING_TUNING.complexMinFactories);

// L'état affiché d'une structure, déduit du bâtiment. Un état posé par le récit
// qui n'est pas de ce ressort (abandonné, inactif) est gardé.
export const statusForBuilding = (building, currentStatus = "active") => {
  if (building.construction && building.level === 0) return "under_construction";
  if (building.condition <= 0) return "destroyed";
  if (building.condition < 100) return "damaged";
  if (["abandoned", "inactive"].includes(currentStatus)) return currentStatus;
  return "active";
};

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

// Points de construction par jour d'un pays, et plafond par chantier.
export const constructionCapacity = (effectiveCivilian) => {
  const T = BUILDING_TUNING;
  const working = Math.max(0, effectiveCivilian) * (1 - T.consumerGoodsShare);
  return {
    perDay: round2(working * T.pointsPerFactoryPerDay),
    perProjectPerDay: T.maxFactoriesPerProject * T.pointsPerFactoryPerDay,
  };
};

export const repairCost = (building) => {
  const spec = HOI_BUILDING_TYPES[building.type];
  const base = spec?.cost || 6000;
  return base * BUILDING_TUNING.repairShareOfCost * Math.max(1, building.level);
};

// Lancer un chantier sur une structure : un nouveau bâtiment (niveau 0 → 1) ou
// un niveau de plus. Renvoie { building, error }.
export const startConstruction = (building) => {
  const current = normalizeBuilding(building);
  if (!current) return { building: null, error: "unknown-type" };
  const spec = HOI_BUILDING_TYPES[current.type];
  if (current.construction) return { building: current, error: "already-building" };
  if (current.type === "complexe_industriel") return { building: current, error: "not-upgradable" };
  if (current.level >= spec.maxLevel) return { building: current, error: "max-level" };
  if (current.legacy && current.level > 0 && spec.effect.kind !== "none") {
    // Agrandir une structure d'avant la couche : le nouveau niveau compte, pas l'ancien.
    return {
      building: { ...current, legacy: false, level: 0, construction: { kind: "build", targetLevel: 1, progress: 0, cost: spec.cost } },
      error: null,
    };
  }
  return {
    building: {
      ...current,
      construction: { kind: current.level === 0 ? "build" : "upgrade", targetLevel: current.level + 1, progress: 0, cost: spec.cost },
    },
    error: null,
  };
};

// Un chantier neuf à poser sur la carte : la structure et son bâtiment.
export const newBuildingMarker = ({ type, name, ownerCode, lng, lat, date, resource = null, id }) => {
  const spec = HOI_BUILDING_TYPES[type];
  if (!spec || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    id,
    name: text(name) || spec.label,
    kind: spec.label,
    ownerCode,
    lng,
    lat,
    status: "under_construction",
    foundedAt: date || "",
    building: normalizeBuilding({
      type,
      level: 0,
      condition: 100,
      ...(type === "mine" ? { resource: resource || "acier" } : {}),
      construction: { kind: "build", targetLevel: 1, progress: 0, cost: spec.cost },
    }),
  };
};

// Choix automatique des pays gérés par le moteur : agrandir d'abord une usine
// militaire, puis une usine civile ; sinon, rien (ils n'inventent pas de lieu).
const pickAutoProject = (owned) => {
  const candidates = owned
    .filter(({ marker }) => !marker.building.construction && marker.building.condition >= 100)
    .filter(({ marker }) => ["usine_militaire", "usine_civile", "acierie", "raffinerie", "mine"].includes(marker.building.type))
    .filter(({ marker }) => marker.building.level < HOI_BUILDING_TYPES[marker.building.type].maxLevel && !marker.building.legacy);
  const order = ["usine_militaire", "usine_civile", "acierie", "raffinerie", "mine"];
  candidates.sort((a, b) => order.indexOf(a.marker.building.type) - order.indexOf(b.marker.building.type)
    || a.marker.building.level - b.marker.building.level
    || String(a.marker.id).localeCompare(String(b.marker.id)));
  return candidates[0] ?? null;
};

// Pays gérés par le moteur, file vide : un chantier à lancer. Agrandir une usine
// d'abord (pickAutoProject) ; sinon une usine neuve à côté de son premier
// complexe, militaire tant que le pays a moins de 6 usines militaires pour 10
// civiles. `makeId` rend un identifiant stable. Renvoie { owned, queue, created }.
export const planAutoConstruction = (owned, { civilian = 0, military = 0, makeId, date = "" } = {}) => {
  const pick = pickAutoProject(owned);
  if (pick) {
    const started = startConstruction(pick.marker.building);
    if (started.error) return { owned, queue: [], created: null };
    pick.marker = { ...pick.marker, building: started.building };
    return { owned, queue: [String(pick.marker.id)], created: null };
  }
  const anchor = owned.find(({ marker }) => marker.building.type === "complexe_industriel" && marker.building.condition >= BUILDING_TUNING.minWorkingCondition);
  if (!anchor || typeof makeId !== "function") return { owned, queue: [], created: null };
  const type = military < civilian * 0.6 ? "usine_militaire" : "usine_civile";
  const city = String(anchor.marker.name).replace(/^Complexe industriel (de |d')/i, "");
  const count = owned.filter(({ marker }) => marker.building.type === type).length;
  const created = newBuildingMarker({
    type,
    id: makeId(type, count),
    name: `${HOI_BUILDING_TYPES[type].label[0].toUpperCase()}${HOI_BUILDING_TYPES[type].label.slice(1)} ${ofPlace(city)}${count ? ` ${count + 1}` : ""}`,
    ownerCode: anchor.marker.ownerCode,
    lng: Math.round((anchor.marker.lng + 0.1 + 0.05 * count) * 1e5) / 1e5,
    lat: Math.round((anchor.marker.lat - 0.06) * 1e5) / 1e5,
    date,
  });
  if (!created) return { owned, queue: [], created: null };
  const entry = { index: -1, marker: created };
  return { owned: [...owned, entry], queue: [String(created.id)], created: entry };
};

// Avance la construction d'un pays de `days` jours. `owned` : [{ index, marker }]
// des structures du pays qui portent un bâtiment (copies modifiables). Renvoie
// la file mise à jour et le rapport. Pur vis-à-vis de ses entrées.
export const advanceConstruction = (owned, queue, days, { effectiveCivilian, auto = false } = {}) => {
  const report = { built: [], repaired: [] };
  if (!(days > 0)) return { owned, queue, report };
  const capacity = constructionCapacity(effectiveCivilian);
  let budget = capacity.perDay;
  const perProject = capacity.perProjectPerDay;
  const byId = new Map(owned.map((entry) => [String(entry.marker.id), entry]));
  let nextQueue = queue.filter((id) => byId.get(String(id))?.marker.building.construction);

  // Pays gérés par le moteur : un chantier à la fois, s'il n'y en a aucun
  // (planAutoConstruction, appelé par le moteur avant, peut aussi en créer un).
  if (auto && !nextQueue.length && budget > 0) {
    const pick = pickAutoProject(owned);
    if (pick) {
      const started = startConstruction(pick.marker.building);
      if (!started.error) {
        pick.marker = { ...pick.marker, building: started.building };
        byId.set(String(pick.marker.id), pick);
        nextQueue = [String(pick.marker.id)];
      }
    }
  }

  // 1. Réparations, d'elles-mêmes et avant tout : usines d'abord, les plus
  //    abîmées en premier.
  const damaged = owned
    .filter(({ marker }) => marker.building.level > 0 && marker.building.condition < 100 && !marker.building.construction)
    .sort((a, b) => {
      const weight = (entry) => (["complexe_industriel", "usine_militaire", "usine_civile"].includes(entry.marker.building.type) ? 0 : 1);
      return weight(a) - weight(b) || a.marker.building.condition - b.marker.building.condition;
    });
  for (const entry of damaged) {
    if (budget <= 0) break;
    const rate = Math.min(budget, perProject);
    budget -= rate;
    const cost = repairCost(entry.marker.building);
    const gained = (rate * days / cost) * 100;
    const condition = round2(Math.min(100, entry.marker.building.condition + gained));
    entry.marker = { ...entry.marker, building: { ...entry.marker.building, condition } };
    if (condition >= 100) report.repaired.push(entry.marker.name);
  }

  // 2. La file, dans l'ordre.
  const remaining = [];
  for (const id of nextQueue) {
    const entry = byId.get(String(id));
    const construction = entry?.marker.building.construction;
    if (!construction) continue;
    if (budget <= 0) {
      remaining.push(id);
      continue;
    }
    const rate = Math.min(budget, perProject);
    budget -= rate;
    const progress = round2(construction.progress + rate * days);
    if (progress >= construction.cost) {
      const building = { ...entry.marker.building, level: construction.targetLevel, condition: 100 };
      delete building.construction;
      entry.marker = { ...entry.marker, building };
      report.built.push(entry.marker.name);
    } else {
      entry.marker = { ...entry.marker, building: { ...entry.marker.building, construction: { ...construction, progress } } };
      remaining.push(id);
    }
  }
  return { owned, queue: remaining, report };
};

// ---------------------------------------------------------------------------
// Dégâts
// ---------------------------------------------------------------------------

const markerMatches = (marker, target) => {
  const wanted = fold(target);
  if (!wanted) return false;
  if (fold(marker.id) === wanted || fold(marker.name) === wanted) return true;
  return (marker.aliases ?? []).some((alias) => fold(alias) === wanted);
};

// economyOps "damage" : bombardement, sabotage. Chaque opération retire de 10 à
// 50 % d'état à un bâtiment nommé. Renvoie { markers, applied, notes }.
export const applyBuildingDamage = (markers, ops, { title = "" } = {}) => {
  const notes = [];
  const prefix = title ? `Event "${title}": ` : "";
  const say = (kind, line) => notes.push({ kind, text: `${prefix}economyOps — ${line}` });
  const next = [...(Array.isArray(markers) ? markers : [])];
  let applied = 0;
  for (const op of Array.isArray(ops) ? ops : []) {
    const index = next.findIndex((marker) => marker?.building && markerMatches(marker, op.target));
    if (index < 0) {
      say("dropped", `no building named "${op.target}" to damage.`);
      continue;
    }
    const T = BUILDING_TUNING;
    const wanted = Number.isFinite(op.value) ? op.value : 0.25;
    const value = clamp(wanted, T.damageMin, T.damageMax);
    if (value !== wanted) say("adjusted", `damage to "${next[index].name}" was capped to ${Math.round(value * 100)}%.`);
    const building = next[index].building;
    const condition = round2(Math.max(0, building.condition - value * 100));
    next[index] = { ...next[index], building: { ...building, condition }, status: statusForBuilding({ ...building, condition }, next[index].status) };
    applied += 1;
  }
  return { markers: next, applied, notes };
};

// ---------------------------------------------------------------------------
// Synchronisation avec le récit
// ---------------------------------------------------------------------------

// Avant chaque saut : une structure racontée par l'IA depuis l'installation
// reçoit son type et entre en chantier chez son propriétaire ; un état posé par
// le récit (« endommagé », « détruit ») devient un état chiffré. `resolveNation`
// rend la clé de world.hoi.nations d'un propriétaire, ou null.
export const syncBuildingsWithMarkers = (markers, { resolveNation, resources = [], queues = {} } = {}) => {
  const nextQueues = Object.fromEntries(Object.entries(queues).map(([key, list]) => [key, [...list]]));
  const next = (Array.isArray(markers) ? markers : []).map((marker) => {
    if (!marker || typeof marker !== "object") return marker;
    if (marker.building) {
      const building = normalizeBuilding(marker.building);
      if (!building) return marker;
      let condition = building.condition;
      if (marker.status === "destroyed" && condition > 0) condition = 0;
      else if (marker.status === "damaged" && condition >= 100) condition = BUILDING_TUNING.narratedDamageCondition;
      return { ...marker, building: { ...building, condition } };
    }
    const type = buildingTypeFor(marker.kind, marker.name);
    const owner = resolveNation?.(marker.ownerCode) ?? null;
    if (!type || type === "complexe_industriel" || !owner) return marker;
    const built = newBuildingMarker({
      type,
      name: marker.name,
      ownerCode: marker.ownerCode,
      lng: marker.lng,
      lat: marker.lat,
      id: marker.id,
      resource: type === "mine" ? mineResourceFor(marker.name, resources) : null,
    });
    if (!built) return marker;
    nextQueues[owner] = [...(nextQueues[owner] ?? []), String(marker.id)];
    return { ...marker, status: "under_construction", building: built.building };
  });
  return { markers: next, queues: nextQueues };
};

// ---------------------------------------------------------------------------
// Installation (une fois par partie)
// ---------------------------------------------------------------------------

// Les structures d'avant la couche reçoivent un type, niveau 1, sans effet
// économique ; les usines abstraites des grands pays deviennent des complexes
// industriels dans leurs plus grandes villes. `citiesOf(pays)` rend les villes
// du pays [{ name, coordinates: [lng, lat], population }]. Renvoie
// { markers, nations, complexes } ; un pays sans ville garde ses usines abstraites.
// `typeExisting: false` : seulement les complexes, pour une partie déjà installée
// dont les villes n'étaient pas connues la première fois.
export const installBuildings = (markers, nations, { citiesOf, resolveNation, resources = [], date = "", makeId, typeExisting = true }) => {
  const T = BUILDING_TUNING;
  const typed = (Array.isArray(markers) ? markers : []).map((marker) => {
    if (!marker || marker.building || !typeExisting) return marker;
    const type = buildingTypeFor(marker.kind, marker.name);
    if (!type || type === "complexe_industriel" || !resolveNation?.(marker.ownerCode)) return marker;
    return {
      ...marker,
      building: normalizeBuilding({
        type,
        level: 1,
        condition: marker.status === "destroyed" ? 0 : marker.status === "damaged" ? T.narratedDamageCondition : 100,
        legacy: true,
        ...(type === "mine" ? { resource: mineResourceFor(marker.name, resources) } : {}),
      }),
    };
  });

  const nextNations = { ...nations };
  const complexes = [];
  for (const [key, nation] of Object.entries(nations)) {
    const civilian = Math.floor(num(nation?.factories?.civilian));
    const military = Math.floor(num(nation?.factories?.military));
    if (civilian + military < T.complexMinFactories) continue;
    const cities = (citiesOf?.(key) ?? [])
      .filter((city) => Array.isArray(city?.coordinates))
      // Les plus peuplées d'abord ; à égalité (sites sans population), l'ordre
      // donné est gardé (sort est stable).
      .sort((a, b) => num(b.population) - num(a.population));
    const count = Math.min(T.complexMaxCities, Math.max(1, Math.ceil((civilian + military) / T.complexFactoriesPerCity)), cities.length);
    if (!count) continue;
    const share = (total, i) => Math.floor(total / count) + (i < total % count ? 1 : 0);
    for (let i = 0; i < count; i += 1) {
      const city = cities[i];
      // Un peu à l'est de la ville, pour que l'icône ne couvre pas son point.
      const [lng, lat] = city.coordinates;
      complexes.push({
        id: makeId(key, i),
        name: `Complexe industriel ${ofPlace(city.name)}`,
        kind: HOI_BUILDING_TYPES.complexe_industriel.label,
        ownerCode: key,
        lng: Math.round((lng + 0.12) * 1e5) / 1e5,
        lat,
        status: "active",
        foundedAt: date,
        building: normalizeBuilding({
          type: "complexe_industriel",
          level: 1,
          condition: 100,
          capacity: { civilian: share(civilian, i), military: share(military, i) },
        }),
      });
    }
    // Les usines sont maintenant sur la carte : plus rien d'abstrait.
    nextNations[key] = { ...nation, factories: { civilian: 0, military: 0 } };
  }
  return { markers: [...typed, ...complexes], nations: nextNations, complexes: complexes.length };
};
