// Phase 7.7 — le tracé d'un front en cours de dessin : le panneau Fronts l'ouvre,
// un clic sur la carte mondiale ajoute ou retire l'état cliqué (WorldMapLayer),
// la carte montre les états retenus (ArmiesLayer), le panneau les enregistre.

import { useSyncExternalStore } from "react";

let state = { drawing: false, sector: [] };
const listeners = new Set();
const emit = () => { for (const listener of listeners) listener(); };

export const getFrontDraw = () => state;
export const startFrontDraw = (sector = []) => { state = { drawing: true, sector: [...new Set(sector)] }; emit(); };
export const stopFrontDraw = () => { state = { drawing: false, sector: [] }; emit(); };
export const toggleFrontDrawState = (stateId) => {
  if (!state.drawing || !stateId) return;
  const sector = state.sector.includes(stateId) ? state.sector.filter((id) => id !== stateId) : [...state.sector, stateId];
  state = { ...state, sector };
  emit();
};
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const useFrontDraw = () => useSyncExternalStore(subscribe, getFrontDraw, getFrontDraw);
