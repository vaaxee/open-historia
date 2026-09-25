// Couche HOI4 — valeurs de départ par pays (phase 1).
//
// Run tests: node --test src/runtime/hoi/presets.test.js
// Import-free apart from engine.js, so it runs without node_modules.
//
// Deux séries détaillées (1936 et 1912) et une base neutre pour tous les autres
// pays. Les pays sont reconnus par leur nom sur la carte — le même nom qu'on lit
// dans world.ownerCodes (« Germany » en 1936, « German Empire » en 1911) — ou par
// un de leurs alias : une série sert aussi bien un scénario maison qu'un préréglage.
//
// Unités, pour tout ce fichier :
//   stocks       unités de ressource en réserve
//   extraction   unités de ressource par mois de 30 jours
//   resources    (catalogue) unités par usine affectée et par mois
//   unitCost     capacité industrielle pour sortir une unité d'équipement
//
// Les chiffres sont des ordres de grandeur à la HOI4, pas des statistiques
// historiques : ils doivent surtout produire les bonnes tensions (l'Allemagne de
// 1936 manque de chrome et de caoutchouc, l'Italie de 1912 de charbon, l'Empire
// ottoman d'acier). L'équilibrage se règle ici et dans HOI_TUNING (engine.js).

import { createNation, enableHoiLayer } from "./engine.js";

// Ce que chaque type d'équipement coûte à produire. Une ligne de production créée
// par l'IA (economyOps, op "line") ne peut viser qu'un équipement de ce catalogue.
export const HOI_EQUIPMENT = Object.freeze({
  // Communs aux deux époques.
  fusils: Object.freeze({ label: "fusils", unitCost: 0.5, resources: Object.freeze({ acier: 1 }) }),
  artillerie: Object.freeze({ label: "pièces d'artillerie", unitCost: 3.5, resources: Object.freeze({ acier: 2 }) }),
  // 1936.
  chars: Object.freeze({ label: "chars", unitCost: 8, resources: Object.freeze({ acier: 2, chrome: 1 }) }),
  chasseurs: Object.freeze({ label: "chasseurs", unitCost: 22, resources: Object.freeze({ aluminium: 2, caoutchouc: 1 }) }),
  bombardiers: Object.freeze({ label: "bombardiers", unitCost: 30, resources: Object.freeze({ aluminium: 3 }) }),
  camions: Object.freeze({ label: "camions", unitCost: 2.5, resources: Object.freeze({ acier: 1, caoutchouc: 1 }) }),
  // 1912.
  mitrailleuses: Object.freeze({ label: "mitrailleuses", unitCost: 2, resources: Object.freeze({ acier: 1 }) }),
  obus: Object.freeze({ label: "obus", unitCost: 0.3, resources: Object.freeze({ acier: 1, charbon: 1 }) }),
});

// Une ligne de production à partir du catalogue : `usines` usines militaires sur
// `equipment`, à l'efficacité de départ donnée.
const line = (equipment, factories, efficiency = 0.4) => {
  const spec = HOI_EQUIPMENT[equipment];
  return {
    id: equipment,
    equipment,
    factories,
    efficiency,
    unitCost: spec.unitCost,
    resources: { ...spec.resources },
  };
};

// Un pays détaillé : ses noms possibles sur la carte, puis ses valeurs.
const nation = (aliases, { civilian, military, stocks, extraction, lines }) => ({
  aliases,
  data: { factories: { civilian, military }, stocks, extraction, lines },
});

export const HOI_SERIES = Object.freeze({
  1936: Object.freeze({
    id: "1936",
    label: "1936 — veille de la Seconde Guerre mondiale",
    // Années de départ servies par défaut par cette série.
    fromYear: 1926,
    toYear: 1950,
    nations: Object.freeze([
      nation(["Germany", "German Reich", "Nazi Germany", "Allemagne"], {
        civilian: 30, military: 14,
        stocks: { acier: 200, aluminium: 80, petrole: 60, caoutchouc: 20, chrome: 10, tungstene: 10 },
        extraction: { acier: 72, aluminium: 24, petrole: 6 },
        lines: [line("fusils", 6, 0.5), line("artillerie", 3), line("chars", 2), line("chasseurs", 3)],
      }),
      nation(["France", "French Republic", "French State"], {
        civilian: 28, military: 11,
        stocks: { acier: 120, aluminium: 60, petrole: 40, caoutchouc: 30, chrome: 10 },
        extraction: { acier: 48, aluminium: 30 },
        lines: [line("fusils", 5, 0.5), line("artillerie", 3), line("chars", 2), line("chasseurs", 1)],
      }),
      nation(["United Kingdom", "Great Britain", "British Empire", "Royaume-Uni"], {
        civilian: 32, military: 9,
        stocks: { acier: 120, aluminium: 80, petrole: 80, caoutchouc: 60, chrome: 20, tungstene: 10 },
        extraction: { acier: 40, aluminium: 20, petrole: 10, caoutchouc: 30, chrome: 6, tungstene: 4 },
        lines: [line("fusils", 3, 0.5), line("chasseurs", 4), line("bombardiers", 2)],
      }),
      nation(["Soviet Union", "USSR", "Union of Soviet Socialist Republics", "Russia", "URSS"], {
        civilian: 34, military: 32,
        stocks: { acier: 300, aluminium: 80, petrole: 150, caoutchouc: 10, chrome: 60, tungstene: 20 },
        extraction: { acier: 120, aluminium: 30, petrole: 60, chrome: 30, tungstene: 8 },
        lines: [line("fusils", 10, 0.5), line("artillerie", 8), line("chars", 8), line("chasseurs", 6)],
      }),
      nation(["United States", "United States of America", "USA", "États-Unis"], {
        civilian: 60, military: 6,
        stocks: { acier: 400, aluminium: 200, petrole: 500, caoutchouc: 80, chrome: 20, tungstene: 30 },
        extraction: { acier: 160, aluminium: 80, petrole: 300, chrome: 6, tungstene: 12 },
        lines: [line("fusils", 2, 0.5), line("chasseurs", 2), line("camions", 2)],
      }),
      nation(["Italy", "Kingdom of Italy", "Italie"], {
        civilian: 16, military: 12,
        stocks: { acier: 80, aluminium: 40, petrole: 30, caoutchouc: 10, chrome: 5 },
        extraction: { acier: 16, aluminium: 12, petrole: 2 },
        lines: [line("fusils", 5, 0.5), line("artillerie", 3), line("chasseurs", 3), line("chars", 1)],
      }),
      nation(["Imperialist Japan", "Japan", "Empire of Japan", "Japanese Empire", "Japon"], {
        civilian: 22, military: 13,
        stocks: { acier: 100, aluminium: 60, petrole: 80, caoutchouc: 30, chrome: 10 },
        extraction: { acier: 20, aluminium: 8, petrole: 2, chrome: 2 },
        lines: [line("fusils", 4, 0.5), line("chasseurs", 5), line("bombardiers", 2), line("chars", 2)],
      }),
      nation(["Kuomintang China", "China", "Republic of China", "Nationalist China", "Chine"], {
        civilian: 10, military: 6,
        stocks: { acier: 40, tungstene: 60, petrole: 5 },
        extraction: { acier: 12, tungstene: 40 },
        lines: [line("fusils", 5, 0.4), line("artillerie", 1)],
      }),
    ]),
  }),
  1912: Object.freeze({
    id: "1912",
    label: "1912 — l'Europe à la veille de la Grande Guerre",
    fromYear: 1900,
    toYear: 1925,
    nations: Object.freeze([
      nation(["German Empire", "Germany", "Deutsches Reich", "Empire allemand"], {
        civilian: 30, military: 16,
        stocks: { acier: 200, charbon: 400, petrole: 20, caoutchouc: 10 },
        extraction: { acier: 80, charbon: 200, petrole: 2 },
        lines: [line("fusils", 5, 0.5), line("mitrailleuses", 2), line("artillerie", 5), line("obus", 4)],
      }),
      nation(["British Empire", "United Kingdom", "Great Britain", "Empire britannique"], {
        civilian: 36, military: 12,
        stocks: { acier: 180, charbon: 500, petrole: 60, caoutchouc: 60 },
        extraction: { acier: 60, charbon: 220, petrole: 20, caoutchouc: 40 },
        lines: [line("fusils", 4, 0.5), line("artillerie", 3), line("obus", 3), line("mitrailleuses", 2)],
      }),
      nation(["French Republic", "France", "République française"], {
        civilian: 24, military: 10,
        stocks: { acier: 120, charbon: 150, petrole: 15, caoutchouc: 20 },
        extraction: { acier: 36, charbon: 60, caoutchouc: 10 },
        lines: [line("fusils", 4, 0.5), line("artillerie", 4), line("obus", 2)],
      }),
      nation(["Russian Empire", "Russia", "Empire russe"], {
        civilian: 20, military: 14,
        stocks: { acier: 150, charbon: 200, petrole: 150 },
        extraction: { acier: 40, charbon: 60, petrole: 40 },
        lines: [line("fusils", 6, 0.4), line("artillerie", 4), line("obus", 4)],
      }),
      nation(["Austrian Empire", "Austria-Hungary", "Austro-Hungarian Empire", "Autriche-Hongrie"], {
        civilian: 16, military: 9,
        stocks: { acier: 90, charbon: 150, petrole: 40 },
        extraction: { acier: 28, charbon: 50, petrole: 12 },
        lines: [line("fusils", 4, 0.4), line("artillerie", 3), line("obus", 2)],
      }),
      nation(["Kingdom of Italy", "Italy", "Royaume d'Italie"], {
        civilian: 12, military: 6,
        stocks: { acier: 60, charbon: 60, petrole: 5 },
        extraction: { acier: 10, charbon: 4 },
        lines: [line("fusils", 3, 0.4), line("artillerie", 2), line("obus", 1)],
      }),
      nation(["Ottoman Empire", "Turkey", "Empire ottoman"], {
        civilian: 6, military: 4,
        stocks: { acier: 20, charbon: 30, petrole: 10 },
        extraction: { acier: 2, charbon: 6 },
        lines: [line("fusils", 3, 0.3), line("artillerie", 1, 0.3)],
      }),
      nation(["United States", "United States of America", "États-Unis"], {
        civilian: 50, military: 4,
        stocks: { acier: 400, charbon: 800, petrole: 400, caoutchouc: 40 },
        extraction: { acier: 140, charbon: 300, petrole: 120 },
        lines: [line("fusils", 2, 0.5), line("artillerie", 1), line("mitrailleuses", 1)],
      }),
      nation(["Japanese Empire", "Japan", "Empire of Japan", "Empire du Japon"], {
        civilian: 10, military: 6,
        stocks: { acier: 40, charbon: 80, petrole: 10 },
        extraction: { acier: 8, charbon: 30 },
        lines: [line("fusils", 3, 0.4), line("artillerie", 2), line("obus", 1)],
      }),
    ]),
  }),
});

// Tous les autres pays : une petite économie qui tourne, pour que chaque pays de
// la carte ait quelque chose à perdre, à échanger ou à saboter.
// Phase 3 : où se trouvaient vraiment les usines des pays détaillés. Les usines
// de départ y deviennent des complexes industriels (buildings.js), dans cet ordre
// (le plus important d'abord). Écrit à la main : rattacher les villes d'une carte
// à ses pays n'est pas assez sûr pour ça, et les populations d'aujourd'hui
// mettraient Kinshasa avant Paris.
const site = (name, lng, lat) => Object.freeze({ name, coordinates: Object.freeze([lng, lat]) });

export const HOI_INDUSTRIAL_SITES = Object.freeze({
  1936: Object.freeze([
    [["Germany", "German Reich", "Nazi Germany"], [site("Essen", 7.01, 51.46), site("Berlin", 13.4, 52.52), site("Hambourg", 9.99, 53.55), site("Munich", 11.58, 48.14)]],
    [["France", "French Republic", "French State"], [site("Paris", 2.35, 48.86), site("Lille", 3.06, 50.63), site("Lyon", 4.84, 45.76), site("Saint-Étienne", 4.39, 45.44)]],
    [["United Kingdom", "Great Britain", "British Empire"], [site("Birmingham", -1.9, 52.49), site("Manchester", -2.24, 53.48), site("Glasgow", -4.25, 55.86), site("Londres", -0.13, 51.51)]],
    [["Soviet Union", "USSR", "Union of Soviet Socialist Republics", "Russia"], [site("Moscou", 37.62, 55.76), site("Leningrad", 30.32, 59.94), site("Kharkov", 36.23, 49.99), site("Sverdlovsk", 60.61, 56.84)]],
    [["United States", "United States of America", "USA"], [site("Détroit", -83.05, 42.33), site("Pittsburgh", -80, 40.44), site("Chicago", -87.63, 41.88), site("New York", -74.01, 40.71)]],
    [["Italy", "Kingdom of Italy"], [site("Turin", 7.69, 45.07), site("Milan", 9.19, 45.46), site("Gênes", 8.93, 44.41)]],
    [["Imperialist Japan", "Japan", "Empire of Japan", "Japanese Empire"], [site("Tokyo", 139.69, 35.69), site("Osaka", 135.5, 34.69), site("Nagoya", 136.91, 35.18)]],
    [["Kuomintang China", "China", "Republic of China", "Nationalist China"], [site("Shanghai", 121.47, 31.23), site("Wuhan", 114.3, 30.59)]],
  ]),
  1912: Object.freeze([
    [["German Empire", "Germany", "Deutsches Reich"], [site("Essen", 7.01, 51.46), site("Berlin", 13.4, 52.52), site("Breslau", 17.04, 51.11), site("Hambourg", 9.99, 53.55)]],
    [["British Empire", "United Kingdom", "Great Britain"], [site("Birmingham", -1.9, 52.49), site("Manchester", -2.24, 53.48), site("Glasgow", -4.25, 55.86), site("Newcastle", -1.62, 54.98)]],
    [["French Republic", "France"], [site("Paris", 2.35, 48.86), site("Lille", 3.06, 50.63), site("Le Creusot", 4.43, 46.8)]],
    [["Russian Empire", "Russia"], [site("Saint-Pétersbourg", 30.32, 59.94), site("Moscou", 37.62, 55.76), site("Iouzovka", 37.8, 48.02)]],
    [["Austrian Empire", "Austria-Hungary", "Austro-Hungarian Empire"], [site("Vienne", 16.37, 48.21), site("Pilsen", 13.38, 49.74)]],
    [["Kingdom of Italy", "Italy"], [site("Turin", 7.69, 45.07), site("Milan", 9.19, 45.46)]],
    [["Ottoman Empire", "Turkey"], [site("Constantinople", 28.98, 41.01)]],
    [["United States", "United States of America"], [site("Pittsburgh", -80, 40.44), site("Détroit", -83.05, 42.33), site("Chicago", -87.63, 41.88), site("New York", -74.01, 40.71)]],
    [["Japanese Empire", "Japan", "Empire of Japan"], [site("Tokyo", 139.69, 35.69), site("Osaka", 135.5, 34.69)]],
  ]),
});

// Les sites industriels d'un pays dans une série, ou [] s'il n'y figure pas.
export const findIndustrialSites = (seriesId, polity) => {
  const key = String(polity ?? "").trim().toLowerCase();
  const entry = (HOI_INDUSTRIAL_SITES[seriesId] ?? []).find(([aliases]) => aliases.some((alias) => alias.toLowerCase() === key));
  return entry ? entry[1] : [];
};

export const HOI_NEUTRAL_NATION = Object.freeze({
  factories: Object.freeze({ civilian: 3, military: 1 }),
  stocks: Object.freeze({ acier: 10 }),
  extraction: Object.freeze({ acier: 3 }),
  lines: Object.freeze([Object.freeze(line("fusils", 1, 0.3))]),
});

const nameKey = (value) => String(value ?? "").trim().toLowerCase();

// La série qui correspond à une date de départ, ou null (base neutre partout).
export const pickHoiSeries = (startDate) => {
  const year = Number(String(startDate ?? "").slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const found = Object.values(HOI_SERIES).find((series) => year >= series.fromYear && year <= series.toYear);
  return found ? found.id : null;
};

// Les valeurs détaillées d'un pays dans une série, ou null s'il n'y figure pas.
export const findPresetNation = (seriesId, polity) => {
  const series = HOI_SERIES[seriesId];
  if (!series) return null;
  const key = nameKey(polity);
  if (!key) return null;
  const entry = series.nations.find((candidate) => candidate.aliases.some((alias) => nameKey(alias) === key));
  return entry ? entry.data : null;
};

// Les pays d'une partie : ceux qui possèdent quelque chose sur la carte, plus les
// entités créées par la partie (polityOverrides). Triés pour un world.json stable.
export const listWorldPolities = (world) => {
  const names = [
    ...(Array.isArray(world?.ownerCodes) ? world.ownerCodes : []),
    ...Object.keys(world?.polityOverrides && typeof world.polityOverrides === "object" ? world.polityOverrides : {}),
  ].map((name) => String(name ?? "").trim()).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
};

// Une nation prête pour world.hoi : la série si le pays y figure, sinon la base neutre.
// Deux alias d'un même pays présents sur la même carte (« Japan » et « Imperialist
// Japan ») reçoivent chacun les valeurs détaillées ; c'est rare et sans danger.
export const buildPresetNation = (seriesId, polity) => {
  const detailed = findPresetNation(seriesId, polity);
  const source = detailed ?? HOI_NEUTRAL_NATION;
  return createNation({
    factories: { ...source.factories },
    stocks: { ...source.stocks },
    extraction: { ...source.extraction },
    lines: source.lines.map((entry) => ({ ...entry, resources: { ...entry.resources } })),
  });
};

// Active la couche sur une partie avec les valeurs de départ. `seriesId` absent :
// choisie d'après la date de départ. Renvoie aussi ce qui a été appliqué, pour que
// l'interface puisse le dire.
export const enableHoiLayerFromPresets = (world, { startDate, seriesId } = {}) => {
  const series = seriesId === undefined ? pickHoiSeries(startDate) : (HOI_SERIES[seriesId] ? String(seriesId) : null);
  const polities = listWorldPolities(world);
  const nations = Object.fromEntries(polities.map((polity) => [polity, buildPresetNation(series, polity)]));
  const detailed = polities.filter((polity) => findPresetNation(series, polity));
  return {
    world: enableHoiLayer(world, { startDate, nations, series }),
    series,
    detailed,
    neutral: polities.length - detailed.length,
  };
};
