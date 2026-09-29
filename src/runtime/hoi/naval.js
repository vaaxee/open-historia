// Couche HOI4 — la marine et les débarquements (phase 7.8).
//
// Run tests: node --test src/runtime/hoi/naval.test.js
// Import-free à part les modules purs de la couche.
//
// Des flottes (gabarit « flotte », armies.js) sont affectées à une zone de mer de
// la carte (20000–29999, scripts/worldmap/seas.mjs) pour une mission :
//   - escort   : escorte des convois ; tient la zone ouverte au ravitaillement de
//                son camp (un blocus contesté ne coupe rien) ;
//   - blockade : blocus ; si son camp domine la zone, les côtes et ports ennemis
//                qui la bordent perdent leur ravitaillement par mer (supply.js) ;
//   - support  : appui d'un débarquement dans la zone.
// Quand deux camps en guerre ont des flottes dans une même zone, le moteur résout
// le combat naval : puissance des flottes (état, organisation, expérience), ±15 %
// de hasard tiré d'une graine, pertes en navires, et la zone dominée (rapport de
// 1,25) ou contestée. La fiche du combat est gardée comme celle d'une bataille.
//
// Un débarquement : des divisions terrestres libres, sur une côte de leur pays,
// visent un état côtier ennemi bordé par une zone que l'ennemi ne domine pas. Le
// moteur de combat (combat.js) livre la bataille de la tête de pont au tour
// suivant, l'attaque réduite par le passage de la mer et relevée par l'appui naval.
//
// Formes, dans world.hoi :
//   navalMissions : [{ id, owner, zoneId, mission, fleetIds }]
//   landings      : [{ id, owner, enemy, zoneId, stateId, stateName, divisionIds, date }]
//   seaControl    : { [zoneId]: { owners: [], contested } }   (dernier tour)
//   blockades     : [{ owner, zoneId, states: [] }]            (dernier tour)

import { divisionStrength, templatesFor } from "./armies.js";
import { seededRandom } from "./combat.js";
import { placeNameFor } from "../worldmap/placeNames.js";

export const NAVAL_MISSIONS = Object.freeze(["escort", "blockade", "support"]);
export const NAVAL_TUNING = Object.freeze({
  dice: 0.15,
  // Rapport de puissance à partir duquel un camp domine une zone disputée.
  controlRatio: 1.25,
  // Les flottes d'escorte se battent chez elles.
  escortBonus: 1.2,
  // Pertes (part des navires) par semaine, à forces égales ; organisation perdue.
  lossPerWeek: 0.04,
  organisationLoss: Object.freeze({ winner: 15, loser: 30 }),
  // Le débarquement (l'attaque qui passe la mer : combat.js) : l'appui par flotte, plafonné.
  supportPerFleet: 0.1,
  supportCap: 0.4,
  maxLandingDivisions: 6,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const slug = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const MISSION_ALIASES = Object.freeze({
  escort: "escort", escorte: "escort", convoy: "escort", convois: "escort", patrol: "escort", patrouille: "escort",
  blockade: "blockade", blocus: "blockade",
  support: "support", appui: "support", landing: "support", debarquement: "support", "débarquement": "support",
});
export const normalizeNavalMission = (value) => MISSION_ALIASES[clean(value).toLowerCase()] ?? "";

export const normalizeNavalMissionEntry = (value, index = 0) => {
  if (!isObject(value)) return null;
  const owner = clean(value.owner);
  const zoneId = clean(value.zoneId);
  if (!owner || !zoneId) return null;
  return {
    id: clean(value.id) || `sea-${slug(owner)}-${index + 1}`,
    owner,
    zoneId,
    mission: normalizeNavalMission(value.mission) || "escort",
    fleetIds: [...new Set(list(value.fleetIds).map(clean).filter(Boolean))],
  };
};
export const normalizeNavalMissions = (value) => list(value).map(normalizeNavalMissionEntry).filter(Boolean);

export const normalizeLanding = (value, index = 0) => {
  if (!isObject(value)) return null;
  const owner = clean(value.owner);
  const stateId = clean(value.stateId);
  const divisionIds = [...new Set(list(value.divisionIds).map(clean).filter(Boolean))];
  if (!owner || !stateId || !divisionIds.length) return null;
  return {
    id: clean(value.id) || `landing-${slug(owner)}-${index + 1}`,
    owner,
    enemy: clean(value.enemy),
    zoneId: clean(value.zoneId),
    stateId,
    stateName: clean(value.stateName) || stateId,
    divisionIds,
    date: clean(value.date),
  };
};
export const normalizeLandings = (value) => list(value).map(normalizeLanding).filter(Boolean);

const fleetsOf = (army, templates) => list(army?.divisions).filter((division) => templates?.[division.template]?.kind === "sea");
const busyFleets = (missions) => new Set(missions.flatMap((mission) => mission.fleetIds));
const ownerIn = (armies, polity) => Object.keys(armies ?? {}).find((name) => key(name) === key(polity)) ?? "";

// Qui domine une zone (le dernier tour) : { owners, contested } ou null.
const controlOf = (seaControl, zoneId) => (isObject(seaControl?.[zoneId]) ? seaControl[zoneId] : null);

// L'ennemi domine-t-il la zone pour `polity` ?
export const enemyDominates = (seaControl, zoneId, polity, atWar = () => false) => {
  const control = controlOf(seaControl, zoneId);
  return Boolean(control && !control.contested && list(control.owners).some((owner) => atWar(owner, polity)));
};

// Une opération navale, du joueur ou d'une IA :
//   { op: "assign", polity, zoneId, mission, count?, fleetIds? }
//   { op: "recall", polity, missionId }
//   { op: "land", polity, stateId, zoneId?, count?, divisionIds? }
// `context` : { armies, navalMissions, landings, seas: { zones, stateSeas },
// templates, atWar(a, b), controllerOf(id), nameOf(id), seaControl, date }.
// Renvoie { navalMissions, landings, armies, note }.
export const applyNavalOp = (op, context) => {
  const missions = normalizeNavalMissions(context.navalMissions);
  const landings = normalizeLandings(context.landings);
  const armies = context.armies ?? {};
  const templates = context.templates ?? templatesFor("1936");
  const seas = context.seas ?? { zones: {}, stateSeas: {} };
  const atWar = context.atWar ?? (() => false);
  const controllerOf = context.controllerOf ?? (() => "");
  const owner = ownerIn(armies, op?.polity);
  const same = { navalMissions: missions, landings, armies };
  const refuse = (text) => ({ ...same, note: { kind: "dropped", text: `navalOps — ${text}` } });
  const ok = (text, next) => ({ ...same, ...next, note: { kind: "adjusted", text: `navalOps — ${text}` } });
  if (!owner) return refuse(`"${clean(op?.polity)}" has no tracked forces; the order was ignored.`);
  const kind = clean(op?.op).toLowerCase();

  if (kind === "recall") {
    const mission = missions.find((entry) => entry.id === clean(op.missionId) && key(entry.owner) === key(owner));
    if (!mission) return refuse(`${owner} has no naval mission "${clean(op.missionId)}".`);
    return ok(`${owner} recalled ${mission.fleetIds.length} fleet(s).`, { navalMissions: missions.filter((entry) => entry.id !== mission.id) });
  }

  if (kind === "assign") {
    const zoneId = clean(op.zoneId);
    if (!seas.zones?.[zoneId]) return refuse(`${owner}: "${zoneId}" is not a sea zone of this map.`);
    const mission = normalizeNavalMission(op.mission) || "escort";
    const busy = busyFleets(missions);
    let free = fleetsOf(armies[owner], templates).filter((fleet) => !busy.has(fleet.id));
    if (list(op.fleetIds).length) {
      const wanted = new Set(list(op.fleetIds).map(clean));
      free = free.filter((fleet) => wanted.has(fleet.id));
    } else {
      free = free.slice(0, Math.max(1, Math.floor(num(op.count, 1))));
    }
    if (!free.length) return refuse(`${owner} has no free fleet for this mission.`);
    const existing = missions.find((entry) => key(entry.owner) === key(owner) && entry.zoneId === zoneId && entry.mission === mission);
    const next = existing
      ? missions.map((entry) => (entry === existing ? { ...entry, fleetIds: [...entry.fleetIds, ...free.map((fleet) => fleet.id)] } : entry))
      : [...missions, normalizeNavalMissionEntry({ id: `sea-${slug(owner)}-${zoneId}-${mission}`, owner, zoneId, mission, fleetIds: free.map((fleet) => fleet.id) })];
    return ok(`${owner} sent ${free.length} fleet(s) on ${mission} in sea zone ${zoneId}.`, { navalMissions: next });
  }

  if (kind === "land") {
    const stateId = clean(op.stateId);
    const enemy = clean(controllerOf(stateId));
    if (!enemy || !atWar(owner, enemy)) return refuse(`${owner} can only land on a state held by an enemy at war.`);
    const zonesOfState = list(seas.stateSeas?.[stateId]).map(String);
    if (!zonesOfState.length) return refuse(`${clean(context.nameOf?.(stateId)) || stateId} has no coast to land on.`);
    // La zone : celle qu'on donne, sinon celle où l'on a de l'appui, sinon la
    // première que l'ennemi ne domine pas.
    const open = zonesOfState.filter((zoneId) => !enemyDominates(context.seaControl, zoneId, owner, atWar));
    const asked = clean(op.zoneId);
    if (asked && !zonesOfState.includes(asked)) return refuse(`sea zone ${asked} does not touch ${clean(context.nameOf?.(stateId)) || stateId}.`);
    if (asked && !open.includes(asked)) return refuse(`the enemy dominates sea zone ${asked}: no landing there.`);
    if (!open.length) return refuse(`the enemy dominates every sea zone off ${clean(context.nameOf?.(stateId)) || stateId}: no landing.`);
    const supported = new Set(missions.filter((entry) => key(entry.owner) === key(owner) && entry.mission === "support").map((entry) => entry.zoneId));
    const zoneId = asked || open.find((id) => supported.has(id)) || open[0];
    if (landings.some((entry) => key(entry.owner) === key(owner) && entry.stateId === stateId)) return refuse(`${owner} already prepares a landing there.`);
    // Les divisions : terrestres, libres, sur une côte que leur pays tient.
    const onCoast = (division) => list(seas.stateSeas?.[division.stateId]).length > 0 && key(controllerOf(division.stateId)) === key(owner);
    let chosen = list(armies[owner]?.divisions).filter((division) => templates?.[division.template]?.kind === "land"
      && !division.frontId && !(division.encircledDays > 0) && onCoast(division));
    if (list(op.divisionIds).length) {
      const wanted = new Set(list(op.divisionIds).map(clean));
      chosen = chosen.filter((division) => wanted.has(division.id));
    }
    chosen = chosen.slice(0, clamp(Math.floor(num(op.count, 3)), 1, NAVAL_TUNING.maxLandingDivisions));
    if (!chosen.length) return refuse(`${owner} has no free division on its own coast to embark.`);
    const landing = normalizeLanding({
      id: `landing-${slug(owner)}-${stateId}`,
      owner, enemy, zoneId, stateId, stateName: clean(context.nameOf?.(stateId)) || stateId,
      divisionIds: chosen.map((division) => division.id), date: clean(context.date),
    });
    const ids = new Set(landing.divisionIds);
    const army = armies[owner];
    return ok(`${owner} embarks ${chosen.length} division(s) to land on ${landing.stateName} next turn.`, {
      landings: [...landings, landing],
      // Embarquées : plus libres pour un front jusqu'à la bataille.
      armies: { ...armies, [owner]: { ...army, divisions: list(army.divisions).map((division) => (ids.has(division.id) ? { ...division, frontId: landing.id } : division)) } },
    });
  }

  return refuse(`"${kind}" is not a naval operation (assign, recall, land).`);
};

// La puissance d'une flotte : son état, son organisation, son expérience.
const fleetPower = (fleet, templates) => {
  const strength = divisionStrength(fleet, templates?.[fleet.template]).overall;
  const organisation = 0.3 + 0.7 * clamp(num(fleet.organisation, 100), 0, 100) / 100;
  const experience = 1 + 0.5 * clamp(num(fleet.experience), 0, 1);
  return strength * organisation * experience;
};

// Le nom d'une zone pour une fiche : « au large de <premier état côtier> ».
export const zoneLabel = (zoneId, seas, nameOf = (id) => id) => {
  const coast = list(seas?.zones?.[zoneId]?.coastalStates)[0];
  return coast ? clean(nameOf(coast)) || coast : "";
};

// Les combats navals et la maîtrise des mers d'un saut. `context` :
//   world, seas, atWar(a, b), controllerOf(id), nameOf(id), date, days, seed
// Renvoie { control, battles, outcome, blockades }. Ne modifie rien.
export const resolveNaval = ({ world, seas, atWar = () => false, controllerOf = () => "", nameOf = (id) => id, date = "", days = 7, seed = "" } = {}) => {
  const T = NAVAL_TUNING;
  const hoi = world?.hoi ?? {};
  const templates = templatesFor(hoi.series);
  const missions = normalizeNavalMissions(hoi.navalMissions);
  const byId = new Map();
  for (const [owner, army] of Object.entries(hoi.armies ?? {})) for (const division of list(army?.divisions)) byId.set(division.id, { owner, division });
  const control = {};
  const battles = [];
  const outcome = {};
  const weeks = Math.max(1 / 7, num(days, 7) / 7);
  const zones = [...new Set(missions.map((mission) => mission.zoneId))].sort();
  for (const zoneId of zones) {
    const here = missions.filter((mission) => mission.zoneId === zoneId);
    // Les flottes présentes, avec leur puissance (l'escorte se bat chez elle).
    const fleets = here.flatMap((mission) => mission.fleetIds.map((id) => byId.get(id)).filter((entry) => entry && key(entry.owner) === key(mission.owner)
      && templates[entry.division.template]?.kind === "sea").map((entry) => ({ ...entry, mission: mission.mission,
      power: fleetPower(entry.division, templates) * (mission.mission === "escort" ? T.escortBonus : 1) })));
    if (!fleets.length) continue;
    const powerOf = (owners) => fleets.filter((fleet) => owners.includes(fleet.owner)).reduce((sum, fleet) => sum + fleet.power, 0);
    const owners = [...new Set(fleets.map((fleet) => fleet.owner))];
    const lead = [...owners].sort((a, b) => powerOf([b]) - powerOf([a]) || a.localeCompare(b))[0];
    const sideA = owners.filter((owner) => !atWar(owner, lead));
    const sideB = owners.filter((owner) => atWar(owner, lead));
    if (!sideB.length) { control[zoneId] = { owners: sideA, contested: false }; continue; }
    const dice = (side) => 1 + T.dice * (2 * seededRandom(`${seed}|${date}|${zoneId}|${side}`) - 1);
    const powerA = round2(powerOf(sideA) * dice("a"));
    const powerB = round2(powerOf(sideB) * dice("b"));
    const ratio = powerB > 0 ? round2(powerA / powerB) : 99;
    const result = ratio >= T.controlRatio ? "a" : ratio <= 1 / T.controlRatio ? "b" : "contested";
    control[zoneId] = result === "contested" ? { owners: [], contested: true } : { owners: result === "a" ? sideA : sideB, contested: false };
    const sunk = { a: 0, b: 0 };
    const men = { a: 0, b: 0 };
    const counts = { a: 0, b: 0 };
    for (const fleet of fleets) {
      const side = sideA.includes(fleet.owner) ? "a" : "b";
      const mine = side === "a" ? powerA : powerB;
      const theirs = side === "a" ? powerB : powerA;
      const loss = round2(clamp(T.lossPerWeek * weeks * 2 * (theirs / Math.max(0.01, mine + theirs)) * 2, 0, 0.6));
      const won = result === side;
      const entry = (outcome[fleet.division.id] ??= { loss: 0, organisation: 0, morale: 0, experience: 0, stateId: "", removed: false });
      entry.loss = round2(1 - (1 - entry.loss) * (1 - loss));
      entry.organisation -= won ? T.organisationLoss.winner : T.organisationLoss.loser;
      entry.morale += won ? 5 : result === "contested" ? 0 : -10;
      entry.experience += 0.03;
      sunk[side] += num(fleet.division.equipment?.navires) * loss;
      men[side] += Math.round(num(fleet.division.men) * loss);
      counts[side] += 1;
    }
    battles.push({
      id: `naval-${date}-${zoneId}`,
      kind: "naval",
      date,
      zoneId,
      zoneName: zoneLabel(zoneId, seas, nameOf),
      attacker: sideA[0],
      defender: sideB[0],
      sides: { a: sideA, b: sideB },
      fleets: counts,
      power: { attack: powerA, defense: powerB, ratio },
      losses: { attacker: men.a, defender: men.b },
      sunk: { attacker: round2(sunk.a), defender: round2(sunk.b) },
      result: result === "a" ? "won" : result === "b" ? "lost" : "contested",
    });
  }
  // Les blocus qui tiennent : la zone est au camp de la flotte de blocus.
  const blockades = [];
  for (const mission of missions.filter((entry) => entry.mission === "blockade")) {
    const zone = control[mission.zoneId];
    if (!zone || zone.contested || !zone.owners.some((owner) => key(owner) === key(mission.owner))) continue;
    const states = list(seas?.zones?.[mission.zoneId]?.coastalStates).filter((id) => {
      const holder = clean(controllerOf(id));
      return holder && atWar(mission.owner, holder);
    });
    if (states.length) blockades.push({ owner: mission.owner, zoneId: mission.zoneId, states });
  }
  return { control, battles, outcome, blockades };
};

// L'appui naval d'un débarquement dans une zone, pour `owner` : 0 → supportCap.
export const landingSupport = (world, zoneId, owner, seaControl, atWar = () => false) => {
  const T = NAVAL_TUNING;
  if (enemyDominates(seaControl, zoneId, owner, atWar)) return 0;
  const templates = templatesFor(world?.hoi?.series);
  const byId = new Map(list(world?.hoi?.armies?.[ownerIn(world?.hoi?.armies, owner)]?.divisions).map((division) => [division.id, division]));
  const fleets = normalizeNavalMissions(world?.hoi?.navalMissions)
    .filter((mission) => key(mission.owner) === key(owner) && mission.zoneId === clean(zoneId) && mission.mission === "support")
    .flatMap((mission) => mission.fleetIds.map((id) => byId.get(id)).filter(Boolean));
  return round2(Math.min(T.supportCap, fleets.reduce((sum, fleet) => sum + fleetPower(fleet, templates), 0) * T.supportPerFleet));
};

// L'événement du moteur pour un combat naval, dans la langue du tour.
export const navalBattleEvent = (battle, { language = "en", nameOf = (name) => name } = {}) => {
  const fr = language === "fr";
  const a = nameOf(battle.attacker);
  const b = nameOf(battle.defender);
  const place = placeNameFor(battle.zoneName, fr ? "fr" : "en");
  const where = place ? (fr ? `au large de ${place}` : `off ${place}`) : (fr ? `en haute mer (zone ${battle.zoneId})` : `on the high seas (zone ${battle.zoneId})`);
  const winner = battle.result === "won" ? a : battle.result === "lost" ? b : "";
  const sunk = (value) => Math.round(num(value) * 10) / 10;
  const title = fr ? `Combat naval ${where}` : `Naval battle ${where}`;
  const description = fr
    ? `Les flottes de ${a} (${battle.fleets.a}) et de ${b} (${battle.fleets.b}) s'affrontent ${where}. Navires perdus : ${sunk(battle.sunk.attacker)} pour ${a}, ${sunk(battle.sunk.defender)} pour ${b}. ${winner ? `${winner} garde la maîtrise de la zone.` : "La zone reste disputée."}`
    : `The fleets of ${a} (${battle.fleets.a}) and ${b} (${battle.fleets.b}) clash ${where}. Ships lost: ${sunk(battle.sunk.attacker)} for ${a}, ${sunk(battle.sunk.defender)} for ${b}. ${winner ? `${winner} holds the zone.` : "The zone stays contested."}`;
  return {
    date: battle.date, title, description, kind: "military", importance: "normal", notable: false, source: "engine",
    combatants: [battle.attacker, battle.defender], battle, battleId: battle.id, impacts: {},
  };
};

// Les fiches navales pour le prompt du tour.
export const describeNaval = ({ battles = [], blockades = [] } = {}) => [
  ...list(battles).map((battle) => `- ${battle.date} sea zone ${battle.zoneId}${battle.zoneName ? ` (off ${battle.zoneName})` : ""}: ${battle.sides.a.join(", ")} (${battle.fleets.a} fleets) against ${battle.sides.b.join(", ")} (${battle.fleets.b}) — power ${battle.power.attack} vs ${battle.power.defense} → ${battle.result.toUpperCase()}; ships lost ${Math.round(battle.sunk.attacker * 10) / 10} / ${Math.round(battle.sunk.defender * 10) / 10}.`),
  ...list(blockades).map((blockade) => `- BLOCKADE by ${blockade.owner} in sea zone ${blockade.zoneId}: ${blockade.states.length} enemy coastal state(s) cut from sea supply.`),
].join("\n");

// Les états coupés de leur ravitaillement par mer (supplyMap.js).
export const blockadedStates = (world) => new Set(list(world?.hoi?.blockades).flatMap((blockade) => list(blockade?.states).map(clean)));

// Les ordres navals et aériens par défaut d'un pays IA en guerre, pour ses seules
// forces libres (aucune mission) : la chasse au-dessus du front le plus chargé, le
// bombardement en appui d'un front qui attaque (le plus chargé sinon) ; les flottes
// en blocus de la zone de contact la plus riche en côtes ennemies si elles y sont
// les plus fortes, en escorte de leurs côtes sinon. Renvoie des opérations
// { kind: "air" | "naval", op } à appliquer.
export const defaultAirNavalOps = (polity, { armies, fronts = [], navalMissions = [], airMissions = [], seas, templates, enemies = [], controllerOf = () => "" } = {}) => {
  const owner = ownerIn(armies, polity);
  if (!owner || !enemies.length) return [];
  const army = armies[owner];
  const ops = [];
  const busyAir = new Set(list(airMissions).flatMap((mission) => list(mission?.wingIds)));
  const wings = list(army?.divisions).filter((division) => templates?.[division.template]?.kind === "air" && !busyAir.has(division.id));
  const own = list(fronts).filter((front) => key(front.owner) === key(owner) && enemies.some((enemy) => key(enemy) === key(front.enemy)));
  if (wings.length && own.length) {
    const byLoad = [...own].sort((a, b) => list(b.divisionIds).length - list(a.divisionIds).length || a.id.localeCompare(b.id));
    const attacking = byLoad.find((front) => front.posture !== "hold") ?? byLoad[0];
    const fighters = wings.filter((wing) => wing.template === "chasse").length;
    const bombers = wings.filter((wing) => wing.template === "bombardement").length;
    if (fighters) ops.push({ kind: "air", op: { op: "assign", polity: owner, frontId: byLoad[0].id, mission: "superiority", count: fighters } });
    if (bombers) ops.push({ kind: "air", op: { op: "assign", polity: owner, frontId: attacking.id, mission: "support", count: bombers } });
  }
  const busySea = busyFleets(normalizeNavalMissions(navalMissions));
  const fleets = list(army?.divisions).filter((division) => templates?.[division.template]?.kind === "sea" && !busySea.has(division.id));
  if (fleets.length && seas?.zones) {
    const isEnemy = (id) => enemies.some((enemy) => key(enemy) === key(controllerOf(id)));
    const isOwn = (id) => key(controllerOf(id)) === key(owner);
    const contact = Object.entries(seas.zones)
      .map(([zoneId, zone]) => ({ zoneId, enemy: list(zone.coastalStates).filter(isEnemy).length, own: list(zone.coastalStates).filter(isOwn).length }))
      .filter((zone) => zone.enemy > 0 && zone.own > 0)
      .sort((a, b) => b.enemy - a.enemy || a.zoneId.localeCompare(b.zoneId));
    const enemyFleets = enemies.reduce((sum, enemy) => sum + fleetsOf(armies[ownerIn(armies, enemy)], templates).length, 0);
    if (contact.length) {
      const mission = fleets.length > enemyFleets ? "blockade" : "escort";
      ops.push({ kind: "naval", op: { op: "assign", polity: owner, zoneId: contact[0].zoneId, mission, count: fleets.length } });
    }
  }
  return ops;
};
