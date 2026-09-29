// Phase 7.7 — ce que le panneau Fronts montre et fait, sans React : les ennemis
// avec qui le joueur est en guerre, ses fronts (ligne, cibles, divisions), ses
// divisions libres par gabarit, et l'ordre qu'il donne, appliqué au monde par
// les mêmes règles que ceux des IA (runtime/hoi/fronts.js). Import-free.

import { applyFrontOp, frontLine, normalizeFronts } from "../../runtime/hoi/fronts.js";
import { templatesFor } from "../../runtime/hoi/armies.js";
import { applyAirOp, normalizeAirMissions } from "../../runtime/hoi/air.js";
import { applyNavalOp, normalizeLandings, normalizeNavalMissions } from "../../runtime/hoi/naval.js";
import { atWar, enemiesOf, warsFor } from "../../runtime/worldmap/warRules.js";
import { buildWarMap } from "../../runtime/worldmap/warMap.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);

// La carte vue du panneau : les états du scénario (propriétaires, noms) et les
// données de ravitaillement (voisins), plus les occupations du monde.
export const panelMap = (world, { info = {}, stateOwners = {}, stateNames = {} } = {}) => buildWarMap({
  world,
  info,
  catalog: Object.entries(stateOwners ?? {}).map(([id, country]) => ({ id, country, name: stateNames?.[id] ?? id })),
});

const armyKeyOf = (world, polity) => Object.keys(world?.hoi?.armies ?? {}).find((name) => key(name) === key(polity)) ?? "";

// Le modèle du panneau pour le pays du joueur.
export const frontsPanelModel = (world, player, map) => {
  const owner = armyKeyOf(world, player);
  if (!owner) return null;
  const wars = warsFor(world);
  const templates = templatesFor(world.hoi.series);
  const fronts = normalizeFronts(world.hoi.fronts).filter((front) => key(front.owner) === key(owner));
  const enemies = enemiesOf(wars, owner).map((name) => ({ name, hasFront: fronts.some((front) => key(front.enemy) === key(name)) }));
  const army = world.hoi.armies[owner];
  const free = {};
  for (const division of list(army?.divisions)) {
    if (templates[division.template]?.kind !== "land" || division.frontId || division.encircledDays > 0) continue;
    free[division.template] = (free[division.template] ?? 0) + 1;
  }
  return {
    owner,
    enemies,
    free,
    fronts: fronts.map((front) => {
      const line = map ? frontLine(front, map) : { own: [], enemy: [], pairs: [] };
      return {
        ...front,
        atWar: atWar(wars, owner, front.enemy),
        ownStates: line.own.map((id) => ({ id, name: map?.nameOf(id) ?? id })),
        targets: line.enemy.map((id) => ({ id, name: map?.nameOf(id) ?? id })),
      };
    }),
  };
};

// Phase 7.8 — l'onglet Air : les escadres libres par gabarit, les missions du
// joueur, et les zones où les envoyer (ses fronts, les états qu'ils visent ou
// tiennent).
export const airPanelModel = (world, player, map) => {
  const owner = armyKeyOf(world, player);
  if (!owner) return null;
  const templates = templatesFor(world.hoi.series);
  const missions = normalizeAirMissions(world.hoi.airMissions).filter((mission) => key(mission.owner) === key(owner));
  const busy = new Set(missions.flatMap((mission) => mission.wingIds));
  const free = {};
  for (const division of list(world.hoi.armies[owner]?.divisions)) {
    if (templates[division.template]?.kind !== "air" || busy.has(division.id)) continue;
    free[division.template] = (free[division.template] ?? 0) + 1;
  }
  const fronts = normalizeFronts(world.hoi.fronts).filter((front) => key(front.owner) === key(owner));
  const states = [...new Set(fronts.flatMap((front) => {
    const line = map ? frontLine(front, map) : { own: [], enemy: [] };
    return [...line.enemy, ...line.own];
  }))].map((id) => ({ id, name: map?.nameOf(id) ?? id }));
  const frontName = (id) => { const front = fronts.find((entry) => entry.id === id); return front ? front.enemy : ""; };
  return {
    owner,
    free,
    fronts: fronts.map((front) => ({ id: front.id, enemy: front.enemy })),
    states,
    missions: missions.map((mission) => ({
      ...mission,
      over: mission.zone.kind === "front" ? { kind: "front", enemy: frontName(mission.zone.frontId) } : { kind: "state", name: map?.nameOf(mission.zone.stateId) ?? mission.zone.stateId },
    })),
    losses: world.hoi.lastAircraftLosses?.[owner] ?? {},
  };
};

// Phase 7.8 — l'onglet Mer : les flottes libres, les missions, les zones de mer
// qui bordent ses côtes (et celles de ses ennemis), la maîtrise et les blocus du
// dernier tour, les côtes ennemies où débarquer et les débarquements préparés.
export const navalPanelModel = (world, player, map, seas) => {
  const owner = armyKeyOf(world, player);
  if (!owner || !seas?.zones) return null;
  const templates = templatesFor(world.hoi.series);
  const wars = warsFor(world);
  const enemies = enemiesOf(wars, owner);
  const controllerOf = (id) => map?.controllerOf(id) ?? "";
  const isEnemy = (id) => enemies.some((enemy) => key(enemy) === key(controllerOf(id)));
  const isOwn = (id) => key(controllerOf(id)) === key(owner);
  const missions = normalizeNavalMissions(world.hoi.navalMissions).filter((mission) => key(mission.owner) === key(owner));
  const busy = new Set(missions.flatMap((mission) => mission.fleetIds));
  const army = list(world.hoi.armies[owner]?.divisions);
  const freeFleets = army.filter((division) => templates[division.template]?.kind === "sea" && !busy.has(division.id)).length;
  const onCoast = army.filter((division) => templates[division.template]?.kind === "land" && !division.frontId && !(division.encircledDays > 0)
    && list(seas.stateSeas?.[division.stateId]).length && isOwn(division.stateId)).length;
  const label = (zoneId) => {
    const coast = list(seas.zones[zoneId]?.coastalStates);
    const named = coast.find(isOwn) ?? coast.find(isEnemy) ?? coast[0];
    return named ? (map?.nameOf(named) ?? named) : "";
  };
  const control = world.hoi.seaControl ?? {};
  const zones = Object.entries(seas.zones)
    .map(([zoneId, zone]) => ({ zoneId, own: list(zone.coastalStates).filter(isOwn).length, enemy: list(zone.coastalStates).filter(isEnemy).length }))
    .filter((zone) => zone.own > 0 || zone.enemy > 0)
    .sort((a, b) => b.enemy - a.enemy || b.own - a.own || a.zoneId.localeCompare(b.zoneId))
    .slice(0, 40)
    .map((zone) => ({ ...zone, name: label(zone.zoneId), sea: seas.zones[zone.zoneId]?.name ?? null, control: control[zone.zoneId] ?? null }));
  const coasts = Object.keys(seas.stateSeas ?? {}).filter(isEnemy)
    .map((id) => ({ id, name: map?.nameOf(id) ?? id, owner: controllerOf(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    owner,
    enemies,
    freeFleets,
    onCoast,
    zones,
    coasts,
    missions: missions.map((mission) => ({ ...mission, name: label(mission.zoneId), sea: seas.zones[mission.zoneId]?.name ?? null, control: control[mission.zoneId] ?? null })),
    landings: normalizeLandings(world.hoi.landings).filter((landing) => key(landing.owner) === key(owner)),
    blockades: list(world.hoi.blockades).filter((blockade) => key(blockade.owner) === key(owner)
      || list(blockade.states).some(isOwn)).map((blockade) => ({
      ...blockade, name: label(blockade.zoneId), sea: seas.zones[blockade.zoneId]?.name ?? null, against: key(blockade.owner) !== key(owner),
      stateNames: list(blockade.states).map((id) => map?.nameOf(id) ?? id),
    })),
  };
};

// Les ordres de l'air et de la mer du joueur, par les règles des IA.
export const applyPlayerAirOp = (world, op) => {
  const result = applyAirOp(op, { armies: world?.hoi?.armies ?? {}, airMissions: world?.hoi?.airMissions ?? [], fronts: world?.hoi?.fronts ?? [], templates: templatesFor(world?.hoi?.series) });
  if (result.note.kind === "dropped") return { world, note: result.note };
  return { world: { ...world, hoi: { ...world.hoi, airMissions: result.airMissions } }, note: result.note };
};

export const applyPlayerNavalOp = (world, op, map, seas) => {
  const wars = warsFor(world);
  const result = applyNavalOp(op, {
    armies: world?.hoi?.armies ?? {},
    navalMissions: world?.hoi?.navalMissions ?? [],
    landings: world?.hoi?.landings ?? [],
    seas,
    templates: templatesFor(world?.hoi?.series),
    atWar: (a, b) => atWar(wars, a, b),
    controllerOf: (id) => map?.controllerOf(id) ?? "",
    nameOf: (id) => map?.nameOf(id) ?? id,
    seaControl: world?.hoi?.seaControl ?? {},
    date: clean(world?.hoi?.lastDate),
  });
  if (result.note.kind === "dropped") return { world, note: result.note };
  return { world: { ...world, hoi: { ...world.hoi, navalMissions: result.navalMissions, landings: result.landings, armies: result.armies } }, note: result.note };
};

// Un ordre du joueur appliqué au monde : { world, note } (note.kind "dropped" si refusé).
export const applyPlayerFrontOp = (world, op, map) => {
  const wars = warsFor(world);
  const result = applyFrontOp(op, {
    armies: world?.hoi?.armies ?? {},
    fronts: world?.hoi?.fronts ?? [],
    atWar: (a, b) => atWar(wars, a, b),
    templates: templatesFor(world?.hoi?.series),
    date: clean(world?.hoi?.lastDate),
    map,
  });
  if (result.note.kind === "dropped") return { world, note: result.note };
  return { world: { ...world, hoi: { ...world.hoi, fronts: result.fronts, armies: result.armies } }, note: result.note };
};
