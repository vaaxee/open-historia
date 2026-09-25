#!/usr/bin/env node
// Recale un scénario dont les régions ne sont pas aux vraies coordonnées.
//
//   node --max-old-space-size=4096 scripts/hoi-georeference.mjs <scenarioId> [--apply]
//
// Sans --apply : calcule la correspondance et affiche les écarts, sans rien écrire.
// Avec --apply : copie de sauvegarde des contours, puis réécriture recalée.
// Le calcul part TOUJOURS des contours d'origine (la plus ancienne sauvegarde
// « .avant-recalage-… » si elle existe) : relancer le script ne recale pas deux fois.
// Réglages : HOI_GEOREF_DEGREE (3), HOI_GEOREF_SIGMA (en degrés, 5),
// HOI_GEOREF_COAST_PASSES (12), HOI_GEOREF_COAST_SIGMA (1°), HOI_GEOREF_COAST_REACH (1,2°).
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
  // La métropole seule : le Congo est un pays à part dans le scénario.
  Belgium: ["Belgium"], Luxembourg: ["Luxembourg"],
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
const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
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

// Les contours d'origine : la plus ancienne sauvegarde, sinon le fichier.
const originalOf = (file) => {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.avant-recalage-`;
  const backups = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort() : [];
  return backups.length ? path.join(dir, backups[0]) : null;
};
const regionsSource = originalOf(regionsPath) ?? regionsPath;
console.log(`Lecture des contours… (${path.basename(regionsSource)})`);
const scenario = readJson(regionsSource);
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

// Correction locale : l'écart restant aux cinq points de chaque pays apparié,
// reporté sur son voisinage avec un poids gaussien (σ = 5°), qui s'efface loin
// des pays de référence (poids de fond 0,3 : là où il n'y en a pas, le
// polynôme seul).
const SIGMA = Number(process.env.HOI_GEOREF_SIGMA || 5);
const ANCHORS = process.env.HOI_GEOREF_ANCHORS || "center";
const residuals = pairs.flatMap((p) => (ANCHORS === "all" ? p.map : p.map.slice(0, 1)).map((at, i) => ({
  at, dx: p.real[i][0] - lngFit(at), dy: p.real[i][1] - latFit(at),
})));
const correction = ([x, y]) => {
  let wx = 0; let wy = 0; let weights = 0.3;
  for (const r of residuals) {
    const d2 = ((x - r.at[0]) * Math.cos((y * Math.PI) / 180)) ** 2 + (y - r.at[1]) ** 2;
    const w = Math.exp(-d2 / (2 * SIGMA * SIGMA));
    wx += w * r.dx; wy += w * r.dy; weights += w;
  }
  return [wx / weights, wy / weights];
};

const baseTransform = (point) => {
  const [cx, cy] = correction(point);
  return [lngFit(point) + cx, latFit(point) + cy];
};

// ---------------------------------------------------------------------------
// Affinage par les côtes et les frontières. Les pays appariés ne donnent
// qu'une cinquantaine de repères : à 0,5° près, une ville côtière tombe encore
// en mer, et l'intérieur des continents peut glisser de 2 ou 3°. On relève
// donc, sur les deux cartes, les points de côte et les points des frontières
// restées les mêmes depuis 1936 (BORDER_PAIRS) ; plusieurs fois de suite, on
// tire chaque point du scénario vers le point réel le plus proche de même
// nature (côte vers côte, frontière France–Suisse vers frontière France–Suisse),
// à moins de COAST_REACH°, puis on lisse ces écarts en un champ de correction
// (gaussien, σ = COAST_SIGMA°).
// ---------------------------------------------------------------------------
// Pays de l'époque → nom actuel, pour les frontières seulement (un pays avec
// ses colonies convient : seule la ligne de frontière compte).
const BORDER_NAMES = {
  "United States": "United States", "Dominion of Canada": "Canada", Mexico: "Mexico", France: "France",
  Switzerland: "Switzerland", Belgium: "Belgium", Spain: "Spain", Portugal: "Portugal", Italy: "Italy", Germany: "Germany",
  Luxembourg: "Luxembourg", Netherlands: "Netherlands", Denmark: "Denmark", Austria: "Austria", Czechoslovakia: "Czechia",
  Hungary: "Hungary", Sweden: "Sweden", Norway: "Norway", Finland: "Finland", Argentina: "Argentina", Chile: "Chile",
  Brazil: "Brazil", Uruguay: "Uruguay", Bolivia: "Bolivia", Peru: "Peru", Colombia: "Colombia", Venezuela: "Venezuela",
  Iran: "Iran", Iraq: "Iraq", Turkey: "Turkey", Afghanistan: "Afghanistan", Greece: "Greece", Bulgaria: "Bulgaria",
  Albania: "Albania", Romania: "Romania", Guatemala: "Guatemala", Honduras: "Honduras", Nicaragua: "Nicaragua",
  "Costa Rica": "Costa Rica", Panama: "Panama", Haiti: "Haiti", "Dominican Republic": "Dominican Republic",
  Estonia: "Estonia", Latvia: "Latvia", Lithuania: "Lithuania", Ireland: "Ireland", "United Kingdom": "United Kingdom",
  Ecuador: "Ecuador", "El Salvador": "El Salvador",
};
// Les frontières à peu près inchangées depuis 1936.
const BORDER_PAIRS = [
  ["United States", "Dominion of Canada"], ["United States", "Mexico"], ["Mexico", "Guatemala"],
  ["Guatemala", "Honduras"], ["Guatemala", "El Salvador"], ["Honduras", "El Salvador"], ["Honduras", "Nicaragua"],
  ["Nicaragua", "Costa Rica"], ["Costa Rica", "Panama"], ["Haiti", "Dominican Republic"],
  ["France", "Switzerland"], ["France", "Belgium"], ["France", "Spain"], ["France", "Italy"], ["France", "Germany"],
  ["France", "Luxembourg"], ["Spain", "Portugal"], ["Germany", "Switzerland"], ["Germany", "Austria"],
  ["Germany", "Netherlands"], ["Germany", "Belgium"], ["Germany", "Luxembourg"], ["Germany", "Denmark"],
  ["Germany", "Czechoslovakia"], ["Italy", "Switzerland"], ["Italy", "Austria"], ["Austria", "Switzerland"],
  ["Austria", "Czechoslovakia"], ["Austria", "Hungary"], ["Belgium", "Netherlands"], ["Belgium", "Luxembourg"],
  ["Hungary", "Romania"], ["Romania", "Bulgaria"], ["Greece", "Bulgaria"], ["Greece", "Albania"], ["Turkey", "Greece"],
  ["Turkey", "Bulgaria"], ["Turkey", "Iran"], ["Iran", "Iraq"], ["Iran", "Afghanistan"], ["Sweden", "Norway"],
  ["Sweden", "Finland"], ["Estonia", "Latvia"], ["Latvia", "Lithuania"], ["Ireland", "United Kingdom"],
  ["Argentina", "Chile"], ["Argentina", "Brazil"], ["Argentina", "Uruguay"], ["Brazil", "Uruguay"], ["Argentina", "Bolivia"],
  ["Brazil", "Bolivia"], ["Brazil", "Venezuela"], ["Brazil", "Colombia"], ["Brazil", "Peru"], ["Colombia", "Venezuela"],
  ["Chile", "Bolivia"], ["Chile", "Peru"], ["Colombia", "Panama"],
];
const borderLabel = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const BORDER_LABELS = new Set(BORDER_PAIRS.map(([a, b]) => borderLabel(a, b)));
const MODERN_TO_THEN = Object.fromEntries(Object.entries(BORDER_NAMES).map(([then, now]) => [now, then]));
const COAST_PASSES = Number(process.env.HOI_GEOREF_COAST_PASSES ?? 12);
const COAST_SIGMA = Number(process.env.HOI_GEOREF_COAST_SIGMA || 1);
const COAST_REACH = Number(process.env.HOI_GEOREF_COAST_REACH || 1.2);
// Une frontière ne se confond avec rien d'autre : on la cherche plus loin.
const BORDER_REACH = Number(process.env.HOI_GEOREF_BORDER_REACH || 4);
const FIELD_STEP = 0.25;
const FIELD_DAMPING = 0.5; // là où il y a peu de côte, l'écart est atténué

const sampleEdge = (a, b, step, out) => {
  const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  for (let t = 0; t < pieces; t += 1) {
    const u = (t + 0.5) / pieces;
    out(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, b[0] - a[0], b[1] - a[1]);
  }
};
const cellOf = (x, y, step) => `${Math.floor(x / step)}:${Math.floor(y / step)}`;

// Le scénario : ses régions partagent exactement leurs sommets (carte en
// pixels) ; un segment d'une seule région terrestre est une côte, un segment
// entre deux pays d'une frontière suivie en est un point.
const scenarioMarks = (features, ownerOf, step) => {
  const edges = new Map();
  const key = ([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`;
  for (const feature of features) {
    const owner = ownerOf(feature);
    for (const polygon of polygonsOf(feature.geometry)) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i += 1) {
          const ka = key(ring[i]); const kb = key(ring[i + 1]);
          if (ka === kb) continue;
          const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          const entry = edges.get(k);
          if (entry) entry.owners.push(owner);
          else edges.set(k, { a: ring[i], b: ring[i + 1], owners: [owner] });
        }
      }
    }
  }
  const cells = new Map();
  for (const { a, b, owners } of edges.values()) {
    let label = null;
    if (owners.length === 1) label = "coast";
    else if (owners.length === 2 && owners[0] !== owners[1]) {
      const l = borderLabel(owners[0], owners[1]);
      if (BORDER_LABELS.has(l)) label = l;
    }
    if (!label) continue;
    sampleEdge(a, b, step, (x, y) => {
      const cell = `${label}@${cellOf(x, y, step)}`;
      if (!cells.has(cell)) cells.set(cell, { point: [x, y], label });
    });
  }
  return [...cells.values()];
};

// La carte réelle : ses régions ne partagent pas toujours leurs sommets. On
// regarde donc de part et d'autre de chaque segment (à 0,03°) : rien d'un côté,
// c'est une côte ; deux pays différents, une frontière.
const realMarks = (features, step) => {
  const GRID = 2;
  const grid = new Map();
  const rows = features.map((feature) => {
    const polygons = polygonsOf(feature.geometry);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const polygon of polygons) for (const [x, y] of polygon[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { owner: feature.properties?.owner, polygons, bbox: [minX, minY, maxX, maxY] };
  });
  rows.forEach((row) => {
    const [minX, minY, maxX, maxY] = row.bbox;
    for (let i = Math.floor(minX / GRID); i <= Math.floor(maxX / GRID); i += 1) {
      for (let j = Math.floor(minY / GRID); j <= Math.floor(maxY / GRID); j += 1) {
        const k = `${i}:${j}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(row);
      }
    }
  });
  const ownerAt = (x, y) => {
    for (const row of grid.get(cellOf(x, y, GRID)) ?? []) {
      const [minX, minY, maxX, maxY] = row.bbox;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (row.polygons.some((polygon) => pointInRing([x, y], polygon[0]) && !polygon.slice(1).some((hole) => pointInRing([x, y], hole)))) return row.owner ?? "";
    }
    return null;
  };
  const seen = new Set();
  const out = [];
  const OFFSET = 0.03;
  for (const row of rows) {
    for (const polygon of row.polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i += 1) {
          sampleEdge(ring[i], ring[i + 1], step, (x, y, dx, dy) => {
            const cell = cellOf(x, y, step);
            if (seen.has(cell)) return;
            seen.add(cell);
            const len = Math.hypot(dx, dy) || 1;
            const nx = (-dy / len) * OFFSET; const ny = (dx / len) * OFFSET;
            const left = ownerAt(x + nx, y + ny); const right = ownerAt(x - nx, y - ny);
            if (left === null || right === null) {
              if (left !== right) out.push({ point: [x, y], label: "coast" });
              return;
            }
            if (left === right) return;
            const a = MODERN_TO_THEN[left]; const b = MODERN_TO_THEN[right];
            if (!a || !b) return;
            const l = borderLabel(a, b);
            if (BORDER_LABELS.has(l)) out.push({ point: [x, y], label: l });
          });
        }
      }
    }
  }
  return out;
};

const fields = [];
const fieldAt = (field, [x, y]) => {
  const gx = (x + 180) / FIELD_STEP; const gy = (y + 90) / FIELD_STEP;
  const x0 = Math.max(0, Math.min(field.w - 2, Math.floor(gx))); const y0 = Math.max(0, Math.min(field.h - 2, Math.floor(gy)));
  const fx = Math.max(0, Math.min(1, gx - x0)); const fy = Math.max(0, Math.min(1, gy - y0));
  const at = (i, j) => (j * field.w + i) * 2;
  let dx = 0; let dy = 0;
  for (const [i, j, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
    dx += w * field.d[at(i, j)]; dy += w * field.d[at(i, j) + 1];
  }
  return [dx, dy];
};
const refined = (point) => {
  let [x, y] = baseTransform(point);
  for (const field of fields) {
    const [dx, dy] = fieldAt(field, [x, y]);
    x += dx; y += dy;
  }
  return [x, y];
};

if (COAST_PASSES > 0) {
  const landOnly = (features) => features.filter((f) => !f.properties?.typeId || f.properties.typeId === "land");
  const mapCoast = scenarioMarks(landOnly(scenario.features), (f) => overrides[f.properties?.id] ?? f.properties?.owner, 0.2);
  const realCoast = realMarks(stock.features, 0.1);
  const GRID = 0.5;
  const realGrid = new Map();
  for (const { point, label } of realCoast) {
    const k = `${label}@${Math.floor(point[0] / GRID)}:${Math.floor(point[1] / GRID)}`;
    if (!realGrid.has(k)) realGrid.set(k, []);
    realGrid.get(k).push(point);
  }
  const nearest = ([x, y], label) => {
    const k = Math.cos((y * Math.PI) / 180) ** 2;
    const reach = label === "coast" ? COAST_REACH : BORDER_REACH;
    const span = Math.ceil(reach / GRID);
    let best = null; let bestD = reach * reach;
    const cx = Math.floor(x / GRID); const cy = Math.floor(y / GRID);
    for (let i = -span; i <= span; i += 1) {
      for (let j = -span; j <= span; j += 1) {
        for (const p of realGrid.get(`${label}@${cx + i}:${cy + j}`) ?? []) {
          const d = (p[0] - x) ** 2 * k + (p[1] - y) ** 2;
          if (d < bestD) { bestD = d; best = p; }
        }
      }
    }
    return best;
  };
  const count = (marks) => {
    const coast = marks.filter((mark) => mark.label === "coast").length;
    return `${coast} de côte, ${marks.length - coast} de frontière`;
  };
  console.log(`Repères : carte ${count(mapCoast)} ; réel ${count(realCoast)}.`);
  const w = Math.round(360 / FIELD_STEP) + 1; const h = Math.round(180 / FIELD_STEP) + 1;
  const radius = Math.ceil((3 * COAST_SIGMA) / FIELD_STEP);
  for (let pass = 0; pass < COAST_PASSES; pass += 1) {
    const sum = new Float64Array(w * h * 2); const weight = new Float64Array(w * h);
    let matched = 0; let total = 0;
    for (const { point: original, label } of mapCoast) {
      const at = refined(original);
      const target = nearest(at, label);
      if (!target) continue;
      const dx = target[0] - at[0]; const dy = target[1] - at[1];
      matched += 1; total += Math.hypot(dx, dy);
      const gx = Math.round((at[0] + 180) / FIELD_STEP); const gy = Math.round((at[1] + 90) / FIELD_STEP);
      const k = Math.cos((at[1] * Math.PI) / 180);
      for (let i = Math.max(0, gx - radius); i <= Math.min(w - 1, gx + radius); i += 1) {
        for (let j = Math.max(0, gy - radius); j <= Math.min(h - 1, gy + radius); j += 1) {
          const nx = i * FIELD_STEP - 180; const ny = j * FIELD_STEP - 90;
          const d2 = ((nx - at[0]) * k) ** 2 + (ny - at[1]) ** 2;
          const g = Math.exp(-d2 / (2 * COAST_SIGMA * COAST_SIGMA));
          if (g < 1e-3) continue;
          const c = j * w + i;
          sum[c * 2] += g * dx; sum[c * 2 + 1] += g * dy; weight[c] += g;
        }
      }
    }
    const d = new Float32Array(w * h * 2);
    for (let c = 0; c < w * h; c += 1) {
      d[c * 2] = sum[c * 2] / (weight[c] + FIELD_DAMPING);
      d[c * 2 + 1] = sum[c * 2 + 1] / (weight[c] + FIELD_DAMPING);
    }
    fields.push({ w, h, d });
    console.log(`  passe ${pass + 1} : ${matched} points appariés, écart moyen ${(total / Math.max(1, matched)).toFixed(3)}°`);
  }
}

const transform = (point) => {
  const [x, y] = refined(point);
  return [
    Math.round(Math.max(-180, Math.min(180, x)) * 1e5) / 1e5,
    Math.round(Math.max(-85, Math.min(85, y)) * 1e5) / 1e5,
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
  // Autour de la Suisse et du Benelux, où la carte a le moins de repères.
  ["Lille", [3.06, 50.63], "France"], ["Strasbourg", [7.75, 48.58], "France"], ["Lyon", [4.84, 45.76], "France"],
  ["Berne", [7.45, 46.95], "Switzerland"], ["Genève", [6.14, 46.2], "Switzerland"], ["Zurich", [8.54, 47.37], "Switzerland"],
  ["Bruxelles", [4.35, 50.85], "Belgium"], ["Amsterdam", [4.9, 52.37], "Netherlands"], ["Munich", [11.58, 48.14], "Germany"],
  ["Milan", [9.19, 45.46], "Italy"], ["Vienne", [16.37, 48.21], "Austria"], ["Prague", [14.42, 50.08], "Czechoslovakia"],
  ["Bucarest", [26.1, 44.43], "Romania"], ["Istanbul", [28.98, 41.01], "Turkey"], ["Léningrad", [30.3, 59.94], "Soviet Union"],
  // Les autres continents : là où les bâtiments de départ doivent aussi tomber juste.
  ["Shanghai", [121.47, 31.23], "Kuomintang China"], ["Nankin", [118.8, 32.06], "Kuomintang China"],
  ["Wuhan", [114.3, 30.59], "Kuomintang China"], ["Moukden", [123.43, 41.8], "Manchukuo"], ["Tokyo", [139.69, 35.69], "Imperialist Japan"],
  ["Osaka", [135.5, 34.69], "Imperialist Japan"], ["Delhi", [77.21, 28.61], "British Raj"], ["Bombay", [72.88, 19.08], "British Raj"],
  ["Sydney", [151.21, -33.87], "Dominion of Australia"], ["Johannesburg", [28.05, -26.2], "British South Africa"],
  ["New York", [-74.0, 40.71], "United States"], ["Détroit", [-83.05, 42.33], "United States"], ["Chicago", [-87.63, 41.88], "United States"],
  ["Pittsburgh", [-80.0, 40.44], "United States"], ["Montréal", [-73.57, 45.5], "Dominion of Canada"], ["Toronto", [-79.38, 43.65], "Dominion of Canada"],
  ["Rio de Janeiro", [-43.2, -22.9], "Brazil"], ["Buenos Aires", [-58.38, -34.6], "Argentina"],
];
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
  // Pour un raté : à quelle distance est la terre du bon pays (en km) ?
  let gap = "";
  if (!ok) {
    let best = Infinity;
    for (const f of landFeatures) {
      if ((overrides[f.properties.id] ?? f.properties.owner) !== country) continue;
      for (const polygon of polygonsOf(f.geometry)) for (const vertex of polygon[0]) {
        const [x, y] = transform(vertex);
        best = Math.min(best, Math.hypot((x - point[0]) * Math.cos((point[1] * Math.PI) / 180), y - point[1]) * 111);
      }
    }
    gap = `, à ${Math.round(best)} km de son pays`;
  }
  console.log(`  ${ok ? "OK " : "NON"} ${name} → ${owner}${ok ? "" : ` (attendu : ${country}${gap})`}`);
}
console.log(`Capitales hors de leur pays : ${failures}`);

if (!apply) {
  console.log("Rien n'est écrit sans --apply.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const rewrite = (file) => {
  if (!fs.existsSync(file)) return;
  // Une seule sauvegarde : celle des contours d'origine.
  let backup = originalOf(file);
  if (!backup) {
    backup = `${file}.avant-recalage-${stamp}`;
    fs.copyFileSync(file, backup);
  }
  const data = readJson(backup);
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
  if (!originalOf(coarseStamp)) fs.copyFileSync(coarseStamp, `${coarseStamp}.avant-recalage-${stamp}`);
  fs.rmSync(coarseStamp);
}
