// Carte mondiale unique (phase 6) — la partie active se joue-t-elle sur la carte
// mondiale ? (worldMap "v1", posé à sa création ; le serveur le dit dans
// /api/worldmap/status, champ game). Les règles de guerre état par état
// (warRules.js) ne valent que pour ces parties.

let cached = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export const isWorldMapGame = async ({ force = false, fetchImpl = globalThis.fetch } = {}) => {
  if (!force && cached !== null && Date.now() - cachedAt < TTL_MS) return cached;
  try {
    if (typeof fetchImpl !== "function") return false;
    const response = await fetchImpl("/api/worldmap/status");
    if (!response?.ok) return false;
    const status = await response.json();
    cached = Boolean(status?.available && status?.game);
    cachedAt = Date.now();
    return cached;
  } catch {
    return false;
  }
};

export const resetWorldMapGameCache = () => { cached = null; cachedAt = 0; };
