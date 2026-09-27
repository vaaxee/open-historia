#!/usr/bin/env node
// Aperçu de la carte mondiale des provinces, en PNG (équirectangulaire,
// corrigée de la latitude moyenne) : provinces en couleurs douces, limites
// fines, côtes, grands fleuves.
//
//   node scripts/worldmap/render.mjs <ouest> <sud> <est> <nord> <fichier.png> [largeur]

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";
import { writePng } from "./lib/png.mjs";
import { readZip } from "./lib/zip.mjs";
import { shapefileFromZip } from "./lib/shapefile.mjs";

const WORLDMAP = path.join(DATA_DIR, "worldmap");
const [west, south, east, north] = process.argv.slice(2, 6).map(Number);
const file = process.argv[6];
const width = Number(process.argv[7] || 1600);
const k = Math.cos((((north + south) / 2) * Math.PI) / 180);
const height = Math.round((width * (north - south)) / ((east - west) * k));
const toPx = ([lng, lat]) => [((lng - west) / (east - west)) * width, ((north - lat) / (north - south)) * height];

const px = new Uint8Array(width * height * 3);
const SEA = [168, 196, 214];
for (let p = 0; p < width * height; p += 1) px.set(SEA, p * 3);

const fill = (rings, rgb) => {
  const rows = new Map();
  for (const ring of rings) {
    const pts = ring.map(toPx);
    for (let e = 0; e < pts.length - 1; e += 1) {
      const [x0, y0] = pts[e]; const [x1, y1] = pts[e + 1];
      if (y0 === y1) continue;
      const top = Math.min(y0, y1); const bottom = Math.max(y0, y1);
      for (let y = Math.max(0, Math.ceil(top - 0.5)); y <= Math.min(height - 1, Math.floor(bottom - 0.5)); y += 1) {
        const cy = y + 0.5;
        if (cy < top || cy >= bottom) continue;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
  }
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let e = 0; e + 1 < xs.length; e += 2) {
      for (let x = Math.max(0, Math.ceil(xs[e] - 0.5)); x < Math.min(width, Math.ceil(xs[e + 1] - 0.5)); x += 1) px.set(rgb, (y * width + x) * 3);
    }
  }
};
// Trait anticrénelé (mélange selon la couverture), épaisseur ≈ 1 px.
const plot = (x, y, rgb, alpha) => {
  if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;
  const at = (y * width + x) * 3;
  for (let c = 0; c < 3; c += 1) px[at + c] = Math.round(px[at + c] * (1 - alpha) + rgb[c] * alpha);
};
const line = (points, rgb, strength = 1) => {
  const pts = points.map(toPx);
  for (let e = 0; e < pts.length - 1; e += 1) {
    const [x0, y0] = pts[e]; const [x1, y1] = pts[e + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s += 1) {
      const x = x0 + ((x1 - x0) * s) / steps; const y = y0 + ((y1 - y0) * s) / steps;
      const xi = Math.floor(x); const yi = Math.floor(y); const fx = x - xi; const fy = y - yi;
      plot(xi, yi, rgb, strength * 0.5 * (1 - fx) * (1 - fy));
      plot(xi + 1, yi, rgb, strength * 0.5 * fx * (1 - fy));
      plot(xi, yi + 1, rgb, strength * 0.5 * (1 - fx) * fy);
      plot(xi + 1, yi + 1, rgb, strength * 0.5 * fx * fy);
    }
  }
};

const colour = (id) => {
  let h = Math.imul(id, 2654435761) >>> 0;
  const r = 196 + (h & 31); h >>>= 5; const g = 184 + (h & 31); h >>>= 5; const b = 150 + (h & 31);
  return [r, g, b];
};
const inView = (rings) => rings.some((ring) => ring.some(([x, y]) => x >= west - 2 && x <= east + 2 && y >= south - 2 && y <= north + 2));

const provinces = JSON.parse(fs.readFileSync(path.join(WORLDMAP, "v1", "provinces.geojson"), "utf8")).features;
const shown = [];
for (const feature of provinces) {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  if (!polygons.some((polygon) => inView(polygon))) continue;
  shown.push(feature.properties.id);
  for (const polygon of polygons) fill(polygon, colour(feature.properties.id));
}
for (const feature of provinces) {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) if (inView(polygon)) for (const ring of polygon) line(ring, [70, 60, 50], 0.9);
}
// Grands fleuves (Natural Earth), pour juger si les limites les suivent.
const rivers = shapefileFromZip(readZip(path.join(WORLDMAP, "sources", "ne_10m_rivers_lake_centerlines.zip")));
for (const feature of rivers) {
  if (Number(feature.properties.scalerank) > 6) continue;
  const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const l of lines) if (inView([l])) line(l, [40, 100, 190], 1.4);
}
writePng(file, width, height, px);
console.log(`${file} : ${width} × ${height}, ${shown.length} provinces`);
