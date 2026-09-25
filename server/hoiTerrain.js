// Couche HOI4, phase 4 — le terrain et les emplacements d'une province.
//
// Run tests: node --test server/hoiTerrain.test.js
// Import-free.
//
// Avec l'altitude (tuiles Terrarium, hoiElevation.js) :
// montagnes et collines viennent du relief réel. Sans elle : quelques grandes
// chaînes connues, en cadres grossiers. Le reste (désert, jungle, forêt,
// marais, urbain) vient de la latitude, de cadres climatiques et des villes.

export const HOI_TERRAINS = Object.freeze(["plaine", "foret", "colline", "montagne", "marais", "desert", "jungle", "urbain"]);

export const TERRAIN_LABELS = Object.freeze({
  plaine: "plaine", foret: "forêt", colline: "collines", montagne: "montagnes",
  marais: "marais", desert: "désert", jungle: "jungle", urbain: "urbain",
});

// Emplacements de construction d'une province, selon son terrain (+1 pour une ville).
export const TERRAIN_SLOTS = Object.freeze({
  urbain: 5, plaine: 3, foret: 2, colline: 2, jungle: 1, montagne: 1, marais: 1, desert: 1,
});
export const CITY_SLOT_POPULATION = 200000;

export const TERRAIN_TUNING = Object.freeze({
  mountainMean: 1800,
  mountainReliefMean: 800,
  mountainRelief: 450,
  hillMean: 600,
  hillRelief: 200,
  urbanPopulation: 1500000,
  urbanDensity: 250, // habitants par km², villes seulement
  marshMaxElevation: 8,
  marshMaxRelief: 6,
  taigaLat: 52,
  tundraLat: 67,
  jungleLat: 12,
  jungleMaxElevation: 1000,
});

// [ouest, sud, est, nord] — grossier exprès : de quoi ne pas mettre la Beauce
// en montagne ni le Tibet en plaine quand l'altitude manque.
const box = (w, s, e, n) => Object.freeze([w, s, e, n]);
const DESERTS = Object.freeze([
  box(-17, 15, 33, 31), // Sahara
  box(34, 13, 59, 32), // Arabie
  box(44, 25, 63, 35), // Iran central
  box(52, 36, 68, 46), // Karakoum, Kyzylkoum
  box(75, 36, 95, 42), // Taklamakan
  box(90, 38, 112, 46), // Gobi
  box(113, -32, 140, -19), // Australie
  box(12, -28, 22, -18), // Kalahari, Namib
  box(-71, -28, -68, -18), // Atacama
  box(-117, 25, -108, 36), // Sonora, Mojave
]);
const MOUNTAINS = Object.freeze([
  box(5.5, 44, 16, 47.8), // Alpes
  box(-2, 42, 3.3, 43.3), // Pyrénées
  box(38, 40, 49, 44), // Caucase
  box(22, 44.5, 27, 49), // Carpates
  box(70, 27, 97, 39), // Himalaya, Tibet, Pamir
  box(-125, 32, -104, 60), // Rocheuses
  box(-80, -45, -64, 10), // Andes
  box(40, 7, 43, 15), // hauts plateaux d'Éthiopie
  box(92, 22, 104, 30), // Yunnan, Birmanie du Nord
]);
const MARSHES = Object.freeze([
  box(24, 51, 31, 53), // Pripiat
  box(65, 55, 85, 64), // Sibérie occidentale
]);

const inBox = (lng, lat, [w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n;
const inAny = (lng, lat, boxes) => boxes.some((entry) => inBox(lng, lat, entry));

// `elevation` : { mean, relief, max } en mètres, ou null sans données.
export const classifyTerrain = ({ lng, lat, elevation = null, population = 0, areaKm2 = 0, coastal = false } = {}) => {
  const T = TERRAIN_TUNING;
  const absLat = Math.abs(lat);
  const density = areaKm2 > 0 ? population / areaKm2 : 0;
  if (population >= T.urbanPopulation && density >= T.urbanDensity) return "urbain";

  if (elevation) {
    if (elevation.mean >= T.mountainMean || (elevation.relief >= T.mountainRelief && elevation.mean >= T.mountainReliefMean)) return "montagne";
    if (elevation.mean >= T.hillMean || elevation.relief >= T.hillRelief) return "colline";
  } else if (inAny(lng, lat, MOUNTAINS)) {
    return "montagne";
  }

  if (inAny(lng, lat, DESERTS)) return "desert";
  if (inAny(lng, lat, MARSHES)) return "marais";
  if (elevation && coastal && elevation.mean <= T.marshMaxElevation && elevation.relief <= T.marshMaxRelief) return "marais";
  if (absLat <= T.jungleLat && (!elevation || elevation.mean < T.jungleMaxElevation)) return "jungle";
  if (lat >= T.taigaLat && lat < T.tundraLat) return "foret";
  return "plaine";
};

export const provinceSlots = (terrain, population = 0) =>
  (TERRAIN_SLOTS[terrain] ?? TERRAIN_SLOTS.plaine) + (population >= CITY_SLOT_POPULATION ? 1 : 0);
