/*! Carte mondiale unique (phase 5, étape E) — les états, régions du jeu. */
// Dans une partie sur la carte mondiale, les « régions » que le jeu et l'IA
// connaissent (regionsGeojson : transferts, contrôle, recherche des lieux,
// description de la carte dans les prompts) sont les ÉTATS de la carte
// mondiale : chaque état est la réunion de ses provinces (provinces.v1.json du
// scénario), sur la trame à 0,1° de la carte (worldMapSurfaces.js).
//
// Les numéros d'états sont ceux des anciennes régions (plus « ~pays » pour les
// morceaux que la correction de 1936 a détachés) : les propriétés de départ de
// la partie (world.regionOwnershipOverrides) valent donc telles quelles.
//
// Le fichier est écrit une fois à côté du scénario (states.v1.geojson) et
// refait quand le scénario converti ou la carte changent.

import fs from "fs";
import path from "path";
import { dissolveOwners } from "./worldMapSurfaces.js";
import { WORLD_MAP_DIR, worldMapStatus } from "./worldMap.js";

export const STATES_FILE = "states.v1.geojson";

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

// Un état que la trame à 0,1° ne voit pas (un îlot) : un petit carré autour
// du centre de chacune de ses provinces.
const squares = (centers, half = 0.04) => centers.map(([x, y]) => [[
  [x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half], [x - half, y - half],
]]);

// adjacency : { province: [[voisine, genre]…] } (adjacency.json de la carte).
export const buildStatesGeojson = ({ scenario, provinces, adjacency = {}, legacyRegions }) => {
  const states = scenario.states.map((state) => String(state ?? ""));
  const surfaces = dissolveOwners(states);
  const geometry = new Map(surfaces.features.map((f) => [f.properties.owner, f.geometry]));
  const centers = new Map();
  states.forEach((state, k) => {
    if (!state) return;
    if (!centers.has(state)) centers.set(state, []);
    centers.get(state).push(provinces[k]?.center ?? provinces[k]?.anchor);
  });
  // Les états voisins (une limite de terre ou de fleuve entre deux de leurs
  // provinces), et le point de chaque état : sa province la plus peuplée.
  const neighbours = new Map();
  const anchor = new Map();
  states.forEach((state, k) => {
    if (!state) return;
    const p = provinces[k];
    const best = anchor.get(state);
    if (p && (!best || (p.population || 0) > (best.population || 0) || (!best.population && p.areaKm2 > best.areaKm2))) anchor.set(state, p);
    for (const [other] of adjacency[k + 1] ?? []) {
      const s2 = states[other - 1];
      if (!s2 || s2 === state) continue;
      if (!neighbours.has(state)) neighbours.set(state, new Set());
      neighbours.get(state).add(s2);
    }
  });
  const features = [];
  for (const [state, list] of centers) {
    const info = scenario.stateInfo?.[state] ?? {};
    features.push({
      type: "Feature",
      properties: {
        id: state,
        name: info.name || state,
        owner: scenario.stateOwners?.[state] ?? "",
        gid0: "",
        typeId: "land",
        provinces: list.length,
        ...(Array.isArray(info.aliases) && info.aliases.length ? { aliases: info.aliases } : {}),
        adjacencies: [...(neighbours.get(state) ?? [])].sort(),
        ...(anchor.get(state)?.anchor ? { lng: anchor.get(state).anchor[0], lat: anchor.get(state).anchor[1] } : {}),
        worldMap: "v1",
      },
      geometry: geometry.get(state) ?? { type: "MultiPolygon", coordinates: squares(list.filter(Boolean)) },
    });
  }
  // Les étendues d'eau de l'ancienne carte (types autres que « land ») restent.
  for (const f of legacyRegions?.features ?? []) {
    if (f?.properties?.typeId && f.properties.typeId !== "land") features.push(f);
  }
  return { type: "FeatureCollection", features };
};

// Le fichier des états du scénario (scenarioFile : son provinces.v1.json),
// écrit s'il manque ou date d'avant le scénario ou la carte.
export const ensureStatesGeojson = (scenarioFile) => {
  const dir = path.dirname(scenarioFile);
  const target = path.join(dir, STATES_FILE);
  const stamp = `${fs.statSync(scenarioFile).mtimeMs}|${worldMapStatus().stamp}`;
  const stampFile = `${target}.stamp`;
  if (fs.existsSync(target) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) return target;
  const scenario = readJson(scenarioFile);
  const provinces = readJson(path.join(WORLD_MAP_DIR, "provinces.json"), []);
  if (!scenario?.states || !provinces.length) return null;
  const legacyRegions = readJson(path.join(dir, "regions.geojson"));
  const adjacency = readJson(path.join(WORLD_MAP_DIR, "adjacency.json"), {});
  const geojson = buildStatesGeojson({ scenario, provinces, adjacency, legacyRegions });
  fs.writeFileSync(target, JSON.stringify(geojson));
  fs.writeFileSync(stampFile, stamp);
  return target;
};
