// Phase 7.2 — les données de ravitaillement des états (terrain, côte, voies
// ferrées), servies par /api/worldmap/supply pour une partie sur la carte
// mondiale. Vide ailleurs, ou sans serveur (les tests).

let cached = null;

export const loadWorldMapSupply = async ({ force = false } = {}) => {
  if (cached && !force) return cached;
  try {
    const response = await fetch("/api/worldmap/supply");
    if (!response.ok) return {};
    const data = await response.json();
    const states = data?.states && typeof data.states === "object" ? data.states : {};
    // Une réponse vide (une partie hors de la carte mondiale) n'est pas gardée.
    if (Object.keys(states).length) cached = states;
    return states;
  } catch {
    return {};
  }
};

export const resetWorldMapSupplyCache = () => { cached = null; };
