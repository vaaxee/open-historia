// Carte mondiale unique (phase 5, étape B) — les frontières se déduisent des
// voisinages.
//
// Run tests: node --test src/runtime/worldmap/borders.test.js
//
// La géométrie ne change jamais : chaque limite (arc) sépare deux provinces a
// et b. Selon leurs propriétaires, c'est une limite de province, une frontière
// d'état ou une frontière de pays. Un scénario (étape C) ne stockera que
// province → pays et province → état.

export const BORDER_KIND = Object.freeze({ province: 0, state: 1, country: 2 });

// ownerOf(id) et stateOf(id) : le pays et l'état d'une province ("" si aucun).
export const arcKind = (a, b, ownerOf, stateOf = () => "") => {
  const oa = ownerOf(a); const ob = ownerOf(b);
  if (oa !== ob) return BORDER_KIND.country;
  if (stateOf(a) !== stateOf(b)) return BORDER_KIND.state;
  return BORDER_KIND.province;
};

// Les limites dont le genre change quand des provinces changent de mains : on
// ne recalcule que les arcs qui touchent ces provinces.
export const arcsTouching = (arcIndex, provinceIds) => {
  const wanted = new Set(provinceIds);
  return arcIndex.filter(([, a, b]) => wanted.has(a) || wanted.has(b));
};

// Palette de la coloration « pays d'aujourd'hui » (MAPCOLOR9 de Natural Earth :
// deux pays voisins n'ont jamais le même numéro).
export const TODAY_PALETTE = Object.freeze([
  "#d8cfb8", // 0 : sans pays
  "#c9a88b", "#a9bf8f", "#d6c27a", "#9fb3c8", "#c79a9a", "#b7a6c9", "#8fbfb0", "#d9a86c", "#aab27a",
]);
export const todayColour = (country) => TODAY_PALETTE[country?.color ?? 0] ?? TODAY_PALETTE[0];

// Le propriétaire de chaque province dans une partie : celui de son état si la
// partie l'a changé (regionOwnershipOverrides, par état : les états d'un
// scénario converti sont ses anciennes régions), sinon celui du scénario.
// scenario : { owners[], states[] } (provinces.v1.json).
export const provinceOwners = (scenario, overrides = {}) => {
  const owners = Array.isArray(scenario?.owners) ? scenario.owners : [];
  const states = Array.isArray(scenario?.states) ? scenario.states : [];
  return owners.map((owner, k) => {
    const state = states[k];
    if (state && Object.prototype.hasOwnProperty.call(overrides ?? {}, state)) return String(overrides[state] ?? "");
    return String(owner ?? "");
  });
};

// Les provinces dont le propriétaire a changé entre deux répartitions.
export const changedProvinces = (before, after) => {
  const out = [];
  const n = Math.max(before?.length ?? 0, after?.length ?? 0);
  for (let k = 0; k < n; k += 1) if ((before?.[k] ?? "") !== (after?.[k] ?? "")) out.push(k + 1);
  return out;
};
