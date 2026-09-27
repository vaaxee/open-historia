// Retouches de la trame des provinces, après la croissance :
// - une petite île n'est jamais coupée (sauf par une frontière d'aujourd'hui) ;
// - les provinces faites de poussières d'îles sont regroupées par archipel ;
// - une province trop étroite (lanière le long d'un fleuve ou d'une côte) est
//   fondue dans sa voisine, sauf si une ligne guide ou un très grand fleuve
//   les sépare ;
// - les numéros sont refaits, dans l'ordre d'une courbe de Hilbert (des
//   provinces voisines ont des numéros proches).

import { H, N, W, cellKm2, latOf } from "./grid.mjs";

export const REFINE_TUNING = {
  smallIslandKm2: 3000, // une île plus petite n'est jamais coupée
  dustIslandKm2: 1500, // province d'îles « poussière » : regroupable
  archipelagoTargetKm2: 1200, // on regroupe tant qu'une province d'îles est plus petite
  archipelagoMaxKm2: 2600, // … sans dépasser
  archipelagoReachKm: 130, // entre centres
  archipelagoSpanKm: 260, // étendue maximale d'un groupe
  stripDepth: 2, // une province dont aucun point n'est à plus de 2 cases du bord est une lanière
  elongatedDepth: 4, // … ou à plus de 4 cases, si elle est très allongée :
  elongation: 14, // cases ≥ 14 × profondeur² (une bande sept fois plus longue que large)
  stripPasses: 6,
};
const R = REFINE_TUNING;

const n4 = (c) => {
  const i = c % W;
  return [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c + W < N ? c + W : -1];
};
const kmBetween = ([x0, y0], [x1, y1]) => {
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  return Math.hypot((x1 - x0) * k, y1 - y0) * 111.32;
};

// Composantes 8-connexes de terre : { comp: Int32Array, sizes (km²) }.
export const landComponents = (land) => {
  const comp = new Int32Array(N);
  const km2 = [0];
  const stack = new Int32Array(N);
  let count = 0;
  for (let start = 0; start < N; start += 1) {
    if (!land[start] || comp[start]) continue;
    count += 1; km2.push(0);
    let top = 0; stack[top++] = start; comp[start] = count;
    while (top) {
      const c = stack[--top]; const i = c % W; const j = (c - i) / W;
      km2[count] += cellKm2(j);
      for (let dj = -1; dj <= 1; dj += 1) {
        const y = j + dj; if (y < 0 || y >= H) continue;
        for (let di = -1; di <= 1; di += 1) {
          const x = i + di; if (x < 0 || x >= W) continue;
          const n = y * W + x;
          if (land[n] && !comp[n]) { comp[n] = count; stack[top++] = n; }
        }
      }
    }
  }
  return { comp, km2 };
};

// Une petite île, partagée entre plusieurs provinces, n'en garde qu'une.
export const unifySmallIslands = ({ land, labels, today, islands }) => {
  const byComp = new Map();
  for (let c = 0; c < N; c += 1) {
    if (!land[c]) continue;
    const k = islands.comp[c];
    if (islands.km2[k] > R.smallIslandKm2) continue;
    if (!byComp.has(k)) byComp.set(k, new Map());
    const counts = byComp.get(k);
    counts.set(labels[c], (counts.get(labels[c]) ?? 0) + 1);
  }
  const keep = new Map();
  for (const [k, counts] of byComp) {
    if (counts.size < 2) continue;
    keep.set(k, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
  }
  // Une frontière d'aujourd'hui qui coupe l'île (Saint-Martin, Usedom…) reste.
  const countries = new Map();
  for (let c = 0; c < N; c += 1) {
    const k = islands.comp[c];
    if (!land[c] || !keep.has(k)) continue;
    if (!countries.has(k)) countries.set(k, new Set());
    countries.get(k).add(today[c]);
  }
  let merged = 0;
  for (let c = 0; c < N; c += 1) {
    const k = islands.comp[c];
    if (!land[c] || !keep.has(k) || countries.get(k).size > 1) continue;
    if (labels[c] !== keep.get(k)) { labels[c] = keep.get(k); merged += 1; }
  }
  return merged;
};

// Statistiques par province : cases, km², centre, boîte.
const provinceStats = (land, labels) => {
  const stats = new Map();
  for (let c = 0; c < N; c += 1) {
    const l = labels[c];
    if (!land[c] || !l) continue;
    const i = c % W; const j = (c - i) / W;
    const lng = -180 + (i + 0.5) * 0.05; const lat = latOf(j);
    let s = stats.get(l);
    if (!s) { s = { cells: 0, km2: 0, sx: 0, sy: 0, minX: lng, maxX: lng, minY: lat, maxY: lat, first: c }; stats.set(l, s); }
    const a = cellKm2(j);
    s.cells += 1; s.km2 += a; s.sx += lng * a; s.sy += lat * a;
    s.minX = Math.min(s.minX, lng); s.maxX = Math.max(s.maxX, lng); s.minY = Math.min(s.minY, lat); s.maxY = Math.max(s.maxY, lat);
  }
  return stats;
};

// Les provinces faites seulement de petites îles se regroupent avec leur voisine
// la plus proche, si elle est de même histoire (mêmes pays aux quatre dates).
export const groupArchipelagos = ({ land, labels, combo, islands }) => {
  const stats = provinceStats(land, labels);
  const dust = new Map(); // province → { km2, center, box, combo }
  const onlyDust = new Map();
  for (let c = 0; c < N; c += 1) {
    const l = labels[c];
    if (!land[c] || !l) continue;
    const small = islands.km2[islands.comp[c]] <= R.dustIslandKm2;
    onlyDust.set(l, (onlyDust.get(l) ?? true) && small);
  }
  for (const [l, only] of onlyDust) {
    if (!only) continue;
    const s = stats.get(l);
    dust.set(l, {
      km2: s.km2, center: [s.sx / s.km2, s.sy / s.km2], box: [s.minX, s.minY, s.maxX, s.maxY], combo: combo[s.first], into: l,
    });
  }
  const root = (l) => { let r = l; while (dust.get(r).into !== r) r = dust.get(r).into; return r; };
  let merges = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    const order = [...dust.keys()].filter((l) => root(l) === l).sort((a, b) => dust.get(a).km2 - dust.get(b).km2);
    for (const l of order) {
      if (root(l) !== l) continue;
      const p = dust.get(l);
      if (p.km2 >= R.archipelagoTargetKm2) continue;
      let best = null; let bestKm = Infinity;
      for (const [m, q] of dust) {
        if (m === l || root(m) !== m || q.combo !== p.combo) continue;
        if (p.km2 + q.km2 > R.archipelagoMaxKm2) continue;
        const km = kmBetween(p.center, q.center);
        if (km > R.archipelagoReachKm || km >= bestKm) continue;
        const box = [Math.min(p.box[0], q.box[0]), Math.min(p.box[1], q.box[1]), Math.max(p.box[2], q.box[2]), Math.max(p.box[3], q.box[3])];
        if (kmBetween([box[0], box[1]], [box[2], box[3]]) > R.archipelagoSpanKm) continue;
        best = m; bestKm = km;
      }
      if (best === null) continue;
      const q = dust.get(best);
      q.center = [(q.center[0] * q.km2 + p.center[0] * p.km2) / (q.km2 + p.km2), (q.center[1] * q.km2 + p.center[1] * p.km2) / (q.km2 + p.km2)];
      q.km2 += p.km2;
      q.box = [Math.min(p.box[0], q.box[0]), Math.min(p.box[1], q.box[1]), Math.max(p.box[2], q.box[2]), Math.max(p.box[3], q.box[3])];
      p.into = best;
      merges += 1; changed = true;
    }
    if (!changed) break;
  }
  if (merges) for (let c = 0; c < N; c += 1) if (dust.has(labels[c])) labels[c] = root(labels[c]);
  return { dust: dust.size, merges };
};

// Lanières : une province sans point à plus de stripDepth cases de son bord
// rejoint la voisine avec qui elle partage le plus de limite franchissable.
export const mergeStrips = ({ land, labels, crossable, islands }) => {
  let total = 0;
  for (let pass = 0; pass < R.stripPasses; pass += 1) {
    const depth = new Uint8Array(N);
    let frontier = [];
    for (let c = 0; c < N; c += 1) {
      if (!land[c]) continue;
      if (n4(c).some((n) => n < 0 || !land[n] || labels[n] !== labels[c])) { depth[c] = 1; frontier.push(c); }
    }
    for (let d = 2; d <= R.elongatedDepth + 1 && frontier.length; d += 1) {
      const next = [];
      for (const c of frontier) {
        for (const n of n4(c)) {
          if (n < 0 || !land[n] || depth[n] || labels[n] !== labels[c]) continue;
          depth[n] = d; next.push(n);
        }
      }
      frontier = next;
    }
    const maxDepth = new Map(); const size = new Map();
    const isIsland = new Map();
    for (let c = 0; c < N; c += 1) {
      if (!land[c]) continue;
      const l = labels[c];
      const d = depth[c] === 0 ? 99 : depth[c];
      if (d > (maxDepth.get(l) ?? 0)) maxDepth.set(l, d);
      size.set(l, (size.get(l) ?? 0) + 1);
      // Une province d'île (hors continent) ne fond pas en mer : on la laisse.
      if (islands.km2[islands.comp[c]] <= R.smallIslandKm2) isIsland.set(l, true);
    }
    const deep = new Set();
    for (const [l, d] of maxDepth) {
      const narrow = d <= R.stripDepth || (d <= R.elongatedDepth && size.get(l) >= R.elongation * d * d);
      if (!narrow) deep.add(l);
    }
    const shared = new Map(); // province étroite → Map(voisine → arêtes)
    for (let c = 0; c < N; c += 1) {
      if (!land[c]) continue;
      const l = labels[c];
      if (deep.has(l) || isIsland.get(l)) continue;
      const i = c % W;
      for (const n of [i < W - 1 ? c + 1 : -1, c + W < N ? c + W : -1, i > 0 ? c - 1 : -1, c >= W ? c - W : -1]) {
        if (n < 0 || !land[n] || labels[n] === l || !crossable(c, n)) continue;
        if (!shared.has(l)) shared.set(l, new Map());
        const m = shared.get(l);
        m.set(labels[n], (m.get(labels[n]) ?? 0) + 1);
      }
    }
    const into = new Map();
    for (const [l, m] of shared) {
      const [target] = [...m].sort((a, b) => b[1] - a[1])[0];
      // Pas de fusion croisée (a dans b et b dans a) dans la même passe.
      if (into.get(target) === l) continue;
      into.set(l, target);
    }
    if (!into.size) break;
    const final = (l) => { let r = l; const seen = new Set(); while (into.has(r) && !seen.has(r)) { seen.add(r); r = into.get(r); } return r; };
    for (let c = 0; c < N; c += 1) if (land[c] && into.has(labels[c])) labels[c] = final(labels[c]);
    total += into.size;
  }
  return total;
};

// Numéros définitifs, 1…n, dans l'ordre de Hilbert de leur centre.
export const renumber = ({ land, labels }) => {
  const stats = provinceStats(land, labels);
  const hilbert = (x, y, order) => {
    let d = 0;
    for (let s = order / 2; s > 0; s /= 2) {
      const rx = (x & s) > 0 ? 1 : 0; const ry = (y & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
    }
    return d;
  };
  const order = [...stats].map(([l, s]) => {
    const x = Math.floor(((s.sx / s.km2 + 180) / 360) * 4096);
    const y = Math.floor(((90 - s.sy / s.km2) / 180) * 2048);
    return [l, hilbert(Math.min(4095, x), Math.min(4095, y), 4096)];
  }).sort((a, b) => a[1] - b[1]);
  const id = new Map(order.map(([l], k) => [l, k + 1]));
  for (let c = 0; c < N; c += 1) labels[c] = land[c] && labels[c] ? id.get(labels[c]) : 0;
  return order.length;
};
