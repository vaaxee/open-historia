// Carte mondiale unique (phase 5) — ce que la couche de carte partage avec le
// reste de la carte : si elle est active, et le propriétaire de chaque province
// (owners[k] : province k + 1). Nations.jsx y lit les propriétaires pour placer
// les noms de pays, et cesse alors de publier ceux de l'ancienne carte.

import { useSyncExternalStore } from "react";

let state = { active: false, mode: "", owners: null, ownersKey: "" };
const listeners = new Set();

export const getWorldMapState = () => state;
export const setWorldMapState = (patch) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useWorldMapState = () => useSyncExternalStore(subscribe, getWorldMapState, getWorldMapState);

// L'aperçu : ?worldmap=today|scenario dans l'adresse, ou localStorage["oh:worldmap"].
export const worldMapPreviewMode = () => {
  if (typeof window === "undefined") return "";
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("worldmap");
    if (fromUrl) return fromUrl;
    return window.localStorage?.getItem("oh:worldmap") ?? "";
  } catch {
    return "";
  }
};
