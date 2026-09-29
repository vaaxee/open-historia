// Phase 12 (étape D) — l'éditeur au pinceau en cours : l'outil MJ l'ouvre, un
// clic sur la carte mondiale ajoute ou retire la province cliquée
// (WorldMapLayer), ou pose la capitale ; l'outil en fait des opérations
// (server/worldMapBrushEdits.js) qu'il envoie à POST /api/worldmap/brush.

import { useSyncExternalStore } from "react";

const IDLE = Object.freeze({ painting: false, mode: "paint", provinces: [], capital: 0 });
let state = IDLE;
const listeners = new Set();
const emit = () => { for (const listener of listeners) listener(); };

export const getBrush = () => state;
export const startBrush = () => { state = { ...IDLE, painting: true }; emit(); };
export const stopBrush = () => { state = IDLE; emit(); };
export const setBrushMode = (mode) => { if (!state.painting) return; state = { ...state, mode: mode === "capital" ? "capital" : "paint" }; emit(); };
export const clearBrush = () => { if (!state.painting) return; state = { ...state, provinces: [], capital: 0 }; emit(); };
// Un clic sur une province : au pinceau, elle entre ou sort de la sélection ;
// en mode capitale, elle devient la capitale (et entre dans la sélection).
export const brushProvince = (province) => {
  const id = Number(province);
  if (!state.painting || !Number.isInteger(id) || id < 1) return;
  if (state.mode === "capital") {
    state = { ...state, capital: id, provinces: state.provinces.includes(id) ? state.provinces : [...state.provinces, id] };
  } else {
    const provinces = state.provinces.includes(id) ? state.provinces.filter((p) => p !== id) : [...state.provinces, id];
    state = { ...state, provinces, capital: provinces.includes(state.capital) ? state.capital : 0 };
  }
  emit();
};
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const useBrush = () => useSyncExternalStore(subscribe, getBrush, getBrush);

const slug = (value) => String(value ?? "").trim().normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Le brouillon de l'outil en opérations. `target` : un état existant, ou "" pour
// un état neuf (`name`, `owner`). `capitalOf` : le pays dont la capitale va à
// la province `capital` (dans l'état visé).
export const brushDraftOps = ({ target = "", name = "", owner = "", provinces = [], capital = 0, capitalOf = "", rename = "" } = {}) => {
  const ops = [];
  let state = String(target || "").trim();
  if (!state) {
    if (!String(name).trim() || !String(owner).trim()) return [];
    state = `brush-${slug(name)}`;
    ops.push({ op: "newState", id: state, name: String(name).trim(), owner: String(owner).trim() });
  } else if (String(rename).trim()) {
    ops.push({ op: "rename", state, name: String(rename).trim() });
  }
  if (provinces.length) ops.push({ op: "assign", state, provinces: [...provinces] });
  if (capital && String(capitalOf).trim()) ops.push({ op: "capital", polity: String(capitalOf).trim(), state, province: capital });
  return ops;
};
