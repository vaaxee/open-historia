// Phase 7.3 — les fronts au tour, sur la carte mondiale.
//
// Après les impacts du tour : les ordres de front des pays IA (economyOps
// « front ») sont appliqués avec les mêmes règles que ceux du joueur, un front
// dont la guerre est finie se ferme, et chaque front redéploie ses divisions sur
// sa ligne, qui a pu bouger. Pur : renvoie le monde et les notes du reçu.

import { applyFrontOps, deployFront, frontLine, frontOpsFromEconomyOp, normalizeFronts } from "../hoi/fronts.js";
import { normalizeEconomyOp } from "../hoi/economyOps.js";
import { templatesFor } from "../hoi/armies.js";
import { applyAirOp, normalizeAirMissions } from "../hoi/air.js";
import { applyNavalOp, defaultAirNavalOps, enemyDominates, normalizeLandings, normalizeNavalMissions } from "../hoi/naval.js";
import { atWar, warsFor } from "./warRules.js";

const list = (value) => (Array.isArray(value) ? value : []);

// `seas` (7.8) : { zones, stateSeas } de la carte, ou null (pas de marine).
// `orders` (7.9) : les ordres du décideur local, [{ kind: "front" | "air" |
// "naval", op }], appliqués après ceux des événements et avant les défauts.
export const applyFrontsForTurn = (world, { events = [], map, date = "", player = "", seas = null, orders = [] } = {}) => {
  if (!world?.hoi?.armies || !map) return { world, notes: [] };
  const wars = warsFor(world);
  const context = {
    armies: world.hoi.armies,
    fronts: normalizeFronts(world.hoi.fronts),
    atWar: (a, b) => atWar(wars, a, b),
    templates: templatesFor(world.hoi.series),
    date,
    map,
  };
  const notes = [];
  // 1. Les ordres des IA, événement par événement.
  for (const event of list(events)) {
    for (const raw of list(event?.impacts?.economyOps)) {
      const op = normalizeEconomyOp(raw);
      if (op?.op !== "front") continue;
      const result = applyFrontOps(frontOpsFromEconomyOp(op, context.fronts), context);
      context.fronts = result.fronts;
      context.armies = result.armies;
      for (const note of result.notes) notes.push({ kind: note.kind, text: `${event?.title ? `Event "${event.title}": ` : ""}${note.text}` });
    }
  }
  // 1 bis. Les ordres de front du décideur local (Jev).
  for (const order of list(orders)) {
    if (order?.kind !== "front") continue;
    const result = applyFrontOps([order.op], context);
    context.fronts = result.fronts;
    context.armies = result.armies;
    for (const note of result.notes) notes.push({ kind: note.kind, text: `Local decider: ${note.text}` });
  }
  // 2. Un front sans guerre se ferme ; ses divisions sont libérées.
  const open = [];
  for (const front of context.fronts) {
    if (atWar(wars, front.owner, front.enemy)) { open.push(front); continue; }
    const army = context.armies[front.owner];
    if (army) {
      context.armies = { ...context.armies, [front.owner]: { ...army, divisions: list(army.divisions).map((division) => (division.frontId === front.id ? { ...division, frontId: "" } : division)) } };
    }
    notes.push({ kind: "adjusted", text: `frontOps — ${front.owner}'s front against ${front.enemy} closed: the two are no longer at war.` });
  }
  // 3. La défense par défaut : un pays qui n'est pas le joueur, en guerre avec un
  // voisin contre qui il n'a pas de front, en ouvre un pour tenir et y envoie ses
  // divisions terrestres libres, partagées entre ses ennemis. Sans cela, faute
  // d'ordre de l'IA, ses divisions restaient à la capitale et chaque état
  // frontalier ne défendait que sa garnison. Le joueur, lui, décide seul.
  context.fronts = open;
  for (const owner of Object.keys(context.armies)) {
    if (player && owner.toLowerCase() === String(player).toLowerCase()) continue;
    const enemies = [...new Set(list(wars)
      .filter((war) => war.status === "active" && (list(war.sideA).includes(owner) || list(war.sideB).includes(owner)))
      .flatMap((war) => (list(war.sideA).includes(owner) ? list(war.sideB) : list(war.sideA))))];
    const missing = enemies.filter((enemy) => !context.fronts.some((front) => front.owner === owner && front.enemy === enemy));
    if (!missing.length) continue;
    const free = list(context.armies[owner]?.divisions).filter((division) => context.templates[division.template]?.kind === "land" && !division.frontId && !(division.encircledDays > 0)).length;
    const share = Math.max(1, Math.floor(free / missing.length));
    for (const enemy of missing) {
      const created = applyFrontOps([
        { op: "create", polity: owner, enemy, posture: "hold" },
        ...(free ? [{ op: "assign", polity: owner, enemy, count: share }] : []),
      ], context);
      if (created.fronts.length === context.fronts.length) continue; // no border: nothing to hold
      context.fronts = created.fronts;
      context.armies = created.armies;
      notes.push({ kind: "adjusted", text: `frontOps — ${owner} had no front against ${enemy}; the engine opened one to hold its border${free ? `, with ${Math.min(share, free)} division(s)` : ""}.` });
    }
  }

  // 4. Un axe pris est atteint : il s'efface, le joueur ou l'IA en choisit un autre.
  context.fronts = context.fronts.map((front) => (front.axis && map.controllerOf(front.axis) === front.owner
    ? (notes.push({ kind: "adjusted", text: `frontOps — ${front.owner}'s axis ${front.axisName || front.axis} is taken; the front has no axis until a new one is chosen.` }), { ...front, axis: "", axisName: "" })
    : front));

  // 5. Chaque front redéploie ses divisions sur sa ligne du moment.
  let armies = context.armies;
  for (const front of context.fronts) {
    if (!armies[front.owner]) continue;
    armies = { ...armies, [front.owner]: deployFront(armies[front.owner], front, frontLine(front, map)) };
  }

  // 6. Phase 7.8 : l'aviation et la marine. Les missions dont le front est fermé,
  // ou dont les escadres et flottes ont disparu, s'effacent ; les ordres « air »
  // et « naval » des IA s'appliquent ; un pays IA en guerre envoie ses forces
  // libres par défaut (naval.js defaultAirNavalOps).
  const sea = { armies, fronts: context.fronts, airMissions: [], navalMissions: [], landings: normalizeLandings(world.hoi.landings) };
  const alive = new Set(Object.values(armies).flatMap((army) => list(army?.divisions).map((division) => division.id)));
  const openFronts = new Set(context.fronts.map((front) => front.id));
  sea.airMissions = normalizeAirMissions(world.hoi.airMissions)
    .map((mission) => ({ ...mission, wingIds: mission.wingIds.filter((id) => alive.has(id)) }))
    .filter((mission) => mission.wingIds.length && (mission.zone.kind !== "front" || openFronts.has(mission.zone.frontId)));
  sea.navalMissions = normalizeNavalMissions(world.hoi.navalMissions)
    .map((mission) => ({ ...mission, fleetIds: mission.fleetIds.filter((id) => alive.has(id)) }))
    .filter((mission) => mission.fleetIds.length && (!seas || seas.zones?.[mission.zoneId]));
  const enemiesOf = (owner) => [...new Set(list(wars)
    .filter((war) => war.status === "active" && (list(war.sideA).includes(owner) || list(war.sideB).includes(owner)))
    .flatMap((war) => (list(war.sideA).includes(owner) ? list(war.sideB) : list(war.sideA))))];
  const navalContext = () => ({
    armies: sea.armies, navalMissions: sea.navalMissions, landings: sea.landings, seas, templates: context.templates,
    atWar: context.atWar, controllerOf: map.controllerOf, nameOf: map.nameOf, seaControl: world.hoi.seaControl, date,
  });
  const run = (kind, op, prefix = "") => {
    if (kind === "air") {
      const result = applyAirOp(op, { armies: sea.armies, airMissions: sea.airMissions, fronts: context.fronts, templates: context.templates });
      sea.airMissions = result.airMissions;
      notes.push({ kind: result.note.kind, text: `${prefix}${result.note.text}` });
      return;
    }
    if (!seas) { notes.push({ kind: "dropped", text: `${prefix}navalOps — this map has no sea zones; the order was ignored.` }); return; }
    const result = applyNavalOp(op, navalContext());
    sea.navalMissions = result.navalMissions;
    sea.landings = result.landings;
    sea.armies = result.armies;
    notes.push({ kind: result.note.kind, text: `${prefix}${result.note.text}` });
  };
  for (const event of list(events)) {
    for (const raw of list(event?.impacts?.economyOps)) {
      const op = normalizeEconomyOp(raw);
      if (op?.op !== "air" && op?.op !== "naval") continue;
      const prefix = event?.title ? `Event "${event.title}": ` : "";
      const orders = mapOrdersFromEconomyOp(op, { fronts: context.fronts, seas, map, armies: sea.armies, seaControl: world.hoi.seaControl, atWar: context.atWar });
      if (!orders.length) { notes.push({ kind: "dropped", text: `${prefix}${op.op}Ops — ${op.polity} has nothing to send against ${op.enemy} (no front or no shared sea).` }); continue; }
      for (const order of orders) run(order.kind, order.op, prefix);
    }
  }
  for (const order of list(orders)) if (order?.kind === "air" || order?.kind === "naval") run(order.kind, order.op, "Local decider: ");
  for (const owner of Object.keys(sea.armies)) {
    if (player && owner.toLowerCase() === String(player).toLowerCase()) continue;
    const ops = defaultAirNavalOps(owner, {
      armies: sea.armies, fronts: context.fronts, airMissions: sea.airMissions, navalMissions: sea.navalMissions,
      seas, templates: context.templates, enemies: enemiesOf(owner), controllerOf: map.controllerOf,
    });
    for (const order of ops) run(order.kind, order.op);
  }
  return {
    world: { ...world, hoi: { ...world.hoi, armies: sea.armies, fronts: context.fronts, airMissions: sea.airMissions, navalMissions: sea.navalMissions, landings: sea.landings } },
    notes,
  };
};

// L'ordre « air » ou « naval » d'une IA (economyOps : { polity, enemy, mission,
// count }) devient les opérations qu'il résume, le moteur choisissant le front
// (le plus chargé contre cet ennemi) ou la zone de mer (celle que bordent le plus
// de côtes ennemies et au moins une des siennes), et la côte d'un débarquement
// (la moins défendue, sur une zone que l'ennemi ne domine pas).
export const mapOrdersFromEconomyOp = (op, { fronts = [], seas = null, map, armies = {}, seaControl = {}, atWar = () => false } = {}) => {
  const key = (value) => String(value ?? "").toLowerCase();
  const owner = Object.keys(armies).find((name) => key(name) === key(op.polity)) ?? op.polity;
  const enemy = op.enemy;
  if (op.op === "air") {
    const front = normalizeFronts(fronts).filter((entry) => key(entry.owner) === key(owner) && key(entry.enemy) === key(enemy))
      .sort((a, b) => b.divisionIds.length - a.divisionIds.length)[0];
    if (!front) return [];
    const mission = op.mission === "support" ? "support" : "superiority";
    return [{ kind: "air", op: { op: "assign", polity: owner, frontId: front.id, mission, count: op.count ?? 99 } }];
  }
  if (!seas?.zones) return [];
  const isEnemy = (id) => key(map.controllerOf(id)) === key(enemy);
  const isOwn = (id) => key(map.controllerOf(id)) === key(owner);
  if (op.mission === "landing") {
    const defenders = new Map();
    for (const [name, army] of Object.entries(armies)) {
      if (key(name) !== key(enemy)) continue;
      for (const division of list(army?.divisions)) defenders.set(division.stateId, (defenders.get(division.stateId) ?? 0) + 1);
    }
    const target = Object.entries(seas.stateSeas ?? {})
      .filter(([id, zones]) => isEnemy(id) && list(zones).some((zoneId) => list(seas.zones?.[zoneId]?.coastalStates).some(isOwn)
        && !enemyDominates(seaControl, String(zoneId), owner, atWar)))
      .sort(([a], [b]) => (defenders.get(a) ?? 0) - (defenders.get(b) ?? 0) || a.localeCompare(b))[0];
    return target ? [{ kind: "naval", op: { op: "land", polity: owner, stateId: target[0], count: op.count ?? 3 } }] : [];
  }
  const zone = Object.entries(seas.zones)
    .map(([zoneId, entry]) => ({ zoneId, enemy: list(entry.coastalStates).filter(isEnemy).length, own: list(entry.coastalStates).filter(isOwn).length }))
    .filter((entry) => entry.enemy > 0 && entry.own > 0)
    .sort((a, b) => b.enemy - a.enemy || a.zoneId.localeCompare(b.zoneId))[0];
  if (!zone) return [];
  const mission = ["escort", "blockade", "support"].includes(op.mission) ? op.mission : "escort";
  return [{ kind: "naval", op: { op: "assign", polity: owner, zoneId: zone.zoneId, mission, count: op.count ?? 99 } }];
};
