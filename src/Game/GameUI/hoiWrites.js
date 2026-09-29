// Couche HOI4 — les écritures du joueur dans world.hoi (phase 2).
//
// Les panneaux Recherche et Production lisent le monde depuis le store ; pour
// écrire, ils relisent world.json à jour, appliquent une fonction pure
// (runtime/hoi/research.js ou economyOps.js) et réécrivent le tout, comme le
// tableau des Projets. Pendant un saut, rien n'est écrit : le tour réécrit le
// monde à la fin, et le choix du joueur serait perdu sans un mot.

import { busyReasons, isSimulationBusy } from "../AI/simulationStatus.js";
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

// Test G avec Jev : après un tour, le panneau Fronts répondait « un saut est en
// cours » jusqu'à ce que la page soit rechargée. Une écriture du panneau attend
// maintenant la fin de ce qui occupe le jeu (au plus `waitMs`), puis s'applique ;
// `onWait(reasons)` dit au panneau ce qu'il attend.
export const waitUntilIdle = async ({ waitMs = 180000, stepMs = 500, onWait = null, isBusy = isSimulationBusy, reasons = busyReasons, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) => {
  let waited = 0;
  while (isBusy()) {
    if (waited >= waitMs) return false;
    if (typeof onWait === "function") onWait(reasons());
    await sleep(stepMs);
    waited += stepMs;
  }
  return true;
};

// Phase 3 : une écriture qui touche aussi les structures de la carte (un chantier
// est une structure). `mutate(world)` renvoie { world } ou { error }.
export const updateHoiWorld = async (mutate, { onWait = null, waitMs = 180000 } = {}) => {
  if (isSimulationBusy() && !(await waitUntilIdle({ onWait, waitMs }))) return { ok: false, error: "busy", reasons: busyReasons() };
  const world = await readWorldState({ force: true });
  if (!world?.hoi) return { ok: false, error: "no-hoi" };
  const result = mutate(world) ?? {};
  if (result.error || !result.world) return { ok: false, error: result.error || "unchanged" };
  await writeWorldState(result.world);
  return { ok: true, error: null };
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
  "unknown-type": "Unknown building type.",
  "type-locked": "This building type needs a technology first.",
  "no-slot": "No free building slot left in this province.",
  "not-coastal": "A port needs a coastal province.",
  "already-building": "Already under construction.",
  "max-level": "Already at its highest level.",
  "not-upgradable": "An industrial complex cannot be enlarged; build a factory beside it.",
  "no-site": "Pick a place to build.",
});
