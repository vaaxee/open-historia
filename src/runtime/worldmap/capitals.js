// Carte mondiale unique (phase 6) — la capitale de chaque pays, pour l'IA.
//
// Le scénario converti les porte (provinces.v1.json, capitals, écrit par
// scripts/worldmap/correct-1936.mjs) ; le serveur les sert à une partie sur la
// carte mondiale (/api/worldmap/capitals). L'IA les lit dans le résumé du monde,
// avec qui tient chaque capitale aujourd'hui.

let cached = null;

// { polity: { city, state, stateName } } — vide hors d'une partie sur la carte
// mondiale, ou sans serveur (les tests).
export const loadWorldMapCapitals = async ({ force = false } = {}) => {
  if (cached && !force) return cached;
  try {
    const response = await fetch("/api/worldmap/capitals");
    if (!response.ok) return {};
    const data = await response.json();
    const capitals = data?.capitals && typeof data.capitals === "object" ? data.capitals : {};
    // An empty answer (a game off the world map) is not kept: the next game may be on it.
    if (Object.keys(capitals).length) cached = capitals;
    return capitals;
  } catch {
    return {};
  }
};

export const resetWorldMapCapitalsCache = () => { cached = null; };

// The prompt's lines: one per polity with a capital, and who holds it when that
// is not the polity itself. `ownerOf(stateId)` gives a state's current holder.
export const describeCapitals = (capitals, ownerOf = () => "") => {
  const rows = Object.entries(capitals ?? {})
    .filter(([polity, entry]) => polity && entry?.city)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!rows.length) return "";
  return rows.map(([polity, entry]) => {
    const region = entry.stateName && entry.stateName !== entry.city ? `, region ${entry.stateName}` : "";
    const holder = entry.state ? String(ownerOf(entry.state) ?? "").trim() : "";
    const held = holder && holder !== polity ? ` — held by ${holder}` : "";
    return `- ${polity}: ${entry.city}${region}${held}`;
  }).join("\n");
};
