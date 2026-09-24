// Couche HOI4 — les écritures du joueur dans world.hoi (phase 2).
//
// Les panneaux Recherche et Production lisent le monde depuis le store ; pour
// écrire, ils relisent world.json à jour, appliquent une fonction pure
// (runtime/hoi/research.js ou economyOps.js) et réécrivent le tout, comme le
// tableau des Projets. Pendant un saut, rien n'est écrit : le tour réécrit le
// monde à la fin, et le choix du joueur serait perdu sans un mot.

import { isSimulationBusy } from "../AI/simulationStatus.js";
import { readWorldState, writeWorldState } from "../../runtime/gameState.js";

// `mutate(hoi)` renvoie { hoi } pour écrire, ou { error } pour refuser.
// Renvoie { ok, error, notes }.
export const updateHoiLayer = async (mutate) => {
  if (isSimulationBusy()) return { ok: false, error: "busy", notes: [] };
  const world = await readWorldState({ force: true });
  if (!world?.hoi) return { ok: false, error: "no-hoi", notes: [] };
  const result = mutate(world.hoi) ?? {};
  if (result.error || !result.hoi) return { ok: false, error: result.error || "unchanged", notes: result.notes ?? [] };
  await writeWorldState({ ...world, hoi: result.hoi });
  return { ok: true, error: null, notes: result.notes ?? [] };
};

// Ce qu'un refus veut dire, pour le joueur.
export const HOI_WRITE_ERRORS = Object.freeze({
  busy: "A time skip is running; try again once it ends.",
  "no-hoi": "This game has no HOI4 layer.",
  unchanged: "Nothing changed.",
  locked: "Its prerequisites are not researched yet.",
  "no-free-slot": "Every research slot is taken.",
  "queue-full": "The queue is full.",
  done: "Already researched.",
  active: "Already being researched.",
  queued: "Already queued.",
  "unknown-tech": "Unknown technology.",
  "unknown-nation": "Your country has no tracked economy.",
});
