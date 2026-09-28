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

export const applyFrontsForTurn = (world, { events = [], map, date = "" } = {}) => {
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
  // 3. Chaque front redéploie ses divisions sur sa ligne du moment.
  let armies = context.armies;
  for (const front of open) {
    if (!armies[front.owner]) continue;
    armies = { ...armies, [front.owner]: deployFront(armies[front.owner], front, frontLine(front, map)) };
  }
  return { world: { ...world, hoi: { ...world.hoi, armies, fronts: open } }, notes };
};
