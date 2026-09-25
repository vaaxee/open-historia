// Couche HOI4 — les provinces côté jeu (phase 4).
//
// Run tests: node --test src/runtime/hoi/provinces.test.js
//
// Le serveur génère les provinces du scénario (server/hoiProvinces.js) ; ici,
// ce qu'en fait le jeu : trouver la province d'un point, son propriétaire (celui
// de sa région, qui reste l'État : les transferts de l'IA ne changent pas), et
// ses emplacements de construction. Fonctions pures.

import { findNationKey } from "./engine.js";

// Les bâtiments qui prennent un emplacement, un par niveau (comme dans HOI4).
// Forts, radars, aérodromes et ports n'en prennent pas ; le complexe de départ
// en prend un seul, ses usines étant celles de tout l'État.
export const SLOT_BUILDING_TYPES = Object.freeze(["usine_civile", "usine_militaire", "acierie", "raffinerie", "raffinerie_synthetique", "mine"]);
export const COASTAL_BUILDING_TYPES = Object.freeze(["port"]);

const GRID_DEGREES = 5;

const polygonsOf = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const inPolygons = (point, polygons) => polygons.some((rings) => inRing(point, rings[0]) && !rings.slice(1).some((hole) => inRing(point, hole)));

const cellKey = (x, y) => `${Math.floor(x / GRID_DEGREES)}:${Math.floor(y / GRID_DEGREES)}`;

// Un index des provinces : par id, et une grille de 5° pour les trouver d'un point.
export const buildProvinceIndex = (collection) => {
  const entries = [];
  const byId = new Map();
  const grid = new Map();
  for (const feature of Array.isArray(collection?.features) ? collection.features : []) {
    const polygons = polygonsOf(feature?.geometry);
    const id = String(feature?.properties?.id ?? "");
    if (!polygons.length || !id) continue;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const rings of polygons) for (const [x, y] of rings[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const entry = { id, properties: feature.properties, polygons, bbox: [minX, minY, maxX, maxY] };
    entries.push(entry);
    byId.set(id, entry);
    for (let gx = Math.floor(minX / GRID_DEGREES); gx <= Math.floor(maxX / GRID_DEGREES); gx += 1) {
      for (let gy = Math.floor(minY / GRID_DEGREES); gy <= Math.floor(maxY / GRID_DEGREES); gy += 1) {
        const key = `${gx}:${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(entry);
      }
    }
  }
  return { entries, byId, grid };
};

// La province d'un point [lng, lat], ou null (mer, ou carte sans provinces).
export const provinceAt = (index, point) => {
  const [x, y] = point ?? [];
  if (!index || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const entry of index.grid.get(cellKey(x, y)) ?? []) {
    const [minX, minY, maxX, maxY] = entry.bbox;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY && inPolygons([x, y], entry.polygons)) return entry;
  }
  return null;
};

// Le propriétaire (clé de nation de world.hoi) : celui de la région, avec les
// changements de la partie ; null si la région n'a pas de nation HOI.
export const provinceOwnerKey = (entry, world) => {
  const props = entry?.properties ?? entry;
  if (!props) return null;
  const overrides = world?.regionOwnershipOverrides ?? {};
  const owner = Object.prototype.hasOwnProperty.call(overrides, props.regionId) ? overrides[props.regionId] : props.owner;
  return owner ? findNationKey(world?.hoi, owner) : null;
};

// Les emplacements que prend un bâtiment (un chantier compte déjà pour son
// niveau visé).
export const buildingSlotCost = (building) => {
  if (!building?.type) return 0;
  if (building.type === "complexe_industriel") return 1;
  if (!SLOT_BUILDING_TYPES.includes(building.type)) return 0;
  return Math.max(Number(building.construction?.targetLevel) || 0, Number(building.level) || 0);
};

// La province de chaque bâtiment (celle qu'il porte, sinon celle de son point),
// et les emplacements pris dans chaque province.
export const provinceUsage = (index, markers) => {
  const provinceOf = new Map();
  const used = new Map();
  for (const marker of Array.isArray(markers) ? markers : []) {
    if (!marker?.building) continue;
    const entry = (marker.provinceId && index?.byId.get(String(marker.provinceId))) || provinceAt(index, [marker.lng, marker.lat]);
    if (!entry) continue;
    provinceOf.set(String(marker.id), entry.id);
    used.set(entry.id, (used.get(entry.id) ?? 0) + buildingSlotCost(marker.building));
  }
  return { provinceOf, used };
};

// Ce qu'une province dit d'un chantier : null si c'est possible, sinon la
// raison. Les bâtiments déjà en trop restent (réponse 7) : seul le neuf est bloqué.
export const provinceSiteError = (province, type, used = 0) => {
  if (!province) return null;
  if (COASTAL_BUILDING_TYPES.includes(type) && !province.coastal) return "not-coastal";
  if (SLOT_BUILDING_TYPES.includes(type) && used + 1 > (Number(province.slots) || 0)) return "no-slot";
  return null;
};

// Les provinces d'une nation, pour la liste des sites, par nom (les
// populations des villes sont celles d'aujourd'hui : trier dessus mettrait
// Kinshasa avant Paris).
export const ownedProvinces = (index, world, key) => (index?.entries ?? [])
  .filter((entry) => provinceOwnerKey(entry, world) === key)
  .sort((a, b) => String(a.properties.name).localeCompare(String(b.properties.name), "fr"));
