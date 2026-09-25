// Couche HOI4 — les provinces dans le navigateur (phase 4).
//
// Chargées depuis GET /api/hoi/provinces (générées et gardées en cache par le
// serveur) quand une partie HOI4 s'ouvre, puis gardées ici avec leur index.
// Le même petit magasin porte le mode « Choisir sur la carte » du panneau
// Construction : la carte y lit qui attend un clic, et y dépose la province
// choisie.

import { useSyncExternalStore } from "react";
import { buildProvinceIndex } from "../../runtime/hoi/provinces.js";

let state = {
  status: "idle", // idle | loading | ready | error
  stamp: "",
  collection: null,
  index: null,
  terrainSource: "",
  stats: null,
  pick: null, // { playerKey, onPick } pendant le choix sur la carte
  hover: null, // id de la province survolée pendant le choix
  selected: null, // id de la dernière province choisie
};
const listeners = new Set();

const set = (patch) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getHoiProvinceState = () => state;

export const useHoiProvinces = () => useSyncExternalStore(subscribe, getHoiProvinceState, getHoiProvinceState);

let inFlight = null;

// Charge (ou recharge) les provinces du scénario actif. Rien ne change si le
// serveur renvoie les mêmes (même empreinte).
export const loadHoiProvinces = () => {
  if (inFlight) return inFlight;
  if (state.status !== "ready") set({ status: "loading" });
  inFlight = fetch("/api/hoi/provinces")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const stamp = String(payload?.stamp ?? "");
      if (stamp && stamp === state.stamp && state.index) {
        set({ status: "ready" });
        return;
      }
      const collection = payload?.provinces?.features ? payload.provinces : { type: "FeatureCollection", features: [] };
      set({
        status: "ready",
        stamp,
        collection,
        index: buildProvinceIndex(collection),
        terrainSource: String(payload?.terrainSource ?? ""),
        stats: payload?.stats ?? null,
        hover: null,
        selected: null,
      });
    })
    .catch(() => set({ status: "error" }))
    .finally(() => { inFlight = null; });
  return inFlight;
};

export const startProvincePick = ({ playerKey, onPick }) => set({ pick: { playerKey, onPick }, hover: null });
export const cancelProvincePick = () => set({ pick: null, hover: null });
export const setProvinceHover = (id) => { if (state.hover !== id) set({ hover: id }); };
export const setSelectedProvince = (id) => set({ selected: id });

// Un clic sur la carte pendant le choix : renvoie true s'il a été pris.
export const finishProvincePick = (entry) => {
  const pick = state.pick;
  if (!pick || !entry) return false;
  set({ pick: null, hover: null, selected: entry.id });
  pick.onPick?.(entry);
  return true;
};
