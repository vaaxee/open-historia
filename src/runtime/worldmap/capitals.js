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

// Test F, 8–15 janvier 1936 : « Kaunas, la deuxième ville la plus importante de
// Lituanie », alors que Kaunas était la capitale et que le prompt le disait. Une
// capitale décrite comme la deuxième (troisième…) ville devient « la capitale ».
const ORDINAL_CITY = /(?:la |the )?(?:deuxi[èe]me|seconde|troisi[èe]me|second|third)(?:[- ]largest)? (?:ville|city)(?: la plus importante)?/i;
export const fixCapitalMisnaming = (text, capitals) => {
  let out = String(text ?? "");
  for (const entry of Object.values(capitals ?? {})) {
    const city = String(entry?.city ?? "").trim();
    if (!city) continue;
    let from = 0;
    for (;;) {
      const at = out.indexOf(city, from);
      if (at < 0) break;
      const after = at + city.length;
      const window = out.slice(after, after + 40);
      const match = window.match(ORDINAL_CITY);
      // Right after the name (", la deuxième ville…", " is the second city…").
      if (match && /^[\s,]*(?:(?:est|is|was|[ée]tait)\s+)?$/i.test(window.slice(0, match.index))) {
        const french = /ville/i.test(match[0]);
        const start = after + match.index;
        out = `${out.slice(0, start)}${french ? "la capitale" : "the capital"}${out.slice(start + match[0].length)}`;
      }
      from = after;
    }
  }
  return out;
};
