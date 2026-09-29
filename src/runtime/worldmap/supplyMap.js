// Phase 7.2 — la carte de ravitaillement d'un pays, sur la carte mondiale.
//
// Relie le moteur pur (runtime/hoi/supply.js) au monde d'une partie : qui tient
// chaque état (le catalogue, puis les occupations), qui est en guerre avec qui
// (warRules.js), la capitale (capitals.js), les dépôts (complexes industriels) et
// les ports (bâtiments de la couche HOI4), et ce que chaque état est
// (supply-<scenario>.json : terrain, voies ferrées). Import-free à part ces
// modules purs, pour les tests.

import { computeSupply, sourcesFor, truckShare } from "../hoi/supply.js";
import { templatesFor } from "../hoi/armies.js";
import { blockadedStates } from "../hoi/naval.js";
import { coBelligerents, warsFor } from "./warRules.js";

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// Renvoie supplyFor(polity) → Map id → { level, cost, encircled }, calculée une
// fois par pays.
//   world    : le monde de la partie (regionOwnershipOverrides, wars, markers, hoi)
//   catalog  : [{ id, country, adjacencies }] (les états de la carte)
//   info     : { [id]: { terrain, rail, coastal } }
//   capitals : { polity: { state } }
//   stateAt  : (lng, lat) → id d'état, pour placer dépôts et ports
export const buildSupplyFor = ({ world = {}, catalog = [], info = {}, capitals = {}, stateAt = () => "" } = {}) => {
  const byId = new Map(list(catalog).map((row) => [clean(row?.id), row]));
  const overrides = world?.regionOwnershipOverrides ?? {};
  const controllerOf = (id) => clean(overrides[id]) || clean(byId.get(id)?.country);
  const sovereignOf = (id) => clean(world?.regionSovereigntyOverrides?.[id]) || controllerOf(id);
  // Les voisins du fichier de ravitaillement (déduits des provinces), ceux du
  // catalogue à défaut.
  const neighboursOf = (id) => (Array.isArray(info?.[id]?.neighbours) ? info[id].neighbours : list(byId.get(id)?.adjacencies));
  const infoOf = (id) => info?.[id] ?? {};
  // Les états qui ont des provinces (le fichier de ravitaillement), le catalogue
  // à défaut : un identifiant d'avant un découpage n'a plus de terre.
  const states = Object.keys(info ?? {}).length ? Object.keys(info) : [...byId.keys()];
  const wars = warsFor(world);
  const templates = templatesFor(world?.hoi?.series);
  const buildingsOf = (type, polity) => list(world?.markers)
    .filter((marker) => marker?.building?.type === type && clean(marker.ownerCode).toLowerCase() === clean(polity).toLowerCase())
    .map((marker) => clean(marker.regionId) || clean(stateAt(Number(marker.lng), Number(marker.lat))))
    .filter(Boolean);
  // Phase 7.8 : un port ou une côte sous blocus ennemi (naval.js) ne ravitaille
  // plus par mer.
  const blockaded = blockadedStates(world);
  const open = (id) => !blockaded.has(clean(id));
  const cache = new Map();
  return (polity) => {
    if (cache.has(polity)) return cache.get(polity);
    const capital = clean(capitals?.[polity]?.state);
    const sources = sourcesFor({
      polity,
      controllerOf,
      capital,
      depots: buildingsOf("complexe_industriel", polity),
      ports: buildingsOf("port", polity).filter(open),
      // Ses côtes, ravitaillées par mer : seulement là où le pays est souverain
      // (une côte occupée se ravitaille par la terre, depuis le front).
      coasts: states.filter((id) => infoOf(id).coastal && open(id) && clean(sovereignOf(id)).toLowerCase() === clean(polity).toLowerCase()),
    });
    const supply = computeSupply({
      side: coBelligerents(wars, polity),
      states,
      controllerOf,
      neighboursOf,
      infoOf,
      sources,
      trucks: truckShare(world?.hoi?.armies?.[polity], templates),
    });
    cache.set(polity, supply);
    return supply;
  };
};

// Le résumé d'une carte de ravitaillement, pour le rapport du tour et les prompts.
export const summarizeSupply = (supply) => {
  let states = 0; let full = 0; let poor = 0; let encircled = 0;
  for (const entry of supply instanceof Map ? supply.values() : []) {
    states += 1;
    if (entry.encircled) encircled += 1;
    else if (entry.level >= 0.99) full += 1;
    else if (entry.level < 0.5) poor += 1;
  }
  return { states, full, poor, encircled };
};
