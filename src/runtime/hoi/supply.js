// Couche HOI4 — le ravitaillement (phase 7.2).
//
// Run tests: node --test src/runtime/hoi/supply.test.js
// Import-free : il tourne sans node_modules, comme engine.js et armies.js.
//
// L'IA raconte, le moteur compte : ce module dit, pour chaque état tenu par un
// camp, quelle part du ravitaillement y arrive (0 → 1) et s'il est encerclé.
//
//   - Sources : la capitale du pays, les états de ses complexes industriels
//     (ses dépôts), et ses ports (un état côtier avec un port), un peu moins
//     généreux : ce qui arrive par mer se décharge d'abord.
//   - Portée : un parcours des états tenus par le camp (le pays et ses alliés en
//     guerre), chaque état coûtant selon son terrain, beaucoup moins s'il est
//     bien équipé en voies ferrées (scripts/worldmap/supply-states.mjs), la
//     portée s'allongeant avec les camions en réserve.
//   - Encerclement : un état tenu dont aucun chemin ami ne mène à une source.
//
// Sur les divisions (applySupply) : chacune consomme des « fournitures » de la
// réserve ; son ravitaillement est celui de son état multiplié par ce que la
// réserve a pu donner. Mal ravitaillée, son organisation plafonne plus bas ;
// encerclée, elle perd de l'organisation chaque jour, n'est plus complétée, et
// ses jours d'encerclement se comptent (la reddition viendra avec le combat, 7.4).

export const SUPPLY_TUNING = Object.freeze({
  // Coût d'un état selon son terrain (hoiTerrain.js).
  terrainCost: Object.freeze({ plaine: 1, urbain: 0.8, desert: 1.6, colline: 1.4, foret: 1.5, marais: 2, jungle: 2.2, montagne: 2.5 }),
  // Multiplicateur de ce coût par niveau de rail, 0 → 5.
  railFactor: Object.freeze([1, 0.85, 0.7, 0.55, 0.4, 0.3]),
  // Densité de voies (km pour 1 000 km²) à partir de laquelle un état a le niveau 1 à 5.
  railThresholds: Object.freeze([1, 5, 15, 35, 70]),
  // Coût cumulé couvert à plein depuis une source, puis la baisse jusqu'à zéro.
  range: 8,
  falloff: 6,
  // Portée gagnée avec des camions à hauteur des besoins (part de la portée).
  truckBonus: 0.35,
  // Ce qui part d'un port commence avec ce coût (déchargement).
  portStartCost: 2,
  // Une côte qu'un pays tient, sans port : débarquement sur la plage, plus cher.
  // (Colonies, îles, poches côtières ; le blocus par une marine viendra en 7.8.)
  coastStartCost: 4,
  // Fournitures consommées par mois, selon la nature de la formation.
  suppliesPerMonth: Object.freeze({ land: 6, air: 4, sea: 5 }),
  // Camions « attendus » par division terrestre pour le plein bonus.
  trucksPerDivision: 5,
  // Encerclée : organisation perdue par jour.
  encircledOrganisationPerDay: 3,
  daysPerMonth: 30,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round2 = (value) => Math.round(value * 100) / 100;
const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Le niveau de rail d'un état, 0 → 5, d'après ses kilomètres de voies et sa surface.
export const railLevel = (railKm, areaKm2) => {
  const density = (num(railKm) / Math.max(1, num(areaKm2))) * 1000;
  return SUPPLY_TUNING.railThresholds.filter((threshold) => density >= threshold).length;
};

// Ce que coûte la traversée d'un état. `info` : { terrain, rail } (supply-<scenario>.json).
export const stateCost = (info) => {
  const T = SUPPLY_TUNING;
  const terrain = T.terrainCost[clean(info?.terrain)] ?? 1;
  const rail = T.railFactor[Math.max(0, Math.min(5, Math.round(num(info?.rail))))];
  return round2(terrain * rail);
};

// Le ravitaillement de chaque état tenu par un camp.
//   side         : noms des pays du camp (le pays et ses alliés en guerre)
//   states       : identifiants des états à considérer (ceux de la carte)
//   controllerOf : id → qui tient l'état ; neighboursOf : id → voisins
//   infoOf       : id → { terrain, rail, coastal }
//   sources      : [{ stateId, startCost }] (sourcesFor)
//   trucks       : 0 → 1, part des camions attendus que la réserve possède
// Renvoie Map id → { level, cost, encircled }, pour les états tenus par le camp.
export const computeSupply = ({ side, states, controllerOf, neighboursOf, infoOf = () => ({}), sources = [], trucks = 0 }) => {
  const T = SUPPLY_TUNING;
  const sideKeys = new Set([...side].map(key));
  const held = (id) => sideKeys.has(key(controllerOf(id)));
  const best = new Map();
  const queue = [];
  const push = (id, cost) => {
    if (!held(id)) return;
    if (best.has(id) && best.get(id) <= cost) return;
    best.set(id, cost);
    queue.push([cost, id]);
  };
  for (const source of sources) push(clean(source.stateId), num(source.startCost));
  // Dijkstra sans tas : quelques milliers d'états au plus, une fois par saut.
  while (queue.length) {
    let at = 0;
    for (let i = 1; i < queue.length; i += 1) if (queue[i][0] < queue[at][0]) at = i;
    const [cost, id] = queue.splice(at, 1)[0];
    if (best.get(id) < cost) continue;
    for (const next of neighboursOf(id) ?? []) {
      const nextId = clean(next);
      if (!nextId || !held(nextId)) continue;
      push(nextId, round2(cost + stateCost(infoOf(nextId))));
    }
  }
  const reach = T.range * (1 + T.truckBonus * Math.max(0, Math.min(1, num(trucks))));
  const out = new Map();
  for (const id of states) {
    if (!held(id)) continue;
    const cost = best.get(id);
    if (cost === undefined) { out.set(id, { level: 0, cost: Infinity, encircled: true }); continue; }
    const level = cost <= reach ? 1 : Math.max(0, 1 - (cost - reach) / T.falloff);
    out.set(id, { level: round2(level), cost, encircled: false });
  }
  return out;
};

// Les sources d'un pays : sa capitale, les états de ses complexes industriels,
// et ses ports (plus coûteux au départ). Seulement celles qu'il tient.
//   capital : id d'état ; depots : ids ; ports : ids
export const sourcesFor = ({ polity, controllerOf, capital = "", depots = [], ports = [], coasts = [] }) => {
  const own = (id) => clean(id) && key(controllerOf(clean(id))) === key(polity);
  const out = new Map();
  for (const id of [capital, ...depots]) if (own(id)) out.set(clean(id), 0);
  for (const id of ports) if (own(id) && !out.has(clean(id))) out.set(clean(id), SUPPLY_TUNING.portStartCost);
  for (const id of coasts) if (own(id) && !out.has(clean(id))) out.set(clean(id), SUPPLY_TUNING.coastStartCost);
  return [...out].map(([stateId, startCost]) => ({ stateId, startCost }));
};

// La part des camions attendus que possède une armée (réserve et divisions).
export const truckShare = (army, templates) => {
  const land = (army?.divisions ?? []).filter((division) => templates?.[division.template]?.kind === "land").length;
  if (!land) return 1;
  const inDivisions = (army?.divisions ?? []).reduce((sum, division) => sum + num(division.equipment?.camions), 0);
  return Math.min(1, (num(army?.stockpile?.camions) + inDivisions) / (land * SUPPLY_TUNING.trucksPerDivision));
};

// Le ravitaillement appliqué aux divisions d'une armée pour `days` jours.
// `supply` : Map id → { level, encircled } (computeSupply) ; une division hors de
// cette carte (sans état, en mer, en l'air) est ravitaillée depuis la réserve seule.
// Renvoie { army, report: { needed, consumed, ratio, encircled: [ids], poorlySupplied } }.
export const applySupply = (army, supply, days, templates) => {
  const T = SUPPLY_TUNING;
  const months = days / T.daysPerMonth;
  const needed = round2(army.divisions.reduce((sum, division) => sum + (T.suppliesPerMonth[templates?.[division.template]?.kind] ?? T.suppliesPerMonth.land) * months, 0));
  const stock = num(army.stockpile?.fournitures);
  const ratio = needed > 0 ? Math.min(1, stock / needed) : 1;
  const consumed = round2(Math.min(stock, needed));
  const encircled = [];
  let poorlySupplied = 0;
  const divisions = army.divisions.map((division) => {
    const here = supply instanceof Map ? supply.get(division.stateId) : null;
    const level = round2((here ? here.level : 1) * ratio);
    const cut = Boolean(here?.encircled);
    if (cut) encircled.push(division.id);
    if (level < 0.5) poorlySupplied += 1;
    const organisation = cut
      ? Math.max(0, division.organisation - T.encircledOrganisationPerDay * days)
      : division.organisation;
    return {
      ...division,
      supply: level,
      encircledDays: cut ? num(division.encircledDays) + days : 0,
      organisation: round2(organisation),
    };
  });
  return {
    army: { ...army, stockpile: { ...army.stockpile, fournitures: round2(stock - consumed) }, divisions },
    report: { needed, consumed, ratio: round2(ratio), encircled, poorlySupplied },
  };
};
