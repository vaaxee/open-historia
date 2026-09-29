/*! Carte mondiale unique (phase 5) — ce que le serveur en sert. */
// La carte est générée une fois, hors du jeu (scripts/worldmap/build.mjs puis
// tiles.mjs), dans DATA_DIR/worldmap/v1/. Le serveur ne fait que la servir :
//   GET /api/worldmap/status                   { available, version, provinces, … }
//   GET /api/worldmap/v1/tiles/:z/:x/:y.pbf    tuiles vectorielles (204 si vide)
//   GET /api/worldmap/v1/:file                 attributs (liste fermée ci-dessous)
//   GET /api/worldmap/scenario                 le scénario actif sur la carte mondiale
//                                              (provinces.v1.json, écrit par
//                                              scripts/worldmap/convert-scenario.mjs), 404 sinon

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir.js";
import { getActiveGameSummary, resolveRuntimeGeojsonAsset } from "./libraryStore.js";

export const WORLD_MAP_DIR = path.join(DATA_DIR, "worldmap", "v1");
export const WORLD_MAP_FILES = Object.freeze([
  "meta.json", "provinces.json", "adjacency.json", "states-default.json", "countries-today.json", "tiles.json", "arcs-index.json",
]);

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(WORLD_MAP_DIR, file), "utf8"));
  } catch {
    return null;
  }
};

export const worldMapStatus = () => {
  const meta = readJson("meta.json");
  const tiles = readJson("tiles.json");
  return {
    available: Boolean(meta && tiles),
    version: meta?.version ?? null,
    provinces: meta?.landProvinces ?? 0,
    seaIdRange: meta?.seaIdRange ?? null,
    maxzoom: tiles?.maxzoom ?? null,
    // Change à chaque génération : les adresses des tuiles en dépendent, pour
    // qu'un navigateur ne garde jamais des tuiles d'une carte précédente.
    stamp: `${meta?.generatedAt ?? ""}-${tiles?.bytes ?? 0}`.replace(/[^0-9A-Za-z-]/g, ""),
  };
};

export const TEXTURE_MAX_ZOOM = 6;
const int = (value) => (/^\d{1,3}$/.test(String(value)) ? Number(value) : null);

// Le fichier de la carte mondiale du scénario actif : à côté de ses régions.
export const activeScenarioWorldMapFile = () => {
  const regions = resolveRuntimeGeojsonAsset("regionsGeojson")?.sourcePath;
  if (!regions) return null;
  const file = path.join(path.dirname(regions), "provinces.v1.json");
  return fs.existsSync(file) ? file : null;
};

// La partie active se joue-t-elle sur la carte mondiale ? (posé à sa création :
// server/libraryStore.js, createGame). Le fichier de son scénario, sinon null.
export const activeGameWorldMapFile = () => {
  try {
    if (getActiveGameSummary()?.worldMap !== "v1") return null;
    return worldMapStatus().available ? activeScenarioWorldMapFile() : null;
  } catch {
    return null;
  }
};

export const registerWorldMapRoutes = (app) => {
  app.get("/api/worldmap/scenario", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const file = activeScenarioWorldMapFile();
    if (!file) return res.status(404).json({ available: false });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return fs.createReadStream(file).pipe(res);
  });
  // Les capitales du scénario de la partie (provinces.v1.json, capitals), pour
  // l'IA ; vide hors d'une partie sur la carte mondiale.
  app.get("/api/worldmap/capitals", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const file = activeGameWorldMapFile();
    let capitals = {};
    try {
      if (file) capitals = JSON.parse(fs.readFileSync(file, "utf8"))?.capitals ?? {};
    } catch { /* un fichier illisible : pas de capitales */ }
    res.json({ capitals });
  });
  // Phase 7.2 : ce que le ravitaillement sait de chaque état du scénario de la
  // partie (terrain, côte, voies ferrées), écrit par scripts/worldmap/supply-states.mjs.
  // Vide hors d'une partie sur la carte mondiale, ou tant que le fichier manque.
  app.get("/api/worldmap/supply", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const file = activeGameWorldMapFile();
    let states = {};
    try {
      if (file) {
        const scenarioId = path.basename(path.dirname(file));
        const supply = path.join(WORLD_MAP_DIR, `supply-${scenarioId}.json`);
        if (fs.existsSync(supply)) states = JSON.parse(fs.readFileSync(supply, "utf8"))?.states ?? {};
      }
    } catch { /* un fichier illisible : pas de données de ravitaillement */ }
    res.json({ states });
  });
  // Phase 7.8 : les zones de mer du scénario de la partie (centre, voisines,
  // états côtiers), écrites par scripts/worldmap/seas.mjs. Vide sinon.
  app.get("/api/worldmap/seas", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const file = activeGameWorldMapFile();
    let zones = {}; let stateSeas = {};
    try {
      if (file) {
        const scenarioId = path.basename(path.dirname(file));
        const seas = path.join(WORLD_MAP_DIR, `seas-${scenarioId}.json`);
        if (fs.existsSync(seas)) ({ zones = {}, stateSeas = {} } = JSON.parse(fs.readFileSync(seas, "utf8")) ?? {});
      }
    } catch { /* un fichier illisible : pas de zones de mer */ }
    // Les lacs (zones marquées `lake` par seas.mjs) ne sont pas la mer.
    zones = Object.fromEntries(Object.entries(zones).filter(([, zone]) => !zone?.lake));
    res.json({ zones, stateSeas });
  });
  // Phase 9 : le relief, tuiles d'altitude Terrarium des zooms 0 à 4
  // (hoi-elevation/terrarium ; scripts/worldmap/dem-pyramid.mjs pour 0 à 3).
  // 204 quand une tuile manque : MapLibre dessine alors sans relief.
  app.get("/api/worldmap/dem/:z/:x/:y.png", (req, res) => {
    const z = int(req.params.z); const x = int(req.params.x); const y = int(req.params.y);
    if (z === null || x === null || y === null || z < 0 || z > 4) return res.status(400).end();
    const file = path.join(DATA_DIR, "hoi-elevation", "terrarium", String(z), String(x), `${y}.png`);
    if (!fs.existsSync(file)) return res.status(204).end();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(file).pipe(res);
  });
  // Phase 9 (suite) : la texture de terrain Natural Earth II, zooms 0 à 6
  // (hoi-texture/ne2 ; scripts/worldmap/texture-tiles.mjs). 204 pour une tuile
  // en pleine mer ou absente : la carte garde alors ses aplats de terrain.
  app.get("/api/worldmap/texture/:z/:x/:y.png", (req, res) => {
    const z = int(req.params.z); const x = int(req.params.x); const y = int(req.params.y);
    if (z === null || x === null || y === null || z < 0 || z > TEXTURE_MAX_ZOOM) return res.status(400).end();
    const file = path.join(DATA_DIR, "hoi-texture", "ne2", String(z), String(x), `${y}.png`);
    if (!fs.existsSync(file)) return res.status(204).end();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(file).pipe(res);
  });
  app.get("/api/worldmap/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...worldMapStatus(), game: Boolean(activeGameWorldMapFile()) });
  });
  app.get("/api/worldmap/v1/tiles/:z/:x/:y.pbf", (req, res) => {
    const z = int(req.params.z); const x = int(req.params.x); const y = int(req.params.y);
    if (z === null || x === null || y === null) return res.status(400).end();
    const file = path.join(WORLD_MAP_DIR, "tiles", String(z), String(x), `${y}.pbf`);
    if (!fs.existsSync(file)) return res.status(204).end();
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return fs.createReadStream(file).pipe(res);
  });
  app.get("/api/worldmap/v1/:file", (req, res) => {
    const name = String(req.params.file);
    if (!WORLD_MAP_FILES.includes(name)) return res.status(404).end();
    const file = path.join(WORLD_MAP_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return fs.createReadStream(file).pipe(res);
  });
};
