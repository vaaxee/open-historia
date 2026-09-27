// De la trame des provinces aux contours : les limites entre cases de
// provinces différentes, suivies en arcs (d'un nœud à trois provinces ou plus
// jusqu'au suivant), lissées, puis rassemblées en anneaux par province. Deux
// provinces voisines partagent exactement le même arc : ni trou ni chevauchement.

import { H, LAT_TOP, STEP, W } from "./grid.mjs";

// Réseau : sommets (x, y), x ∈ [0, W], y ∈ [0, H], y vers le sud.
const VW = W + 1;
const labelAt = (labels, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : labels[y * W + x]);

// Arête horizontale (x, y)→(x+1, y) : entre (x, y-1) au nord et (x, y) au sud.
// Arête verticale (x, y)→(x, y+1) : entre (x-1, y) à l'ouest et (x, y) à l'est.
const hBoundary = (labels, x, y) => labelAt(labels, x, y - 1) !== labelAt(labels, x, y);
const vBoundary = (labels, x, y) => labelAt(labels, x - 1, y) !== labelAt(labels, x, y);

// Les arêtes de limite qui partent d'un sommet : [dx, dy].
const incident = (labels, x, y) => {
  const out = [];
  if (x < W && hBoundary(labels, x, y)) out.push([1, 0]);
  if (x > 0 && hBoundary(labels, x - 1, y)) out.push([-1, 0]);
  if (y < H && vBoundary(labels, x, y)) out.push([0, 1]);
  if (y > 0 && vBoundary(labels, x, y - 1)) out.push([0, -1]);
  return out;
};

// Province à gauche / à droite d'une arête parcourue de (x, y) vers (x+dx, y+dy)
// (y vers le sud : « à gauche » en allant vers l'est, c'est le nord).
const sides = (labels, x, y, dx, dy) => {
  if (dx === 1) return [labelAt(labels, x, y - 1), labelAt(labels, x, y)];
  if (dx === -1) return [labelAt(labels, x - 1, y), labelAt(labels, x - 1, y - 1)];
  if (dy === 1) return [labelAt(labels, x, y), labelAt(labels, x - 1, y)];
  return [labelAt(labels, x - 1, y - 1), labelAt(labels, x, y - 1)];
};

// Toutes les arcs : { points: [[x, y]…], left, right, closed }.
export const traceArcs = (labels) => {
  const hSeen = new Uint8Array(W * (H + 1));
  const vSeen = new Uint8Array((W + 1) * H);
  const seen = (x, y, dx, dy) => {
    if (dx) { const ex = dx > 0 ? x : x - 1; return hSeen[y * W + ex]; }
    const ey = dy > 0 ? y : y - 1; return vSeen[ey * VW + x];
  };
  const mark = (x, y, dx, dy) => {
    if (dx) { const ex = dx > 0 ? x : x - 1; hSeen[y * W + ex] = 1; } else { const ey = dy > 0 ? y : y - 1; vSeen[ey * VW + x] = 1; }
  };
  const isNode = (x, y) => {
    const edges = incident(labels, x, y);
    if (edges.length !== 2) return edges.length > 0;
    // Deux arêtes, mais trois provinces autour ? (impossible) ; deux arêtes
    // opposées ou en coin : un simple passage.
    return false;
  };
  const arcs = [];
  const walk = (sx, sy, dx0, dy0) => {
    const [left, right] = sides(labels, sx, sy, dx0, dy0);
    const points = [[sx, sy]];
    let x = sx; let y = sy; let dx = dx0; let dy = dy0;
    for (;;) {
      mark(x, y, dx, dy);
      x += dx; y += dy;
      points.push([x, y]);
      if (x === sx && y === sy) return { points, left, right, closed: true };
      if (isNode(x, y)) return { points, left, right, closed: false };
      const next = incident(labels, x, y).find(([ex, ey]) => !(ex === -dx && ey === -dy));
      [dx, dy] = next;
    }
  };
  // Depuis les nœuds.
  for (let y = 0; y <= H; y += 1) {
    for (let x = 0; x <= W; x += 1) {
      const edges = incident(labels, x, y);
      if (!edges.length || edges.length === 2) continue;
      for (const [dx, dy] of edges) if (!seen(x, y, dx, dy)) arcs.push(walk(x, y, dx, dy));
    }
  }
  // Les boucles sans nœud (une province entourée d'une seule autre).
  for (let y = 0; y <= H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (hBoundary(labels, x, y) && !hSeen[y * W + x]) arcs.push(walk(x, y, 1, 0));
    }
  }
  return arcs;
};

// ---------------------------------------------------------------------------
// Lissage : escaliers de la trame simplifiés (Douglas-Peucker), puis adoucis
// (Chaikin). Les extrémités d'un arc ouvert ne bougent pas.
// ---------------------------------------------------------------------------
const simplify = (points, tolerance) => {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a]; const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1; let at = -1;
    for (let k = a + 1; k < b; k += 1) {
      const [px, py] = points[k];
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, k) => keep[k]);
};
const chaikin = (points, closed) => {
  const out = closed ? [] : [points[0]];
  const n = points.length;
  const last = closed ? n - 1 : n - 1;
  for (let k = 0; k < last; k += 1) {
    const [ax, ay] = points[k]; const [bx, by] = points[k + 1];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  if (closed) out.push(out[0]); else out.push(points[n - 1]);
  return out;
};
// Rugosité : une fois lissé, l'arc est redécoupé (tous les « spacing » de
// case) et chaque point est poussé de côté selon un bruit lié à sa position
// (donc le même pour les deux provinces), nul aux extrémités.
const hash = (x, y) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
};
const smoothNoise = (x, y) => {
  const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0); const b = hash(x0 + 1, y0); const c = hash(x0, y0 + 1); const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const roughen = (points, closed, { amplitude, wavelength, spacing }) => {
  const dense = [points[0]];
  for (let k = 0; k < points.length - 1; k += 1) {
    const [ax, ay] = points[k]; const [bx, by] = points[k + 1];
    const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
    for (let t = 1; t <= pieces; t += 1) dense.push([ax + ((bx - ax) * t) / pieces, ay + ((by - ay) * t) / pieces]);
  }
  const n = dense.length;
  let run = 0;
  return dense.map(([x, y], k) => {
    if (!closed && (k === 0 || k === n - 1)) return [x, y];
    if (closed && k === n - 1) return null;
    const [px, py] = dense[Math.max(0, k - 1)]; const [qx, qy] = dense[Math.min(n - 1, k + 1)];
    const len = Math.hypot(qx - px, qy - py) || 1;
    // Atténuation près des extrémités (les nœuds ne bougent pas).
    run = closed ? 1 : Math.min(1, Math.min(k, n - 1 - k) * spacing);
    const off = amplitude * run * (smoothNoise(x / wavelength, y / wavelength) * 0.7 + smoothNoise(x / (wavelength / 2.3) + 17, y / (wavelength / 2.3) + 5) * 0.3);
    return [x + (-(qy - py) / len) * off, y + ((qx - px) / len) * off];
  }).filter(Boolean).concat(closed ? [null] : []).map((point, k, all) => point ?? all[0]);
};

export const smoothArc = (arc, { tolerance = 0.6, passes = 2, rough = { amplitude: 0.45, wavelength: 1.6, spacing: 0.35 } } = {}) => {
  let points = arc.points;
  // Un arc court (petite province) : simplification à sa mesure, pour qu'il ne
  // s'effondre pas.
  tolerance = Math.min(tolerance, (points.length - 1) / 8);
  if (arc.closed) {
    // Une boucle : on la coupe en deux pour simplifier sans perdre sa forme.
    const half = Math.floor(points.length / 2);
    points = [...simplify(points.slice(0, half + 1), tolerance), ...simplify(points.slice(half), tolerance).slice(1)];
  } else points = simplify(points, tolerance);
  for (let k = 0; k < passes; k += 1) points = chaikin(points, arc.closed);
  if (rough) points = roughen(points, arc.closed, rough);
  return points;
};

export const toLngLat = ([x, y]) => [
  Math.round((-180 + x * STEP) * 1e5) / 1e5,
  Math.round((LAT_TOP - y * STEP) * 1e5) / 1e5,
];

// ---------------------------------------------------------------------------
// Anneaux d'une province, depuis ses arcs (déjà lissés, en degrés) : la
// province est à gauche de chaque arc orienté (le nord reste en haut : la
// gauche de la trame est celle de la carte). Les extérieurs tournent donc en
// sens antihoraire et les trous en sens horaire : déjà la règle du GeoJSON (RFC 7946).
// ---------------------------------------------------------------------------
const key = ([x, y]) => `${x},${y}`;
const signedArea = (ring) => {
  let s = 0;
  for (let k = 0; k < ring.length - 1; k += 1) s += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
  return s / 2;
};
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// pieces : [{ points (lng/lat), closed }] déjà orientés (province à gauche en trame).
export const assemble = (pieces) => {
  const rings = [];
  const open = [];
  for (const piece of pieces) (piece.closed ? rings.push(piece.points) : open.push(piece.points));
  const byStart = new Map();
  for (const points of open) {
    const k = key(points[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(points);
  }
  const used = new Set();
  let broken = 0;
  for (const first of open) {
    if (used.has(first)) continue;
    used.add(first);
    const ring = [...first];
    const start = key(first[0]);
    let guard = 0;
    while (key(ring[ring.length - 1]) !== start && guard < 100000) {
      guard += 1;
      const next = (byStart.get(key(ring[ring.length - 1])) ?? []).find((points) => !used.has(points));
      if (!next) { broken += 1; break; }
      used.add(next);
      ring.push(...next.slice(1));
    }
    if (key(ring[ring.length - 1]) === start && ring.length >= 4) rings.push(ring);
  }
  // Extérieurs (antihoraires) et trous (horaires).
  const outers = []; const holes = [];
  for (const ring of rings) (signedArea(ring) > 0 ? outers : holes).push(ring);
  const polygons = outers.map((ring) => [ring]);
  for (const hole of holes) {
    const owner = polygons.find(([outer]) => inRing(hole[0], outer));
    if (owner) owner.push(hole);
  }
  return { polygons, broken };
};
