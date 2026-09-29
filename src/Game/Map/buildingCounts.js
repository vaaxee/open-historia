// Phase 9 — les bâtiments comptés par état, pour la carte vue de loin.
//
// Vue de loin (sous le zoom 5), chaque état montre une icône par type de
// bâtiment qu'il a, avec leur nombre (usines, forts, ports, aérodromes, dépôts…) ;
// de près, chaque bâtiment a son icône (MarkersLayer.jsx), cliquable pour sa
// fiche. Pur : un bâtiment est rangé dans son état (regionId, sinon le centre
// d'état le plus proche).

import { HOI_BUILDING_TYPES } from "../../runtime/hoi/buildings.js";

const list = (value) => (Array.isArray(value) ? value : []);

// Au-dessous de ce zoom, les compteurs ; au-dessus, les icônes une à une.
export const BUILDING_DETAIL_ZOOM = 5;
export const MAX_TYPES_PER_STATE = 4;

// L'état le plus proche d'un point (distance corrigée de la latitude).
export const nearestState = (lng, lat, centers) => {
  let best = ""; let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const [id, [x, y]] of Object.entries(centers ?? {})) {
    const d = ((x - lng) * k) ** 2 + (y - lat) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
};

// Les compteurs : une entité par (état, type), à côté du centre de l'état.
// `iconOf(type)` : le nom de l'image de l'icône (buildingIcons.js).
export const buildingCounterFeatures = (markers, centers, { iconOf = (type) => type } = {}) => {
  const counts = new Map();
  for (const marker of list(markers)) {
    const type = marker?.building?.type;
    if (!type || !HOI_BUILDING_TYPES[type]) continue;
    const stateId = centers?.[marker.regionId] ? marker.regionId
      : Number.isFinite(Number(marker.lng)) && Number.isFinite(Number(marker.lat)) ? nearestState(Number(marker.lng), Number(marker.lat), centers) : "";
    if (!stateId) continue;
    const byType = counts.get(stateId) ?? new Map();
    byType.set(type, (byType.get(type) ?? 0) + 1);
    counts.set(stateId, byType);
  }
  const features = [];
  for (const [stateId, byType] of counts) {
    const types = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_TYPES_PER_STATE);
    types.forEach(([type, count], index) => {
      // icon-offset se compte en pixels de l'icône (32 px), text-offset en ems.
      const offset = (index - (types.length - 1) / 2) * 36;
      features.push({
        type: "Feature",
        properties: { stateId, type, count, icon: iconOf(HOI_BUILDING_TYPES[type].icon), label: count > 1 ? String(count) : "", offset: [offset, 0], textOffset: [offset / 20 + 0.9, 0.6] },
        geometry: { type: "Point", coordinates: centers[stateId] },
      });
    });
  }
  return { type: "FeatureCollection", features };
};
