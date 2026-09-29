// Couche HOI4 — l'aviation (phase 7.8).
//
// Run tests: node --test src/runtime/hoi/naval.test.js (aviation et marine)
// Import-free à part les modules purs de la couche.
//
// Des escadres (gabarits chasse et bombardement, armies.js) sont affectées à une
// zone : un front (toute sa ligne) ou un état. Le moteur y calcule, à chaque saut :
//   - la supériorité aérienne : la chasse de chaque camp dans la zone, l'une contre
//     l'autre ; 0 → 1 pour le camp qui attaque ;
//   - l'appui au sol : les escadres de bombardement en mission « appui » ajoutent à
//     l'attaque, d'autant plus que le ciel est à leur camp ;
//   - l'usure du ravitaillement ennemi : ces mêmes bombardiers réduisent la défense
//     des états bombardés ;
//   - les pertes d'avions, pour la chasse (combats aériens) et le bombardement
//     (chasse et DCA adverses).
// Ce facteur aérien remplace celui de 7.4, tiré du seul nombre d'escadres.
//
// Forme de world.hoi.airMissions :
// [{ id, owner, zone: { kind: "front", frontId } | { kind: "state", stateId }, mission: "superiority" | "support", wingIds: [] }]

import { divisionStrength, templatesFor } from "./armies.js";
import { normalizeFronts } from "./fronts.js";

export const AIR_MISSIONS = Object.freeze(["superiority", "support"]);
export const AIR_TUNING = Object.freeze({
  // Poids de la supériorité dans l'attaque (±15 % aux extrêmes).
  superiorityWeight: 0.3,
  // Appui au sol par escadre de bombardement, pondéré par la supériorité, plafonné.
  supportPerWing: 0.03,
  supportCap: 0.2,
  // Usure de la défense bombardée, par escadre, plafonnée.
  attritionPerWing: 0.03,
  attritionCap: 0.3,
  // Pertes par semaine, à forces égales.
  fighterLossPerWeek: 0.05,
  bomberLossPerWeek: 0.04,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const slug = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const MISSION_ALIASES = Object.freeze({
  superiority: "superiority", superiorite: "superiority", "supériorité": "superiority", chasse: "superiority", fighters: "superiority", air_superiority: "superiority",
  support: "support", appui: "support", bombing: "support", bombardement: "support", ground: "support", cas: "support",
});
export const normalizeAirMission = (value) => MISSION_ALIASES[clean(value).toLowerCase()] ?? "";

export const normalizeAirMissionEntry = (value, index = 0) => {
  if (!isObject(value)) return null;
  const owner = clean(value.owner);
  const zone = isObject(value.zone) ? value.zone : {};
  const kind = zone.kind === "state" ? "state" : "front";
  const target = clean(kind === "state" ? zone.stateId : zone.frontId);
  if (!owner || !target) return null;
  return {
    id: clean(value.id) || `air-${slug(owner)}-${index + 1}`,
    owner,
    zone: kind === "state" ? { kind, stateId: target } : { kind, frontId: target },
    mission: normalizeAirMission(value.mission) || "superiority",
    wingIds: [...new Set(list(value.wingIds).map(clean).filter(Boolean))],
  };
};
export const normalizeAirMissions = (value) => list(value).map(normalizeAirMissionEntry).filter(Boolean);

const wingsOf = (army, templates) => list(army?.divisions).filter((division) => templates?.[division.template]?.kind === "air");
const assignedIds = (missions) => new Set(missions.flatMap((mission) => mission.wingIds));

// Une opération aérienne, du joueur ou d'une IA :
//   { op: "assign", polity, frontId | stateId, mission, count?, template?, wingIds? }
//   { op: "recall", polity, missionId }
// `context` : { armies, airMissions, fronts, templates }. Renvoie { airMissions, note }.
export const applyAirOp = (op, context) => {
  const missions = normalizeAirMissions(context.airMissions);
  const armies = context.armies ?? {};
  const templates = context.templates ?? templatesFor("1936");
  const polity = clean(op?.polity);
  const owner = Object.keys(armies).find((name) => key(name) === key(polity)) ?? "";
  const refuse = (text) => ({ airMissions: missions, note: { kind: "dropped", text: `airOps — ${text}` } });
  const ok = (text, next) => ({ airMissions: next, note: { kind: "adjusted", text: `airOps — ${text}` } });
  if (!owner) return refuse(`"${polity}" has no air force; the order was ignored.`);
  const kind = clean(op?.op).toLowerCase();
  if (kind === "recall") {
    const mission = missions.find((entry) => entry.id === clean(op.missionId) && key(entry.owner) === key(owner));
    if (!mission) return refuse(`${owner} has no air mission "${clean(op.missionId)}".`);
    return ok(`${owner} recalled ${mission.wingIds.length} wing(s).`, missions.filter((entry) => entry.id !== mission.id));
  }
  if (kind !== "assign") return refuse(`"${kind}" is not an air operation (assign, recall).`);
  const mission = normalizeAirMission(op.mission) || "superiority";
  let zone;
  if (clean(op.frontId)) {
    const front = normalizeFronts(context.fronts).find((entry) => entry.id === clean(op.frontId));
    if (!front || (key(front.owner) !== key(owner) && key(front.enemy) !== key(owner))) return refuse(`${owner} has no front "${clean(op.frontId)}" to fly over.`);
    zone = { kind: "front", frontId: front.id };
  } else if (clean(op.stateId)) {
    zone = { kind: "state", stateId: clean(op.stateId) };
  } else {
    return refuse(`${owner}: an air mission needs a front or a state.`);
  }
  const busy = assignedIds(missions);
  const want = mission === "support" ? "bombardement" : clean(op.template) || "chasse";
  let free = wingsOf(armies[owner], templates).filter((wing) => !busy.has(wing.id));
  if (list(op.wingIds).length) {
    const wanted = new Set(list(op.wingIds).map(clean));
    free = free.filter((wing) => wanted.has(wing.id));
  } else {
    free = free.filter((wing) => wing.template === want).slice(0, Math.max(1, Math.floor(Number(op.count) || 1)));
  }
  if (!free.length) return refuse(`${owner} has no free ${want} wing for this mission.`);
  const same = missions.find((entry) => key(entry.owner) === key(owner) && entry.mission === mission
    && entry.zone.kind === zone.kind && (entry.zone.frontId ?? entry.zone.stateId) === (zone.frontId ?? zone.stateId));
  const next = same
    ? missions.map((entry) => (entry === same ? { ...entry, wingIds: [...entry.wingIds, ...free.map((wing) => wing.id)] } : entry))
    : [...missions, normalizeAirMissionEntry({ id: `air-${slug(owner)}-${missions.length + 1}`, owner, zone, mission, wingIds: free.map((wing) => wing.id) }, missions.length)];
  return ok(`${owner} sent ${free.length} ${want} wing(s) on ${mission}.`, next);
};

// Les forces aériennes d'un camp sur une zone : la chasse (puissance) et les
// escadres de bombardement en appui (nombre pondéré par leur état).
const airPower = (armies, missions, templates, owners, matchesZone) => {
  let fighters = 0; let bombers = 0; const fighterIds = []; const bomberIds = [];
  const byId = new Map();
  for (const [owner, army] of Object.entries(armies ?? {})) for (const division of list(army?.divisions)) byId.set(division.id, { owner, division });
  for (const mission of missions) {
    if (!owners.has(key(mission.owner)) || !matchesZone(mission)) continue;
    for (const id of mission.wingIds) {
      const entry = byId.get(id);
      if (!entry) continue;
      const strength = divisionStrength(entry.division, templates[entry.division.template]).overall
        * (0.4 + 0.6 * clamp(Number(entry.division.organisation ?? 100), 0, 100) / 100);
      if (entry.division.template === "chasse") { fighters += strength; fighterIds.push(id); }
      if (entry.division.template === "bombardement" && mission.mission === "support") { bombers += strength; bomberIds.push(id); }
    }
  }
  return { fighters: round2(fighters), bombers: round2(bombers), fighterIds, bomberIds };
};

// Le ciel d'une bataille. `front` : le front qui attaque (ou un débarquement,
// { owner, enemy }) ; `stateId` : l'état attaqué ; `sideOf(p)` : le camp de p.
// Comptent les escadres au-dessus des fronts des deux adversaires, l'un contre
// l'autre, et celles au-dessus de l'état attaqué.
// Renvoie { superiority, support, attrition, factor, own, enemy }.
export const frontAir = ({ front, stateId = "", armies, airMissions, fronts, templates, sideOf = (p) => [p] }) => {
  const T = AIR_TUNING;
  const missions = normalizeAirMissions(airMissions);
  const line = new Set(normalizeFronts(fronts).filter((entry) => (key(entry.owner) === key(front.owner) && key(entry.enemy) === key(front.enemy))
    || (key(entry.owner) === key(front.enemy) && key(entry.enemy) === key(front.owner))).map((entry) => entry.id));
  const overFront = (mission) => (mission.zone.kind === "front" && line.has(mission.zone.frontId))
    || (Boolean(stateId) && mission.zone.kind === "state" && mission.zone.stateId === stateId);
  const own = airPower(armies, missions, templates, new Set(sideOf(front.owner).map(key)), overFront);
  const enemy = airPower(armies, missions, templates, new Set(sideOf(front.enemy).map(key)), overFront);
  const total = own.fighters + enemy.fighters;
  const superiority = total > 0 ? round2(own.fighters / total) : 0.5;
  const support = round2(Math.min(T.supportCap, own.bombers * T.supportPerWing * (0.5 + superiority)));
  const attrition = round2(Math.min(T.attritionCap, own.bombers * T.attritionPerWing * (0.5 + superiority)));
  const factor = round2(1 + T.superiorityWeight * (superiority - 0.5) + support);
  return { superiority, support, attrition, factor, own, enemy };
};

// Les pertes d'avions d'un saut sur un front : la chasse perd face à la chasse
// adverse, le bombardement face à la chasse adverse (et un peu de DCA). Renvoie
// { [wingId]: loss } (part de l'équipement perdue) et un résumé.
export const airLosses = (air, days = 7) => {
  const T = AIR_TUNING;
  const weeks = Math.max(1 / 7, days / 7);
  const losses = {};
  const share = (mine, theirs) => (mine + theirs > 0 ? theirs / (mine + theirs) : 0);
  const ownFighterLoss = round2(clamp(T.fighterLossPerWeek * weeks * 2 * share(air.own.fighters, air.enemy.fighters), 0, 0.5));
  const enemyFighterLoss = round2(clamp(T.fighterLossPerWeek * weeks * 2 * share(air.enemy.fighters, air.own.fighters), 0, 0.5));
  const ownBomberLoss = round2(clamp(T.bomberLossPerWeek * weeks * (0.3 + (1 - air.superiority)), 0, 0.5));
  for (const id of air.own.fighterIds) losses[id] = ownFighterLoss;
  for (const id of air.enemy.fighterIds) losses[id] = enemyFighterLoss;
  for (const id of air.own.bomberIds) losses[id] = ownBomberLoss;
  return { losses, summary: { ownFighterLoss, enemyFighterLoss, ownBomberLoss } };
};
