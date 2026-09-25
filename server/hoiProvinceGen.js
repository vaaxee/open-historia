// Couche HOI4, phase 4 — découper chaque région en provinces.
//
// Run tests: node --test server/hoiProvinceGen.test.js
//
// Les régions de la carte restent les états : propriétaires, transferts de l'IA,
// réclamations, rien n'y change. À l'intérieur de chacune, des provinces de
// tailles comparables, façon HOI4, plus fines autour des villes et plus
// grossières dans une région sans ville (désert, steppe).
//
// Déterministe, sans hasard : mêmes régions, mêmes provinces, sur toute machine.
// Exécuté une fois par scénario sur le serveur (hoiProvinces.js), qui
// garde le résultat en cache.
//
// Méthode, région par région :
//   1. le nombre de provinces : surface / surface cible, la cible réduite par les
//      villes de la région et doublée pour une région sans ville ;
//   2. des points d'échantillonnage sur une grille à l'intérieur de la région ;
//   3. les graines : les plus grandes villes d'abord (elles donnent leur nom),
//      puis le point le plus éloigné des graines déjà posées ;
//   4. trois passes de Lloyd (chaque graine au centre de sa zone), les villes
//      restant fixes : des tailles comparables ;
//   5. la cellule de Voronoï de chaque graine, découpée par le contour de la région.
// Puis, pour toute la carte : voisinages et côtes, par les sommets partagés.

import polygonClipping from "polygon-clipping";
import turfArea from "@turf/area";

export const PROVINCE_TUNING = Object.freeze({
  // Surface visée par province (km²) ; réglable.
  targetKm2: 10000,
  minPerRegion: 1,
  maxPerRegion: 12,
  // Chaque tranche de 10× la population urbaine rend les provinces plus fines.
  urbanDensityPerDecade: 0.6,
  urbanReferencePopulation: 200000,
  // Une région sans ville : des provinces deux fois plus grandes.
  emptyRegionFactor: 0.5,
  // Points d'échantillonnage par province visée.
  samplesPerProvince: 40,
  lloydPasses: 3,
  // Taille d'une case pour reconnaître les sommets partagés (degrés).
  vertexBucketDegrees: 0.02,
  // Deux provinces sont voisines si elles partagent au moins ce nombre de cases.
  minSharedBuckets: 2,
  // Une province est côtière si ce nombre de cases de sa bordure ne touche rien.
  minCoastBuckets: 3,
});

export const PROVINCE_GEN_VERSION = 3;

const round5 = (value) => Math.round(value * 1e5) / 1e5;
const text = (value) => String(value ?? "").trim();

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

const polygonsOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

const bboxOf = (polygons) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0] ?? []) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
};

const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const pointInPolygons = (point, polygons) => polygons.some((polygon) => (
  pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole))
));

// Coupe un polygone convexe (projeté) par un demi-plan : garde le côté de `keep`.
const clipConvex = (points, a, b, c) => {
  // Demi-plan : a·x + b·y <= c
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const pIn = a * p[0] + b * p[1] <= c;
    const qIn = a * q[0] + b * q[1] <= c;
    if (pIn) out.push(p);
    if (pIn !== qIn) {
      const t = (c - a * p[0] - b * p[1]) / (a * (q[0] - p[0]) + b * (q[1] - p[1]));
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
};

// La plus grande ville d'une liste, pour nommer une province d'un seul tenant.
const largestCity = (cities) => [...cities]
  .sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0) || text(a.name).localeCompare(text(b.name)))[0]?.name ?? "";

// Un nom de région qui n'en est pas un (« Province #114499 », couleur d'une
// carte importée d'une image) : on le remplace par une ville.
export const isPlaceholderName = (name) => /^(province|region|région|state|état)?\s*#?[0-9a-f]{6}$/i.test(text(name))
  || /^(province|region|région|state|état)\s*#/i.test(text(name));

// La ville la plus proche d'un point, pour une région sans ville ni vrai nom.
const nearestCity = (cities, [x, y]) => {
  let best = null; let bestD = Infinity;
  const k = Math.cos((y * Math.PI) / 180) ** 2;
  for (const city of cities) {
    const [cx, cy] = city.coordinates;
    const d = (cx - x) ** 2 * k + (cy - y) ** 2;
    if (d < bestD) { bestD = d; best = city; }
  }
  return best?.name ?? "";
};

const areaKm2 = (geometry) => turfArea({ type: "Feature", geometry, properties: {} }) / 1e6;

// ---------------------------------------------------------------------------
// Une région
// ---------------------------------------------------------------------------

// Combien de provinces pour une région, d'après sa surface et ses villes.
export const provinceCountFor = (areaKm2Value, urbanPopulation, tuning = PROVINCE_TUNING) => {
  const density = urbanPopulation > 0
    ? 1 + tuning.urbanDensityPerDecade * Math.log10(1 + urbanPopulation / tuning.urbanReferencePopulation)
    : tuning.emptyRegionFactor;
  const wanted = Math.round((areaKm2Value * density) / tuning.targetKm2);
  return Math.min(tuning.maxPerRegion, Math.max(tuning.minPerRegion, wanted));
};

// Découpe une région en provinces. `cities` : [{ name, coordinates, population }]
// déjà situées dans la région. Renvoie [{ geometry, name, cityName, seed }].
export const splitRegion = (geometry, cities = [], tuning = PROVINCE_TUNING) => {
  const polygons = polygonsOf(geometry);
  if (!polygons.length) return [];
  const area = areaKm2(geometry);
  const urban = cities.reduce((sum, city) => sum + (Number(city.population) || 0), 0);
  const wanted = provinceCountFor(area, urban, tuning);
  if (wanted <= 1) return [{ geometry, cityName: largestCity(cities), seed: null }];

  // Projection locale : x = lng × cos(lat0), y = lat.
  const [minX, minY, maxX, maxY] = bboxOf(polygons);
  const cosLat = Math.max(0.05, Math.cos(((minY + maxY) / 2) * (Math.PI / 180)));
  const project = ([lng, lat]) => [lng * cosLat, lat];
  const unproject = ([x, y]) => [round5(x / cosLat), round5(y)];

  // 2. Échantillons sur une grille, à l'intérieur de la région.
  const width = (maxX - minX) * cosLat;
  const height = maxY - minY;
  const step = Math.sqrt((width * height) / (wanted * tuning.samplesPerProvince)) || 0.01;
  const samples = [];
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / (2 * cosLat); x < maxX; x += step / cosLat) {
      if (pointInPolygons([x, y], polygons)) samples.push(project([x, y]));
    }
  }
  if (samples.length < wanted) return [{ geometry, cityName: largestCity(cities), seed: null }];

  // 3. Graines : les plus grandes villes (fixes), puis le point le plus éloigné.
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const seeds = [];
  const byPopulation = [...cities]
    .filter((city) => Array.isArray(city.coordinates) && pointInPolygons(city.coordinates, polygons))
    .sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0) || text(a.name).localeCompare(text(b.name)));
  for (const city of byPopulation) {
    if (seeds.length >= wanted) break;
    const point = project(city.coordinates);
    // Deux villes collées ne font pas deux provinces.
    if (seeds.some((seed) => dist2(seed.point, point) < (step * 2) ** 2)) continue;
    seeds.push({ point, fixed: true, cityName: text(city.name) });
  }
  if (!seeds.length) {
    const mean = samples.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]).map((v) => v / samples.length);
    const first = samples.reduce((best, p) => (dist2(p, mean) < dist2(best, mean) ? p : best), samples[0]);
    seeds.push({ point: first, fixed: false, cityName: "" });
  }
  while (seeds.length < wanted) {
    let best = null; let bestDistance = -1;
    for (const sample of samples) {
      const nearest = Math.min(...seeds.map((seed) => dist2(seed.point, sample)));
      if (nearest > bestDistance) { bestDistance = nearest; best = sample; }
    }
    seeds.push({ point: best, fixed: false, cityName: "" });
  }

  // 4. Lloyd : chaque graine libre au centre de ses échantillons.
  for (let pass = 0; pass < tuning.lloydPasses; pass += 1) {
    const sums = seeds.map(() => [0, 0, 0]);
    for (const sample of samples) {
      let index = 0; let nearest = Infinity;
      seeds.forEach((seed, i) => { const d = dist2(seed.point, sample); if (d < nearest) { nearest = d; index = i; } });
      sums[index][0] += sample[0]; sums[index][1] += sample[1]; sums[index][2] += 1;
    }
    seeds.forEach((seed, i) => {
      if (!seed.fixed && sums[i][2] > 0) seed.point = [sums[i][0] / sums[i][2], sums[i][1] / sums[i][2]];
    });
  }

  // 5. Cellules de Voronoï (convexes, en projection), découpées par la région.
  const margin = step * 4 + 1;
  const frame = [
    [minX * cosLat - margin, minY - margin], [maxX * cosLat + margin, minY - margin],
    [maxX * cosLat + margin, maxY + margin], [minX * cosLat - margin, maxY + margin],
  ];
  const provinces = [];
  seeds.forEach((seed, i) => {
    let cell = frame;
    seeds.forEach((other, j) => {
      if (i === j || !cell.length) return;
      const a = other.point[0] - seed.point[0];
      const b = other.point[1] - seed.point[1];
      const c = (a * (seed.point[0] + other.point[0])) / 2 + (b * (seed.point[1] + other.point[1])) / 2;
      cell = clipConvex(cell, a, b, c);
    });
    if (cell.length < 3) return;
    const ring = cell.map(unproject);
    ring.push(ring[0]);
    let clipped;
    try {
      clipped = polygonClipping.intersection(polygons, [[ring]]);
    } catch {
      return;
    }
    if (!clipped.length) return;
    provinces.push({
      geometry: clipped.length === 1 ? { type: "Polygon", coordinates: clipped[0] } : { type: "MultiPolygon", coordinates: clipped },
      cityName: seed.cityName,
      seed: unproject(seed.point),
    });
  });
  return provinces.length ? provinces : [{ geometry, cityName: largestCity(cities), seed: null }];
};

// ---------------------------------------------------------------------------
// Toute la carte
// ---------------------------------------------------------------------------

// Une région d'un autre type que « land » (typeId de l'éditeur de carte) est de
// l'eau : une mer, un lac. Elle n'a pas de provinces, et une province qui la
// touche est côtière.
export const isLandRegion = (feature) => {
  const type = text(feature?.properties?.typeId);
  return !type || type === "land";
};

const regionIdOf = (feature, index) => text(
  feature?.properties?.id ?? feature?.properties?.GID_1 ?? feature?.properties?.gid_1 ?? feature?.id,
) || `region-${index + 1}`;

// Génère toutes les provinces. `regions` : FeatureCollection des régions ;
// `cities` : [{ name, coordinates, population }]. Renvoie
// { provinces: FeatureCollection, adjacency: { id: [ids] }, stats }.
export const generateProvinces = (regions, { cities = [], tuning = PROVINCE_TUNING } = {}) => {
  const started = Date.now();
  const features = [];
  const regionFeatures = Array.isArray(regions?.features) ? regions.features : [];
  // Les villes, rangées par région (point dans le polygone), une fois.
  const cityRows = cities.filter((city) => city?.name && Array.isArray(city.coordinates));
  regionFeatures.forEach((region, index) => {
    const polygons = polygonsOf(region?.geometry);
    if (!polygons.length || !isLandRegion(region)) return;
    const [minX, minY, maxX, maxY] = bboxOf(polygons);
    const inside = cityRows.filter(({ coordinates: [x, y] }) => x >= minX && x <= maxX && y >= minY && y <= maxY
      && pointInPolygons([x, y], polygons));
    const regionId = regionIdOf(region, index);
    const ownName = text(region?.properties?.name);
    const regionName = (!isPlaceholderName(ownName) && ownName)
      || largestCity(inside)
      || nearestCity(cityRows, [(minX + maxX) / 2, (minY + maxY) / 2])
      || ownName || regionId;
    const parts = splitRegion(region.geometry, inside, tuning);
    parts.forEach((part, k) => {
      const partPolygons = polygonsOf(part.geometry);
      // Le nom : la ville qui a donné la graine, sinon la plus grande dans la
      // province, sinon « Région – n ».
      const partCities = inside.filter((city) => pointInPolygons(city.coordinates, partPolygons));
      const cityName = part.cityName || [...partCities]
        .sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0))[0]?.name || "";
      const city = partCities.find((entry) => text(entry.name) === cityName);
      features.push({
        type: "Feature",
        properties: {
          id: `${regionId}#${k + 1}`,
          regionId,
          name: cityName || regionName,
          owner: text(region?.properties?.owner),
          city: cityName,
          ...(city ? { anchor: city.coordinates.map((value) => Math.round(value * 1e4) / 1e4) } : {}),
          areaKm2: Math.round(areaKm2(part.geometry)),
          population: partCities.reduce((sum, entry) => sum + (Number(entry.population) || 0), 0),
        },
        geometry: part.geometry,
      });
    });
  });

  // Les provinces sans ville : « Région – n », numérotées sur toute la carte
  // quand plusieurs partagent un nom (ou qu'une province-ville le porte déjà).
  const cityNames = new Set(features.filter((feature) => feature.properties.city).map((feature) => feature.properties.name));
  const unnamed = new Map();
  for (const feature of features) {
    if (feature.properties.city) continue;
    const base = feature.properties.name;
    if (!unnamed.has(base)) unnamed.set(base, []);
    unnamed.get(base).push(feature);
  }
  for (const [base, group] of unnamed) {
    if (group.length === 1 && !cityNames.has(base)) continue;
    group.forEach((feature, k) => { feature.properties.name = `${base} – ${k + 1}`; });
  }

  // Voisinages et côtes, par les sommets partagés. Une case que touche une
  // région d'eau est une côte ; sur une carte sans régions d'eau, une case que
  // rien d'autre ne touche aussi.
  const bucket = tuning.vertexBucketDegrees;
  const keyOf = (x, y) => `${Math.round(x / bucket)}:${Math.round(y / bucket)}`;
  const owners = new Map(); // case → Set d'index de provinces
  features.forEach((feature, index) => {
    for (const polygon of polygonsOf(feature.geometry)) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          const key = keyOf(x, y);
          if (!owners.has(key)) owners.set(key, new Set());
          owners.get(key).add(index);
        }
      }
    }
  });
  const water = new Set();
  for (const region of regionFeatures) {
    if (isLandRegion(region)) continue;
    for (const polygon of polygonsOf(region?.geometry)) {
      for (const ring of polygon) for (const [x, y] of ring) water.add(keyOf(x, y));
    }
  }
  const shared = features.map(() => new Map());
  const alone = features.map(() => 0);
  for (const [key, set] of owners) {
    if (water.has(key) || (set.size === 1 && !water.size)) {
      for (const index of set) alone[index] += 1;
    }
    if (set.size === 1) continue;
    const list = [...set];
    for (const a of list) for (const b of list) if (a !== b) shared[a].set(b, (shared[a].get(b) ?? 0) + 1);
  }
  const adjacency = {};
  features.forEach((feature, index) => {
    const neighbours = [...shared[index]].filter(([, count]) => count >= tuning.minSharedBuckets).map(([other]) => features[other].properties.id);
    adjacency[feature.properties.id] = neighbours.sort();
    feature.properties.coastal = alone[index] >= tuning.minCoastBuckets;
  });

  return {
    provinces: { type: "FeatureCollection", features },
    adjacency,
    stats: { regions: regionFeatures.length, provinces: features.length, ms: Date.now() - started },
  };
};
