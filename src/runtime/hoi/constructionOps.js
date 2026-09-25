// Couche HOI4 — les chantiers du joueur (phase 3).
//
// Run tests: node --test src/runtime/hoi/constructionOps.test.js
//
// Ce que le panneau Production fait sur la carte et dans world.hoi : lancer un
// bâtiment neuf sur un site, agrandir un bâtiment, réordonner ou annuler un
// chantier. Fonctions pures sur le monde entier (un chantier est une structure
// de la carte) ; chacune renvoie { world, error }.

import { findNationKey, normalizeNation, refreshBuildingBonuses } from "./engine.js";
import {
  HOI_BUILDING_TYPES,
  isBuildingTypeUnlocked,
  newBuildingMarker,
  ofPlace,
  startConstruction,
} from "./buildings.js";

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const nationOf = (world, polity) => {
  const key = findNationKey(world?.hoi, polity);
  return key ? { key, nation: normalizeNation(world.hoi.nations[key]) } : null;
};

const withNation = (world, key, nation) => ({
  ...world,
  hoi: { ...world.hoi, nations: { ...world.hoi.nations, [key]: nation } },
});

const ownedIndex = (world, key, markerId) => (Array.isArray(world.markers) ? world.markers : [])
  .findIndex((marker) => String(marker?.id) === String(markerId) && findNationKey(world.hoi, marker.ownerCode) === key);

// Un bâtiment neuf sur un site (ville ou structure du joueur). Il apparaît tout
// de suite sur la carte, en chantier, un peu décalé du site pour ne pas le cacher.
export const queueNewBuilding = (world, { polity, type, site, resource = null, date = "", id }) => {
  const owner = nationOf(world, polity);
  if (!owner) return { world, error: "unknown-nation" };
  const spec = HOI_BUILDING_TYPES[type];
  if (!spec || type === "complexe_industriel") return { world, error: "unknown-type" };
  if (!isBuildingTypeUnlocked(type, owner.nation, world.hoi.tech?.tree)) return { world, error: "type-locked" };
  if (!site || !Number.isFinite(site.lng) || !Number.isFinite(site.lat)) return { world, error: "no-site" };
  const markers = Array.isArray(world.markers) ? world.markers : [];
  // Plusieurs chantiers sur le même site : chacun un cran plus loin.
  const nearby = markers.filter((marker) => Math.abs(marker.lat - site.lat) < 0.3 && Math.abs(marker.lng - site.lng) < 0.3).length;
  const angle = (nearby * 72 * Math.PI) / 180;
  const marker = newBuildingMarker({
    type,
    id,
    name: `${spec.label[0].toUpperCase()}${spec.label.slice(1)} ${ofPlace(site.name)}`,
    ownerCode: owner.key,
    lng: Math.round((site.lng + 0.08 * Math.cos(angle)) * 1e5) / 1e5,
    lat: Math.round((site.lat + 0.06 * Math.sin(angle)) * 1e5) / 1e5,
    date,
    resource,
  });
  if (!marker) return { world, error: "no-site" };
  const nation = { ...owner.nation, constructionQueue: [...owner.nation.constructionQueue, marker.id] };
  return { world: { ...withNation(world, owner.key, nation), markers: [...markers, marker] }, error: null };
};

// Un niveau de plus sur un bâtiment du joueur.
export const queueUpgrade = (world, { polity, markerId }) => {
  const owner = nationOf(world, polity);
  if (!owner) return { world, error: "unknown-nation" };
  const index = ownedIndex(world, owner.key, markerId);
  if (index < 0 || !world.markers[index].building) return { world, error: "unknown-type" };
  const started = startConstruction(world.markers[index].building);
  if (started.error) return { world, error: started.error };
  const markers = [...world.markers];
  markers[index] = { ...markers[index], building: started.building };
  const nation = { ...owner.nation, constructionQueue: [...owner.nation.constructionQueue, String(markerId)] };
  return { world: refreshBuildingBonuses({ ...withNation(world, owner.key, nation), markers }), error: null };
};

// Monter (delta −1) ou descendre (+1) un chantier dans la file.
export const moveInQueue = (world, { polity, markerId, delta }) => {
  const owner = nationOf(world, polity);
  if (!owner) return { world, error: "unknown-nation" };
  const queue = [...owner.nation.constructionQueue];
  const from = queue.indexOf(String(markerId));
  const to = from + Math.sign(delta);
  if (from < 0 || to < 0 || to >= queue.length) return { world, error: "unchanged" };
  [queue[from], queue[to]] = [queue[to], queue[from]];
  return { world: withNation(world, owner.key, { ...owner.nation, constructionQueue: queue }), error: null };
};

// Annuler : un chantier neuf disparaît de la carte ; un agrandissement s'arrête
// et le bâtiment garde son niveau. Les points déjà dépensés sont perdus.
export const cancelConstruction = (world, { polity, markerId }) => {
  const owner = nationOf(world, polity);
  if (!owner) return { world, error: "unknown-nation" };
  const index = ownedIndex(world, owner.key, markerId);
  const building = index >= 0 ? world.markers[index].building : null;
  if (!building?.construction) return { world, error: "unchanged" };
  const queue = owner.nation.constructionQueue.filter((id) => id !== String(markerId));
  let markers;
  if (building.level === 0) {
    markers = world.markers.filter((_, i) => i !== index);
  } else {
    const { construction: _dropped, ...kept } = building;
    markers = [...world.markers];
    markers[index] = { ...markers[index], building: kept, status: "active" };
  }
  return { world: { ...withNation(world, owner.key, { ...owner.nation, constructionQueue: queue }), markers }, error: null };
};
