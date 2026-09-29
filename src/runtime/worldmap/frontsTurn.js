// Phase 7.3 — les fronts au tour, sur la carte mondiale.
//
// Après les impacts du tour : les ordres de front des pays IA (economyOps
// « front ») sont appliqués avec les mêmes règles que ceux du joueur, un front
// dont la guerre est finie se ferme, et chaque front redéploie ses divisions sur
// sa ligne, qui a pu bouger. Pur : renvoie le monde et les notes du reçu.

import { applyFrontOps, deployFront, frontLine, frontOpsFromEconomyOp, normalizeFronts } from "../hoi/fronts.js";
import { normalizeEconomyOp } from "../hoi/economyOps.js";
import { templatesFor } from "../hoi/armies.js";
import { atWar, warsFor } from "./warRules.js";

const list = (value) => (Array.isArray(value) ? value : []);

export const applyFrontsForTurn = (world, { events = [], map, date = "", player = "" } = {}) => {
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
  return { world: { ...world, hoi: { ...world.hoi, armies, fronts: context.fronts } }, notes };
};
