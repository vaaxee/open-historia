// La grille de travail de la carte mondiale : 0,05° (≈ 5 km), de 58° S à 84° N
// (sans l'Antarctique), 7 200 × 2 840 cases. La case (i, j) couvre les
// longitudes [-180 + i·pas, -180 + (i+1)·pas] et les latitudes
// [84 - (j+1)·pas, 84 - j·pas] ; son indice est j·W + i.

import fs from "fs";
import path from "path";

export const STEP = 0.05;
export const LAT_TOP = 84;
export const LAT_BOTTOM = -58;
export const W = Math.round(360 / STEP);
export const H = Math.round((LAT_TOP - LAT_BOTTOM) / STEP);
export const N = W * H;

export const lngOf = (i) => -180 + (i + 0.5) * STEP;
export const latOf = (j) => LAT_TOP - (j + 0.5) * STEP;
export const colOf = (lng) => Math.floor((lng + 180) / STEP);
export const rowOf = (lat) => Math.floor((LAT_TOP - lat) / STEP);
export const cellOf = (lng, lat) => {
  const i = colOf(lng); const j = rowOf(lat);
  return i >= 0 && i < W && j >= 0 && j < H ? j * W + i : -1;
};
// Surface d'une case de la ligne j, en km².
export const cellKm2 = (j) => (STEP * 111.32) ** 2 * Math.cos((latOf(j) * Math.PI) / 180);

export const ringsOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
};
export const linesOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
};

// Remplissage pair-impair d'anneaux : visit(j, i0, i1) pour chaque suite de
// cases de la ligne j dont le centre est dedans (i0 inclus, i1 exclu).
export const scanRings = (rings, visit) => {
  const rows = new Map();
  for (const ring of rings) {
    for (let k = 0; k < ring.length - 1; k += 1) {
      const [x0, y0] = ring[k]; const [x1, y1] = ring[k + 1];
      if (y0 === y1) continue;
      const top = Math.max(y0, y1); const bottom = Math.min(y0, y1);
      // Les lignes dont le centre est dans [bottom, top[.
      const jStart = Math.max(0, Math.ceil((LAT_TOP - top) / STEP - 0.5));
      const jEnd = Math.min(H - 1, Math.floor((LAT_TOP - bottom) / STEP - 0.5));
      for (let j = jStart; j <= jEnd; j += 1) {
        const y = latOf(j);
        if (y >= top || y < bottom) continue;
        const x = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
        if (!rows.has(j)) rows.set(j, []);
        rows.get(j).push(x);
      }
    }
  }
  for (const [j, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] + 180) / STEP - 0.5));
      const i1 = Math.min(W, Math.ceil((xs[k + 1] + 180) / STEP - 0.5));
      if (i1 > i0) visit(j, i0, i1);
    }
  }
};

export const fillRings = (target, rings, value) => scanRings(rings, (j, i0, i1) => target.fill(value, j * W + i0, j * W + i1));

// Les cases traversées par une ligne (pas d'un demi-pas).
export const traceLine = (line, visit) => {
  for (let k = 0; k < line.length - 1; k += 1) {
    const [x0, y0] = line[k]; const [x1, y1] = line[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (STEP / 2)));
    for (let s = 0; s <= steps; s += 1) {
      const cell = cellOf(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
      if (cell >= 0) visit(cell);
    }
  }
};

// Les 8 voisines d'une case (sans passer l'antiméridien), avec leur distance
// en « pas » (1 ou √2) : visit(voisine, distance).
const DIAG = Math.SQRT2;
export const eachNeighbour = (cell, visit) => {
  const i = cell % W; const j = (cell - i) / W;
  const left = i > 0; const right = i < W - 1; const up = j > 0; const down = j < H - 1;
  if (left) visit(cell - 1, 1);
  if (right) visit(cell + 1, 1);
  if (up) { visit(cell - W, 1); if (left) visit(cell - W - 1, DIAG); if (right) visit(cell - W + 1, DIAG); }
  if (down) { visit(cell + W, 1); if (left) visit(cell + W - 1, DIAG); if (right) visit(cell + W + 1, DIAG); }
};

// Cache des étapes : un tableau typé par fichier binaire.
export const cached = (dir, name, Type, build) => {
  const file = path.join(dir, `${name}.bin`);
  if (fs.existsSync(file)) {
    const buffer = fs.readFileSync(file);
    return new Type(buffer.buffer, buffer.byteOffset, buffer.byteLength / Type.BYTES_PER_ELEMENT);
  }
  const started = Date.now();
  const array = build();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  console.log(`  ${name} : ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return array;
};
