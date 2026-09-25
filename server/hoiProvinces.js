/*! Couche HOI4, phase 4 — les provinces du scénario actif, générées une fois et gardées en cache. */
// GET /api/hoi/provinces (server.js) sert le fichier en cache. Il est recalculé
// quand les régions ou les villes du scénario changent, quand les réglages de
// génération changent, ou quand les tuiles d'altitude arrivent.
//
// Seulement les scénarios dont les régions sont en GeoJSON (phase 4) : la carte
// de base, sur tuiles vectorielles, n'a pas encore de provinces.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir.js";
import { resolveRuntimeGeojsonAsset } from "./libraryStore.js";
import { elevationStats, elevationTilesPresent, ELEVATION_TILE_COUNT } from "./hoiElevation.js";
import { PROVINCE_GEN_VERSION, PROVINCE_TUNING, generateProvinces, pointInPolygons } from "./hoiProvinceGen.js";
import { classifyTerrain, provinceSlots, TERRAIN_TUNING } from "./hoiTerrain.js";

const CACHE_DIR = path.join(DATA_DIR, "hoi-provinces");
const DEFAULT_CITIES_PATH = path.join(DATA_DIR, "scenarios", "default", "cities.geojson");
const TERRAIN_VERSION = 1;

const statStamp = (file) => {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return "none";
  }
};

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

// Les villes : celles du scénario, sinon la liste mondiale du scénario par défaut.
// Elles ne servent qu'à la densité et aux noms, par contour exact de région.
const resolveCities = () => {
  const own = resolveRuntimeGeojsonAsset("citiesGeojson")?.sourcePath;
  const ownFeatures = own ? readJson(own, null)?.features : null;
  const source = Array.isArray(ownFeatures) && ownFeatures.length ? own : DEFAULT_CITIES_PATH;
  const features = readJson(source, { features: [] })?.features ?? [];
  return {
    source,
    cities: features
      .map((feature) => ({
        name: String(feature?.properties?.city || feature?.properties?.name || "").trim(),
        coordinates: feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null,
        population: Number(feature?.properties?.population) || 0,
      }))
      .filter((city) => city.name && Array.isArray(city.coordinates)),
  };
};

// Des points dans une province, pour son altitude : une grille sur son cadre.
const samplePoints = (geometry, grid = 6) => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const polygon of polygons) for (const [x, y] of polygon[0]) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const points = [];
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const point = [minX + ((i + 0.5) / grid) * (maxX - minX), minY + ((j + 0.5) / grid) * (maxY - minY)];
      if (pointInPolygons(point, polygons)) points.push(point);
    }
  }
  return points.length ? points : [polygons[0][0][0]];
};

const centerOf = (points) => [
  points.reduce((sum, [x]) => sum + x, 0) / points.length,
  points.reduce((sum, [, y]) => sum + y, 0) / points.length,
];

// Le fichier des provinces du scénario actif, calculé si besoin. Renvoie son
// chemin, ou null pour une carte sans régions en GeoJSON.
export const ensureActiveProvinces = () => {
  const regionsPath = resolveRuntimeGeojsonAsset("regionsGeojson")?.sourcePath;
  if (!regionsPath || regionsPath.split(path.sep).includes("stock")) return null;
  const { source: citiesPath, cities } = resolveCities();
  const tiles = elevationTilesPresent();
  const stamp = crypto.createHash("sha1").update(JSON.stringify({
    regions: statStamp(regionsPath),
    cities: statStamp(citiesPath),
    tiles,
    gen: PROVINCE_GEN_VERSION,
    terrain: TERRAIN_VERSION,
    tuning: PROVINCE_TUNING,
    terrainTuning: TERRAIN_TUNING,
  })).digest("hex");
  const key = crypto.createHash("sha1").update(regionsPath).digest("hex").slice(0, 16);
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  if (readJson(`${cachePath}.stamp`, null)?.stamp === stamp && fs.existsSync(cachePath)) return cachePath;

  const started = Date.now();
  const regions = readJson(regionsPath, { type: "FeatureCollection", features: [] });
  const { provinces, adjacency, stats } = generateProvinces(regions, { cities });
  const useElevation = tiles === ELEVATION_TILE_COUNT;
  const terrains = {};
  for (const feature of provinces.features) {
    const points = samplePoints(feature.geometry);
    const [lng, lat] = centerOf(points);
    const elevation = useElevation ? elevationStats(points) : null;
    const terrain = classifyTerrain({
      lng, lat, elevation,
      population: feature.properties.population,
      areaKm2: feature.properties.areaKm2,
      coastal: feature.properties.coastal,
    });
    feature.properties.terrain = terrain;
    feature.properties.slots = provinceSlots(terrain, feature.properties.population);
    // Le point où l'on bâtit : la ville, sinon le point de la grille le plus
    // proche du centre (toujours dans la province, même biscornue).
    if (!feature.properties.anchor) {
      const inside = points.reduce((best, point) => (
        (point[0] - lng) ** 2 + (point[1] - lat) ** 2 < (best[0] - lng) ** 2 + (best[1] - lat) ** 2 ? point : best
      ), points[0]);
      feature.properties.anchor = inside.map((value) => Math.round(value * 1e4) / 1e4);
    }
    if (elevation) feature.properties.elevation = elevation.mean;
    terrains[terrain] = (terrains[terrain] ?? 0) + 1;
  }
  const payload = {
    version: PROVINCE_GEN_VERSION,
    stamp,
    terrainSource: useElevation ? "elevation" : "rules",
    stats: { ...stats, terrains, totalMs: Date.now() - started },
    adjacency,
    provinces,
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(payload));
  fs.writeFileSync(`${cachePath}.stamp`, JSON.stringify({ stamp, stats: payload.stats, terrainSource: payload.terrainSource }));
  return cachePath;
};
