// Phase 7.8 bis — le nom d'une zone de mer : sa mer ou son golfe.
//
// Test G avec Jev : les zones portaient le nom d'un état côtier (Tver, Pskov,
// Irkoutsk, Aktobe, Achgabat), et des lacs et réservoirs passaient pour la mer.
// Une zone prend maintenant le nom de la mer où tombe son centre : d'abord les
// golfes et mers intérieures (les boîtes les plus précises en tête), puis les
// grandes mers, puis l'océan. Les mers fermées (`enclosed`) sont celles qu'on
// garde même si la trame ne les relie pas à l'océan (mer Noire, Caspienne…) ;
// une étendue d'eau séparée de l'océan qui n'en est pas une est un lac
// (scripts/worldmap/seas.mjs). Import-free.

// [id, français, anglais, [lngMin, latMin, lngMax, latMax], { enclosed, minCells }]
// Une boîte dont lngMin > lngMax passe l'antiméridien.
export const SEA_BOXES = Object.freeze([
  ["finland", "golfe de Finlande", "Gulf of Finland", [22.5, 59.2, 30.5, 60.9], { enclosed: true, minCells: 150 }],
  ["bothnia", "golfe de Botnie", "Gulf of Bothnia", [17, 60.3, 25.8, 66], { enclosed: true, minCells: 300 }],
  ["riga", "golfe de Riga", "Gulf of Riga", [21.5, 56.8, 24.6, 59], { enclosed: true, minCells: 100 }],
  ["kattegat", "Skagerrak et Kattegat", "Skagerrak and Kattegat", [7, 56.3, 12.9, 59.5], {}],
  ["baltic", "mer Baltique", "Baltic Sea", [9.5, 53.5, 30, 66], { enclosed: true, minCells: 1500 }],
  ["azov", "mer d'Azov", "Sea of Azov", [34.5, 45.2, 39.6, 47.4], { enclosed: true, minCells: 250 }],
  ["marmara", "mer de Marmara", "Sea of Marmara", [26.5, 40.2, 30, 41.1], { enclosed: true, minCells: 80 }],
  ["black", "mer Noire", "Black Sea", [27, 40.8, 42, 47.2], { enclosed: true, minCells: 1500 }],
  ["caspian", "mer Caspienne", "Caspian Sea", [46, 36.5, 55.5, 47.5], { enclosed: true, minCells: 1500 }],
  ["white", "mer Blanche", "White Sea", [32, 63.5, 45, 68.6], { enclosed: true, minCells: 300 }],
  ["aegean", "mer Égée", "Aegean Sea", [22, 35, 28.5, 41], { enclosed: true, minCells: 1000 }],
  ["adriatic", "mer Adriatique", "Adriatic Sea", [12, 39.8, 20, 45.9], { enclosed: true, minCells: 1000 }],
  ["ionian", "mer Ionienne", "Ionian Sea", [15, 35, 22.5, 40.5], { enclosed: true, minCells: 1000 }],
  ["ligurian", "mer Ligure", "Ligurian Sea", [7, 42.5, 10.5, 44.5], { enclosed: true, minCells: 300 }],
  ["tyrrhenian", "mer Tyrrhénienne", "Tyrrhenian Sea", [8.8, 37.5, 16.5, 44.5], { enclosed: true, minCells: 1000 }],
  ["mediterranean", "mer Méditerranée", "Mediterranean Sea", [-6, 30, 36.5, 46], { enclosed: true, minCells: 1500 }],
  ["red", "mer Rouge", "Red Sea", [32, 12.3, 44, 30], { enclosed: true, minCells: 1000 }],
  ["persian", "golfe Persique", "Persian Gulf", [47.5, 23.5, 57, 31], { enclosed: true, minCells: 800 }],
  ["irish", "mer d'Irlande", "Irish Sea", [-7, 51.5, -2.8, 55.6], {}],
  ["channel", "Manche", "English Channel", [-6, 48.4, 2, 51.2], {}],
  ["north", "mer du Nord", "North Sea", [-4, 51, 9.5, 61.5], {}],
  ["biscay", "golfe de Gascogne", "Bay of Biscay", [-10, 43.2, -1, 48.4], {}],
  ["norwegian", "mer de Norvège", "Norwegian Sea", [-5, 61.5, 16, 72], {}],
  ["barents", "mer de Barents", "Barents Sea", [16, 66, 60, 82], {}],
  ["kara", "mer de Kara", "Kara Sea", [60, 66, 100, 82], {}],
  ["arabian", "mer d'Arabie", "Arabian Sea", [50, 0, 78, 26], {}],
  ["bengal", "golfe du Bengale", "Bay of Bengal", [78, 0, 100, 23], {}],
  ["southchina", "mer de Chine méridionale", "South China Sea", [99, 0, 122, 23.5], {}],
  ["eastchina", "mer de Chine orientale", "East China Sea", [117, 23.5, 131, 33.5], {}],
  ["yellow", "mer Jaune", "Yellow Sea", [117, 33.5, 127, 41], {}],
  ["japan", "mer du Japon", "Sea of Japan", [127, 33.5, 142, 52], {}],
  ["okhotsk", "mer d'Okhotsk", "Sea of Okhotsk", [135, 43, 165, 62], {}],
  ["bering", "mer de Béring", "Bering Sea", [162, 51, -157, 66], {}],
  ["mexico", "golfe du Mexique", "Gulf of Mexico", [-98, 18, -80.5, 31], {}],
  ["caribbean", "mer des Caraïbes", "Caribbean Sea", [-89, 8, -59, 22.5], {}],
  ["hudson", "baie d'Hudson", "Hudson Bay", [-95, 51, -76, 66], { enclosed: true, minCells: 3000 }],
  ["tasman", "mer de Tasman", "Tasman Sea", [147, -47, 175, -28], {}],
  ["coral", "mer de Corail", "Coral Sea", [142, -28, 165, -8], {}],
]);

const inBox = (lng, lat, [x0, y0, x1, y1]) => lat >= y0 && lat <= y1 && (x0 <= x1 ? lng >= x0 && lng <= x1 : lng >= x0 || lng <= x1);

// L'océan d'un point hors de toute mer nommée.
const ocean = (lng, lat) => {
  if (lat > 66) return ["arctic", "océan Arctique", "Arctic Ocean"];
  if (lat < -55) return ["southern", "océan Austral", "Southern Ocean"];
  const north = lat >= 0;
  if (lng >= 20 && lng < 120 && lat < 25) return ["indian", "océan Indien", "Indian Ocean"];
  const pacific = lng >= 120 || lng < -100 || (lng < -70 && lat < 8);
  if (pacific) return north ? ["north-pacific", "Pacifique Nord", "North Pacific"] : ["south-pacific", "Pacifique Sud", "South Pacific"];
  return north ? ["north-atlantic", "Atlantique Nord", "North Atlantic"] : ["south-atlantic", "Atlantique Sud", "South Atlantic"];
};

// La mer d'un point : { id, fr, en, enclosed, minCells, ocean }.
export const seaAt = (lng, lat) => {
  const hit = SEA_BOXES.find(([, , , box]) => inBox(lng, lat, box));
  if (hit) return { id: hit[0], fr: hit[1], en: hit[2], enclosed: Boolean(hit[4]?.enclosed), minCells: hit[4]?.minCells ?? 0, ocean: false };
  const [id, fr, en] = ocean(lng, lat);
  return { id, fr, en, enclosed: false, minCells: 0, ocean: true };
};

// Le nom d'une zone pour l'interface : la mer, et, pour distinguer les zones
// d'une même mer, la côte qu'elle borde (« mer Baltique, large de Gdynia »).
export const seaZoneLabel = (zone, { language = "en", coastName = "" } = {}) => {
  const fr = /^fr\b/i.test(String(language || ""));
  const name = zone?.name?.[fr ? "fr" : "en"] || (fr ? "zone maritime" : "sea zone");
  const sea = fr ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  return coastName ? `${sea}, ${fr ? "large de" : "off"} ${coastName}` : sea;
};
