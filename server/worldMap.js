/*! Carte mondiale unique (phase 5) — ce que le serveur en sert. */
// La carte est générée une fois, hors du jeu (scripts/worldmap/build.mjs puis
// tiles.mjs), dans DATA_DIR/worldmap/v1/. Le serveur ne fait que la servir :
//   GET /api/worldmap/status                   { available, version, provinces, … }
//   GET /api/worldmap/v1/tiles/:z/:x/:y.pbf    tuiles vectorielles (204 si vide)
//   GET /api/worldmap/v1/:file                 attributs (liste fermée ci-dessous)

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir.js";

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
  };
};

const int = (value) => (/^\d{1,3}$/.test(String(value)) ? Number(value) : null);

export const registerWorldMapRoutes = (app) => {
  app.get("/api/worldmap/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(worldMapStatus());
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
