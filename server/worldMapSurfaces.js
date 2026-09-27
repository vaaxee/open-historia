/*! Carte mondiale unique (phase 5) — la forme de chaque pays, pour placer son nom. */
// Les noms de pays sont placés et courbés par le moteur de noms du jeu
// (src/Game/Map/vnext/polityLabels.js) sur la forme réelle de chaque pays. Avec
// la carte mondiale, un pays est une réunion de provinces : on la calcule ici,
// sur la trame des provinces à 0,1° (grid-0.1.bin.gz, écrite par la
// génération), en suivant les limites entre propriétaires différents.
//
//   POST /api/worldmap/surfaces   { owners: ["France", "", "Germany", …] }
//        (owners[k] = propriétaire de la province k + 1)
//   →    FeatureCollection, une entité par propriétaire : { owner }, MultiPolygon

import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { makeTracer } from "./worldMapTrace.js";
import { WORLD_MAP_DIR } from "./worldMap.js";

let grid = null;
const loadGrid = () => {
  if (grid) return grid;
  const meta = JSON.parse(fs.readFileSync(path.join(WORLD_MAP_DIR, "meta.json"), "utf8"));
  const info = meta.coarseGrid;
  if (!info) throw new Error("world map has no coarse grid (rerun scripts/worldmap/build.mjs --from attributes)");
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(WORLD_MAP_DIR, info.file)));
  grid = {
    ...info,
    cells: new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2),
    tracer: makeTracer({ W: info.width, H: info.height, step: info.step, latTop: info.latTop }),
  };
  return grid;
};

const cache = new Map(); // empreinte des propriétaires → FeatureCollection
const CACHE_SIZE = 8;

export const dissolveOwners = (owners) => {
  const key = crypto.createHash("sha1").update(JSON.stringify(owners)).digest("hex");
  if (cache.has(key)) return cache.get(key);
  const { cells, width, height, tracer } = loadGrid();
  const index = new Map(); const names = [""];
  const ownerIndex = new Int32Array(owners.length + 1);
  owners.forEach((owner, k) => {
    const name = String(owner ?? "").trim();
    if (!name) return;
    if (!index.has(name)) { index.set(name, names.length); names.push(name); }
    ownerIndex[k + 1] = index.get(name);
  });
  const raster = new Int32Array(width * height);
  for (let c = 0; c < raster.length; c += 1) raster[c] = ownerIndex[cells[c]] ?? 0;
  const pieces = new Map();
  for (const arc of tracer.traceArcs(raster)) {
    const points = tracer.smoothArc(arc, { tolerance: 0.7, passes: 2, rough: null }).map(tracer.toLngLat);
    for (const [side, reversed] of [[arc.left, false], [arc.right, true]]) {
      if (!side) continue;
      if (!pieces.has(side)) pieces.set(side, []);
      pieces.get(side).push({ points: reversed ? points.slice().reverse() : points, closed: arc.closed });
    }
  }
  const features = [];
  for (const [k, own] of pieces) {
    const { polygons } = tracer.assemble(own);
    if (!polygons.length) continue;
    features.push({ type: "Feature", properties: { owner: names[k] }, geometry: { type: "MultiPolygon", coordinates: polygons } });
  }
  const result = { type: "FeatureCollection", features };
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return result;
};

export const registerWorldMapSurfaceRoutes = (app, jsonParser) => {
  app.post("/api/worldmap/surfaces", jsonParser, (req, res) => {
    try {
      const owners = Array.isArray(req.body?.owners) ? req.body.owners.map((value) => String(value ?? "")) : null;
      if (!owners) return res.status(400).json({ error: "owners: tableau attendu" });
      res.setHeader("Cache-Control", "no-store");
      return res.json(dissolveOwners(owners));
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? error) });
    }
  });
};
