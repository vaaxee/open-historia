#!/usr/bin/env node
// Recale un scénario dont les régions ne sont pas aux vraies coordonnées.
//
//   node --max-old-space-size=4096 scripts/hoi-georeference.mjs <scenarioId> [--apply]
//
// Sans --apply : calcule la correspondance et affiche les écarts, sans rien écrire.
// Avec --apply : copie de sauvegarde des contours, puis réécriture recalée.
//
// Le cas qui l'a motivé : le scénario WW2+ (hoi4-states-copy-copy-2), importé de
// la carte de HOI4 en étalant ses pixels linéairement entre 65° S et 65° N. À
// l'écran tout était cohérent, mais Paris tombait en mer et Berlin en Suède :
// tout ce qui vient de vraies coordonnées (bassins industriels, villes,
// altitude) était au mauvais endroit.
//
// Méthode : on apparie des pays dont le territoire de l'époque est proche de
// l'actuel (liste PAIRS), on mesure chacun sur la carte du scénario et sur la
// carte de base (server/data/stock/regions.geojson, frontières actuelles), puis :
//   longitude réelle = a × longitude + b             (moindres carrés)
//   latitude réelle  = polynôme de degré 3 de la latitude (moindres carrés),
//     sur trois points par pays : centre, bord nord et bord sud de sa partie
//     principale (la plus grande), pour couvrir toutes les latitudes.

import fs from "fs";
import path from "path";
import turfArea from "@turf/area";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const scenarioId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!scenarioId) {
  console.error("usage: node scripts/hoi-georeference.mjs <scenarioId> [--apply]");
  process.exit(1);
}
const scenarioDir = path.join(root, "server", "data", "scenarios", scenarioId);
const regionsPath = path.join(scenarioDir, "regions.geojson");
const coarsePath = path.join(scenarioDir, "regions.coarse.geojson");
const stockPath = path.join(root, "server", "data", "stock", "regions.geojson");

// Pays de l'époque (nom dans le scénario) → pays actuels qui couvrent le même territoire.
const PAIRS = {
  // Pas l'Espagne, le Portugal ni le Danemark : leurs colonies et le Groenland
  // font partie du même pays dans le scénario.
  Sweden: ["Sweden"], Norway: ["Norway"], Finland: ["Finland"],
  Switzerland: ["Switzerland"], Greece: ["Greece"], Bulgaria: ["Bulgaria"], Hungary: ["Hungary"],
  Albania: ["Albania"], Turkey: ["Turkey"], Iran: ["Iran"], Iraq: ["Iraq"], Afghanistan: ["Afghanistan"],
  Mongolia: ["Mongolia"], "Saudi Arabia": ["Saudi Arabia"], Yemen: ["Yemen"], Oman: ["Oman"],
  Ethiopia: ["Ethiopia"], Liberia: ["Liberia"], Siam: ["Thailand"], Nepal: ["Nepal"], Bhutan: ["Bhutan"],
  Estonia: ["Estonia"], Latvia: ["Latvia"], Lithuania: ["Lithuania"], Ireland: ["Ireland"],
  Austria: ["Austria"], Czechoslovakia: ["Czechia", "Slovakia"],
  Yugoslavia: ["Slovenia", "Croatia", "Bosnia and Herzegovina", "Serbia", "Montenegro", "North Macedonia", "Kosovo"],
  Argentina: ["Argentina"], Chile: ["Chile"], Bolivia: ["Bolivia"], Paraguay: ["Paraguay"], Uruguay: ["Uruguay"],
  Peru: ["Peru"], Colombia: ["Colombia"], Venezuela: ["Venezuela"], Ecuador: ["Ecuador"], Brazil: ["Brazil"],
  Mexico: ["Mexico"], Guatemala: ["Guatemala"], Honduras: ["Honduras"], Nicaragua: ["Nicaragua"],
  "Costa Rica": ["Costa Rica"], Panama: ["Panama"], Cuba: ["Cuba"], Haiti: ["Haiti"],
  "Dominican Republic": ["Dominican Republic"], "United States": ["United States"],
  "Dominion of Canada": ["Canada"], "New Zealand": ["New Zealand"], Philippines: ["Philippines"],
  // Le Japon de 1936 avec son empire d'alors : la Corée et Taïwan.
  "Imperialist Japan": ["Japan", "South Korea", "North Korea", "Taiwan"],
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const polygonsOf = (g) => (g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : []);
const area = (coordinates) => turfArea({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } });

// Mesure d'un pays, sans fusionner ses régions (les contours de la carte de base
// ne s'y prêtent pas) : son centre est la moyenne des centres de ses régions,
// pondérée par leur surface ; ses bords nord, sud, est et ouest sont pris sur les
// régions d'au moins 2 % de sa surface (pas les petites îles). Cinq points, dans
// cet ordre, pour apparier point à point.
const polygonCentroid = (ring) => {
  let twiceArea = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i]; const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  if (!twiceArea) return ring[0];
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
};
const measure = (polygons) => {
  const parts = polygons.map((polygon) => ({ ring: polygon[0], area: area(polygon), center: polygonCentroid(polygon[0]) }))
    .filter((part) => part.area > 0);
  const total = parts.reduce((sum, part) => sum + part.area, 0);
  if (!total) return null;
  const cx = parts.reduce((sum, part) => sum + part.center[0] * part.area, 0) / total;
  const cy = parts.reduce((sum, part) => sum + part.center[1] * part.area, 0) / total;
  const points = parts.filter((part) => part.area >= total * 0.02).flatMap((part) => part.ring);
  const pick = (better) => points.reduce((best, point) => (better(point, best) ? point : best), points[0]);
  return [
    [cx, cy],
    pick((a, b) => a[1] > b[1]),
    pick((a, b) => a[1] < b[1]),
    pick((a, b) => a[0] > b[0]),
    pick((a, b) => a[0] < b[0]),
  ];
};

// Moindres carrés : (x, y) → z par un polynôme de degré `degree` en x et y
// (tous les termes x^i·y^j avec i + j ≤ degree). Coordonnées ramenées à [-1, 1].
const fitPolynomial = (points, zs, degree) => {
  const terms = [];
  for (let i = 0; i <= degree; i += 1) for (let j = 0; i + j <= degree; j += 1) terms.push([i, j]);
  const basis = ([x, y]) => terms.map(([i, j]) => (x / 180) ** i * (y / 90) ** j);
  const n = terms.length;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  points.forEach((point, k) => {
    const row = basis(point);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) A[i][j] += row[i] * row[j];
      A[i][n] += zs[k] * row[i];
    }
  });
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    [A[c], A[pivot]] = [A[pivot], A[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k += 1) A[r][k] -= f * A[c][k];
    }
  }
  const coefficients = A.map((row, i) => row[n] / row[i]);
  return (point) => basis(point).reduce((sum, value, i) => sum + coefficients[i] * value, 0);
};

console.log("Lecture des contours…");
const scenario = readJson(regionsPath);
const scenarioWorld = readJson(path.join(scenarioDir, "world.json"));
const overrides = scenarioWorld.regionOwnershipOverrides ?? {};
const stock = readJson(stockPath);

const group = (features, ownerOf) => {
  const out = new Map();
  for (const feature of features) {
    const owner = ownerOf(feature);
    if (!owner) continue;
    if (!out.has(owner)) out.set(owner, []);
    out.get(owner).push(...polygonsOf(feature.geometry));
  }
  return out;
};
const mapPolygons = group(scenario.features.filter((f) => !f.properties?.typeId || f.properties.typeId === "land"),
  (f) => overrides[f.properties?.id] ?? f.properties?.owner);
const realPolygons = group(stock.features, (f) => f.properties?.owner);

const pairs = [];
for (const [then, now] of Object.entries(PAIRS)) {
  const onMap = mapPolygons.get(then);
  const real = now.flatMap((name) => realPolygons.get(name) ?? []);
  if (!onMap?.length || !real.length) {
    console.log(`  (ignoré : ${then}${onMap?.length ? "" : " absent du scénario"}${real.length ? "" : " absent de la référence"})`);
    continue;
  }
  pairs.push({ name: then, map: measure(onMap), real: measure(real) });
}
console.log(`${pairs.length} pays appariés.`);

const mapPoints = pairs.flatMap((p) => p.map);
const realPoints = pairs.flatMap((p) => p.real);
const DEGREE = Number(process.env.HOI_GEOREF_DEGREE || 3);
const lngFit = fitPolynomial(mapPoints, realPoints.map(([x]) => x), DEGREE);
const latFit = fitPolynomial(mapPoints, realPoints.map(([, y]) => y), DEGREE);

// Correction locale : l'écart restant au centre de chaque pays apparié, reporté
// sur son voisinage avec un poids gaussien (σ = 8°), qui s'efface loin des pays
// de référence (poids de fond 0,3 : là où il n'y en a pas, le polynôme seul).
const SIGMA = 8;
const residuals = pairs.map((p) => {
  const x = lngFit(p.map[0]); const y = latFit(p.map[0]);
  return { at: p.map[0], dx: p.real[0][0] - x, dy: p.real[0][1] - y };
});
const correction = ([x, y]) => {
  let wx = 0; let wy = 0; let weights = 0.3;
  for (const r of residuals) {
    const d2 = ((x - r.at[0]) * Math.cos((y * Math.PI) / 180)) ** 2 + (y - r.at[1]) ** 2;
    const w = Math.exp(-d2 / (2 * SIGMA * SIGMA));
    wx += w * r.dx; wy += w * r.dy; weights += w;
  }
  return [wx / weights, wy / weights];
};

const transform = (point) => {
  const [cx, cy] = correction(point);
  return [
    Math.round(Math.max(-180, Math.min(180, lngFit(point) + cx)) * 1e5) / 1e5,
    Math.round(Math.max(-85, Math.min(85, latFit(point) + cy)) * 1e5) / 1e5,
  ];
};

// Écarts restants, pays par pays (centre), en degrés.
let sum = 0;
for (const p of pairs) {
  const [x, y] = transform(p.map[0]);
  const error = Math.hypot(x - p.real[0][0], y - p.real[0][1]);
  sum += error ** 2;
  if (error > 2) console.log(`  écart ${error.toFixed(1)}° pour ${p.name} (réel ${p.real[0].map((v) => v.toFixed(1)).join(", ")} → ${x.toFixed(1)}, ${y.toFixed(1)})`);
}
console.log(`Degré ${DEGREE} — écart moyen (RMS) des centres : ${Math.sqrt(sum / pairs.length).toFixed(2)}°`);

// Vérification sur des capitales de pays qui ne servent PAS au calcul : chacune
// doit tomber, après recalage, dans une région de son pays.
const CAPITALS = [
  ["Paris", [2.35, 48.86], "France"], ["Berlin", [13.4, 52.52], "Germany"], ["Madrid", [-3.7, 40.42], "Spain"],
  ["Varsovie", [21.01, 52.23], "Poland"], ["Rome", [12.5, 41.9], "Italy"], ["Londres", [-0.13, 51.51], "United Kingdom"],
  ["Moscou", [37.62, 55.76], "Soviet Union"],
  // En 1936, l'Égypte est sous contrôle britannique dans ce scénario (pas de pays « Egypt »).
  ["Le Caire", [31.24, 30.04], "United Kingdom"],
];
const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const landFeatures = scenario.features.filter((f) => !f.properties?.typeId || f.properties.typeId === "land");
let failures = 0;
for (const [name, point, country] of CAPITALS) {
  const hit = landFeatures.find((f) => polygonsOf(f.geometry).some((polygon) => {
    const outer = polygon[0].map(transform);
    return pointInRing(point, outer) && !polygon.slice(1).some((hole) => pointInRing(point, hole.map(transform)));
  }));
  const owner = hit ? (overrides[hit.properties.id] ?? hit.properties.owner) : "(mer)";
  const ok = owner === country;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK " : "NON"} ${name} → ${owner}${ok ? "" : ` (attendu : ${country})`}`);
}
console.log(`Capitales hors de leur pays : ${failures}`);

if (!apply) {
  console.log("Rien n'est écrit sans --apply.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const rewrite = (file) => {
  if (!fs.existsSync(file)) return;
  const backup = `${file}.avant-recalage-${stamp}`;
  fs.copyFileSync(file, backup);
  const data = readJson(file);
  for (const feature of data.features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "Polygon") g.coordinates = g.coordinates.map((ring) => ring.map(transform));
    else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((poly) => poly.map((ring) => ring.map(transform)));
  }
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`Recalé : ${path.basename(file)} (sauvegarde : ${path.basename(backup)})`);
};
rewrite(regionsPath);
rewrite(coarsePath);
// Le tampon du fichier simplifié le fait régénérer depuis les contours recalés.
const coarseStamp = `${coarsePath}.stamp`;
if (fs.existsSync(coarseStamp)) {
  fs.copyFileSync(coarseStamp, `${coarseStamp}.avant-recalage-${stamp}`);
  fs.rmSync(coarseStamp);
}
