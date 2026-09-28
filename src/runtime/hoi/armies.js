// Couche HOI4 — les armées (phase 7.1).
//
// Run tests: node --test src/runtime/hoi/armies.test.js
// Import-free : il tourne sans node_modules, comme engine.js.
//
// Principe inchangé : l'IA raconte, le moteur compte. Une division ne naît que du
// stock d'équipement et de la main-d'œuvre de son pays ; elle s'use, se complète
// et se repose ici, une fois par saut, par des fonctions pures appelées depuis
// advanceHoiLayer (engine.js). L'IA peut seulement DEMANDER un recrutement
// (economyOps, op "recruit"), que le moteur accepte ou refuse.
//
// Échelle : les équipements se comptent dans les unités que produisent les lignes
// (une usine militaire donne 1 de capacité par jour ; l'URSS de 1936 sort environ
// 300 « fusils » par mois). Les gabarits sont écrits dans ces unités-là, pas en
// armes réelles : sinon aucun pays ne pourrait équiper une seule division.
//
// Forme de world.hoi.armies :
// {
//   [polity]: {
//     stockpile: { fusils: 120, artillerie: 8, ... },   // équipement en réserve
//     manpower:  { available: 900000, growthPerMonth: 30000 },
//     divisions: [{
//       id, name, template,           // gabarit : infanterie, blindes, artillerie, chasse, bombardement, flotte
//       men, equipment: { fusils: 220, ... },
//       organisation, morale,          // 0 → 100
//       experience,                    // 0 → 1
//       stateId, frontId,              // où elle se tient, le front qui l'emploie (7.3)
//       createdDate,
//     }],
//   }
// }

import { SUPPLY_TUNING, applySupply } from "./supply.js";

export const ARMY_TUNING = Object.freeze({
  daysPerMonth: 30,
  // Usure de l'équipement d'une division, par mois, hors combat.
  upkeepPerMonth: 0.01,
  // Organisation regagnée par jour de repos, au plus, et morale de repos.
  organisationPerDay: 5,
  restingMorale: 70,
  moralePerDay: 1,
  // Un recrutement exige au moins cette part de chaque équipement du gabarit.
  minRecruitShare: 0.5,
  // Divisions par pays, garde-fou contre une IA qui recruterait sans fin.
  maxDivisions: 400,
});

// Gabarits par série (ceux de presets.js : 1936 et 1912). `kind` : land, air, sea.
export const DIVISION_TEMPLATES = Object.freeze({
  1936: Object.freeze({
    infanterie: Object.freeze({ label: "division d'infanterie", kind: "land", men: 10000, equipment: Object.freeze({ fusils: 220, artillerie: 8 }) }),
    blindes: Object.freeze({ label: "division blindée", kind: "land", men: 8000, equipment: Object.freeze({ chars: 45, fusils: 110, camions: 20 }) }),
    artillerie: Object.freeze({ label: "division d'artillerie", kind: "land", men: 6000, equipment: Object.freeze({ artillerie: 16, fusils: 60, camions: 10 }) }),
    chasse: Object.freeze({ label: "escadre de chasse", kind: "air", men: 1500, equipment: Object.freeze({ chasseurs: 22 }) }),
    bombardement: Object.freeze({ label: "escadre de bombardement", kind: "air", men: 2000, equipment: Object.freeze({ bombardiers: 15 }) }),
    flotte: Object.freeze({ label: "flotte", kind: "sea", men: 4000, equipment: Object.freeze({ navires: 4 }) }),
  }),
  1912: Object.freeze({
    infanterie: Object.freeze({ label: "division d'infanterie", kind: "land", men: 15000, equipment: Object.freeze({ fusils: 300, mitrailleuses: 12, artillerie: 8, obus: 60 }) }),
    artillerie: Object.freeze({ label: "division d'artillerie", kind: "land", men: 6000, equipment: Object.freeze({ artillerie: 20, fusils: 60, obus: 120 }) }),
    flotte: Object.freeze({ label: "flotte", kind: "sea", men: 5000, equipment: Object.freeze({ navires: 4 }) }),
  }),
});

// Les gabarits d'une série, ceux de 1936 par défaut.
export const templatesFor = (series) => DIVISION_TEMPLATES[String(series ?? "")] ?? DIVISION_TEMPLATES[1936];

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const clean = (value) => String(value ?? "").trim();
const positiveMap = (map) => Object.fromEntries(Object.entries(isObject(map) ? map : {})
  .map(([key, value]) => [clean(key), round2(Math.max(0, num(value)))])
  .filter(([key]) => key));

export const normalizeDivision = (value, index = 0) => {
  if (!isObject(value)) return null;
  const template = clean(value.template);
  if (!template) return null;
  return {
    id: clean(value.id) || `division-${index + 1}`,
    name: clean(value.name) || `Division ${index + 1}`,
    template,
    men: Math.max(0, Math.round(num(value.men))),
    equipment: positiveMap(value.equipment),
    organisation: round2(clamp(num(value.organisation, 100), 0, 100)),
    morale: round2(clamp(num(value.morale, ARMY_TUNING.restingMorale), 0, 100)),
    experience: round2(clamp(num(value.experience), 0, 1)),
    stateId: clean(value.stateId),
    frontId: clean(value.frontId),
    createdDate: clean(value.createdDate),
    // Phase 7.2 (supply.js) : le ravitaillement reçu au dernier saut, 0 → 1, et
    // depuis combien de jours la division est encerclée.
    supply: round2(clamp(num(value.supply, 1), 0, 1)),
    encircledDays: Math.max(0, Math.round(num(value.encircledDays))),
  };
};

// Phase 7.2 : l'intendance. Les usines civiles d'un pays fournissent chaque mois
// de quoi ravitailler ses troupes (« fournitures »), en plus de ce qu'une ligne
// dédiée produirait.
export const SUPPLIES_PER_CIVILIAN_FACTORY_PER_MONTH = 25;
export const intendance = (civilianFactories, days) =>
  round2(Math.max(0, num(civilianFactories)) * SUPPLIES_PER_CIVILIAN_FACTORY_PER_MONTH * (days / ARMY_TUNING.daysPerMonth));

export const normalizeArmy = (value) => {
  const source = isObject(value) ? value : {};
  return {
    stockpile: positiveMap(source.stockpile),
    manpower: {
      available: Math.max(0, Math.round(num(source.manpower?.available))),
      growthPerMonth: Math.max(0, Math.round(num(source.manpower?.growthPerMonth))),
    },
    divisions: (Array.isArray(source.divisions) ? source.divisions : []).map(normalizeDivision).filter(Boolean),
  };
};

// Ce qu'une division a de son gabarit : hommes, équipement (la moyenne des parts,
// chaque part plafonnée à 1), et l'ensemble (le plus faible des deux).
export const divisionStrength = (division, template) => {
  if (!template) return { men: 0, equipment: 0, overall: 0 };
  const men = template.men > 0 ? Math.min(1, num(division?.men) / template.men) : 1;
  const needs = Object.entries(template.equipment ?? {});
  const equipment = needs.length
    ? needs.reduce((sum, [item, need]) => sum + (need > 0 ? Math.min(1, num(division?.equipment?.[item]) / need) : 1), 0) / needs.length
    : 1;
  return { men: round2(men), equipment: round2(equipment), overall: round2(Math.min(men, equipment)) };
};

// Ce que les lignes ont sorti pendant le saut entre dans la réserve.
export const depositProduction = (army, produced) => {
  const stockpile = { ...army.stockpile };
  for (const [item, count] of Object.entries(isObject(produced) ? produced : {})) {
    if (num(count) > 0) stockpile[item] = round2(num(stockpile[item]) + num(count));
  }
  return { ...army, stockpile };
};

// La main-d'œuvre se renouvelle chaque mois (jeunes classes, convalescents).
export const growManpower = (army, days) => ({
  ...army,
  manpower: {
    ...army.manpower,
    available: Math.round(army.manpower.available + army.manpower.growthPerMonth * (days / ARMY_TUNING.daysPerMonth)),
  },
});

// Les divisions en sous-effectif se complètent depuis la réserve et la
// main-d'œuvre, les plus faibles d'abord. Renvoie ce qui a été versé à chacune.
export const reinforceArmy = (army, templates) => {
  const stockpile = { ...army.stockpile };
  let available = army.manpower.available;
  const reinforced = [];
  // Une division encerclée ou sans ravitaillement ne reçoit rien (supply.js).
  const order = army.divisions
    .map((division, index) => ({ division, index, strength: divisionStrength(division, templates[division.template]).overall }))
    .filter(({ division }) => !(division.encircledDays > 0) && num(division.supply, 1) > 0)
    .sort((a, b) => a.strength - b.strength || a.index - b.index);
  const divisions = [...army.divisions];
  for (const { division, index } of order) {
    const template = templates[division.template];
    if (!template) continue;
    const menGiven = Math.max(0, Math.min(template.men - division.men, available));
    available -= menGiven;
    const equipment = { ...division.equipment };
    const given = {};
    for (const [item, need] of Object.entries(template.equipment)) {
      const missing = Math.max(0, need - num(equipment[item]));
      const taken = round2(Math.min(missing, num(stockpile[item])));
      if (taken > 0) {
        equipment[item] = round2(num(equipment[item]) + taken);
        stockpile[item] = round2(num(stockpile[item]) - taken);
        given[item] = taken;
      }
    }
    if (menGiven > 0 || Object.keys(given).length) {
      divisions[index] = { ...division, men: division.men + menGiven, equipment };
      reinforced.push({ id: division.id, men: menGiven, equipment: given });
    }
  }
  return { army: { ...army, stockpile, manpower: { ...army.manpower, available }, divisions }, reinforced };
};

// L'entretien : un peu d'équipement s'use chaque mois ; au repos, l'organisation
// remonte (d'autant plus vite que la division est complète) et le moral revient
// vers sa valeur de repos. Renvoie ce qui s'est usé, par équipement.
export const upkeepArmy = (army, days, templates) => {
  const T = ARMY_TUNING;
  const share = T.upkeepPerMonth * (days / T.daysPerMonth);
  const worn = {};
  const divisions = army.divisions.map((division) => {
    const equipment = {};
    for (const [item, count] of Object.entries(division.equipment)) {
      const lost = round2(count * share);
      equipment[item] = round2(count - lost);
      if (lost > 0) worn[item] = round2(num(worn[item]) + lost);
    }
    const strength = divisionStrength({ ...division, equipment }, templates[division.template]).overall;
    // Mal ravitaillée, elle ne se réorganise pas au-delà de ce qui lui arrive.
    const ceiling = 100 * Math.max(0.2, strength) * Math.max(0.1, num(division.supply, 1));
    // Encerclée, elle ne se repose pas (supply.js lui en fait perdre).
    const resting = !(division.encircledDays > 0);
    const organisation = resting && division.organisation < ceiling
      ? Math.min(ceiling, division.organisation + T.organisationPerDay * days * Math.max(0.2, strength))
      : Math.min(division.organisation, 100);
    const gap = T.restingMorale - division.morale;
    const morale = division.morale + Math.sign(gap) * Math.min(Math.abs(gap), T.moralePerDay * days);
    return { ...division, equipment, organisation: round2(organisation), morale: round2(morale) };
  });
  return { army: { ...army, divisions }, worn };
};

// Un saut : la production entre en réserve, la main-d'œuvre se renouvelle, les
// divisions s'usent puis se complètent. Pur : renvoie l'armée et son rapport.
// Phase 7.2 : `supply` (Map id d'état → { level, encircled }, supply.js) donne à
// chaque division son ravitaillement avant l'usure et le remplissage ; absent,
// les divisions sont ravitaillées depuis la réserve seule.
export const advanceArmy = (input, days, { produced = {}, templates = templatesFor("1936"), supply = null } = {}) => {
  let army = normalizeArmy(input);
  const report = { deposited: positiveMap(produced), worn: {}, reinforced: [], manpower: army.manpower.available, supply: null };
  if (!(days > 0)) return { army, report };
  army = depositProduction(army, produced);
  army = growManpower(army, days);
  const supplied = applySupply(army, supply, days, templates);
  army = supplied.army;
  report.supply = supplied.report;
  const upkeep = upkeepArmy(army, days, templates);
  army = upkeep.army;
  report.worn = upkeep.worn;
  const reinforcement = reinforceArmy(army, templates);
  army = reinforcement.army;
  report.reinforced = reinforcement.reinforced;
  report.manpower = army.manpower.available;
  return { army, report };
};

// Une nouvelle division, prise sur la réserve : les hommes au complet et au moins
// la moitié de chaque équipement du gabarit, sinon refus avec sa raison. Ce qui
// manque viendra des remplissages suivants. Renvoie { army, division, reason }.
export const recruitDivision = (input, { template, name = "", stateId = "", id = "", date = "" } = {}, templates = templatesFor("1936")) => {
  const army = normalizeArmy(input);
  const key = clean(template);
  const spec = templates[key];
  if (!spec) return { army, division: null, reason: `"${key}" is not a division template here (${Object.keys(templates).join(", ")})` };
  if (army.divisions.length >= ARMY_TUNING.maxDivisions) return { army, division: null, reason: `the army already has ${ARMY_TUNING.maxDivisions} divisions` };
  if (army.manpower.available < spec.men) {
    return { army, division: null, reason: `not enough manpower: ${army.manpower.available} available, ${spec.men} needed` };
  }
  const short = Object.entries(spec.equipment)
    .filter(([item, need]) => num(army.stockpile[item]) < need * ARMY_TUNING.minRecruitShare)
    .map(([item, need]) => `${item} ${round2(num(army.stockpile[item]))}/${round2(need * ARMY_TUNING.minRecruitShare)}`);
  if (short.length) return { army, division: null, reason: `not enough equipment in the stockpile (${short.join(", ")})` };
  const stockpile = { ...army.stockpile };
  const equipment = {};
  for (const [item, need] of Object.entries(spec.equipment)) {
    const taken = round2(Math.min(need, num(stockpile[item])));
    equipment[item] = taken;
    stockpile[item] = round2(num(stockpile[item]) - taken);
  }
  const index = army.divisions.length;
  const division = normalizeDivision({
    id: clean(id) || `division-${index + 1}`,
    name: clean(name) || `${spec.label} ${index + 1}`,
    template: key,
    men: spec.men,
    equipment,
    organisation: 30,
    morale: ARMY_TUNING.restingMorale,
    experience: 0,
    stateId,
    createdDate: date,
  }, index);
  return {
    army: { ...army, stockpile, manpower: { ...army.manpower, available: army.manpower.available - spec.men }, divisions: [...army.divisions, division] },
    division,
    reason: "",
  };
};

// ---------------------------------------------------------------------------
// Valeurs de départ
// ---------------------------------------------------------------------------

// Ordres de bataille de 1936 des puissances détaillées (presets.js), en nombre de
// divisions par gabarit, et leur main-d'œuvre mobilisable. Ordres de grandeur,
// pas un inventaire : l'équilibrage se règle ici.
const OOB = (aliases, divisions, manpower, growthPerMonth, fill = 1) => Object.freeze({ aliases, divisions, manpower, growthPerMonth, fill });
export const ARMY_PRESETS = Object.freeze({
  1936: Object.freeze([
    OOB(["Soviet Union", "USSR", "URSS"], { infanterie: 90, blindes: 4, artillerie: 6, chasse: 6, bombardement: 4, flotte: 3 }, 1500000, 60000),
    OOB(["Germany", "German Reich", "Nazi Germany"], { infanterie: 30, blindes: 3, artillerie: 3, chasse: 4, bombardement: 2, flotte: 2 }, 900000, 40000),
    OOB(["France", "French Republic"], { infanterie: 45, blindes: 2, artillerie: 4, chasse: 3, bombardement: 2, flotte: 4 }, 700000, 25000),
    OOB(["United Kingdom", "Great Britain", "British Empire"], { infanterie: 20, blindes: 1, artillerie: 2, chasse: 4, bombardement: 2, flotte: 10 }, 600000, 25000),
    OOB(["United States", "United States of America", "USA"], { infanterie: 15, artillerie: 1, chasse: 3, bombardement: 1, flotte: 10 }, 1000000, 40000),
    OOB(["Italy", "Kingdom of Italy"], { infanterie: 35, blindes: 1, artillerie: 3, chasse: 3, bombardement: 2, flotte: 4 }, 600000, 20000),
    OOB(["Imperialist Japan", "Japan", "Empire of Japan"], { infanterie: 25, blindes: 1, artillerie: 2, chasse: 3, bombardement: 2, flotte: 8 }, 700000, 25000),
    OOB(["Kuomintang China", "China", "Republic of China"], { infanterie: 60, artillerie: 1, chasse: 1 }, 2000000, 50000, 0.5),
    // Les puissances moyennes (ordres de grandeur de 1936) : sans elles, la
    // Pologne n'avait que trois divisions.
    OOB(["Poland", "Second Polish Republic"], { infanterie: 30, artillerie: 2, chasse: 1 }, 800000, 20000, 0.8),
    OOB(["Romania", "Kingdom of Romania"], { infanterie: 20, artillerie: 1, chasse: 1 }, 500000, 12000, 0.7),
    OOB(["Czechoslovakia"], { infanterie: 20, blindes: 1, artillerie: 2, chasse: 1 }, 450000, 12000, 0.85),
    OOB(["Yugoslavia", "Kingdom of Yugoslavia"], { infanterie: 16, artillerie: 1 }, 400000, 10000, 0.7),
    OOB(["Spain", "Spanish Republic"], { infanterie: 12, artillerie: 1, chasse: 1 }, 400000, 10000, 0.7),
    OOB(["Turkey", "Republic of Turkey"], { infanterie: 16, artillerie: 1 }, 400000, 10000, 0.7),
    OOB(["Hungary", "Kingdom of Hungary"], { infanterie: 7 }, 200000, 6000, 0.7),
    OOB(["Belgium"], { infanterie: 12, artillerie: 1 }, 250000, 6000, 0.85),
    OOB(["Netherlands"], { infanterie: 8, flotte: 1 }, 200000, 5000, 0.8),
    OOB(["Sweden"], { infanterie: 6, flotte: 1 }, 150000, 4000, 0.85),
    OOB(["Finland"], { infanterie: 9 }, 150000, 4000, 0.85),
    OOB(["Greece", "Kingdom of Greece"], { infanterie: 10 }, 200000, 5000, 0.7),
    OOB(["Bulgaria", "Kingdom of Bulgaria"], { infanterie: 8 }, 150000, 4000, 0.7),
    OOB(["Lithuania"], { infanterie: 3 }, 80000, 2000, 0.85),
    OOB(["Latvia"], { infanterie: 4 }, 80000, 2000, 0.85),
    OOB(["Estonia"], { infanterie: 3 }, 60000, 1500, 0.85),
    OOB(["Portugal"], { infanterie: 5, flotte: 1 }, 150000, 4000, 0.7),
    OOB(["Manchukuo"], { infanterie: 6 }, 150000, 4000, 0.6),
    OOB(["Mongolia"], { infanterie: 3 }, 40000, 1000, 0.7),
  ]),
});
// Tous les autres : quelques divisions d'infanterie incomplètes.
export const ARMY_NEUTRAL = Object.freeze({ divisions: Object.freeze({ infanterie: 3 }), manpower: 60000, growthPerMonth: 2000, fill: 0.8 });

const presetFor = (series, polity) => {
  const key = clean(polity).toLowerCase();
  return (ARMY_PRESETS[String(series ?? "")] ?? []).find((entry) => entry.aliases.some((alias) => alias.toLowerCase() === key)) ?? null;
};

// L'armée de départ d'un pays : ses divisions (remplies à `fill`), une réserve
// d'un dixième de ce qu'elles portent, et sa main-d'œuvre. `stateId` : où elles se
// tiennent au départ (sa capitale), à répartir sur les fronts à l'étape 7.3.
export const seedArmy = (polity, { series = "1936", stateId = "", date = "" } = {}) => {
  const templates = templatesFor(series);
  const preset = presetFor(series, polity) ?? ARMY_NEUTRAL;
  const divisions = [];
  const stockpile = {};
  const prefix = clean(polity).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "army";
  for (const [key, count] of Object.entries(preset.divisions)) {
    const spec = templates[key];
    if (!spec) continue;
    for (let n = 0; n < count; n += 1) {
      const equipment = Object.fromEntries(Object.entries(spec.equipment).map(([item, need]) => [item, round2(need * preset.fill)]));
      divisions.push(normalizeDivision({
        id: `${prefix}-${key}-${n + 1}`,
        name: `${spec.label} ${n + 1}`,
        template: key,
        men: Math.round(spec.men * preset.fill),
        equipment,
        organisation: 100 * preset.fill,
        morale: ARMY_TUNING.restingMorale,
        experience: 0.1,
        stateId,
        createdDate: date,
      }, divisions.length));
      for (const [item, need] of Object.entries(spec.equipment)) stockpile[item] = round2(num(stockpile[item]) + need * 0.1);
      // Deux mois de fournitures d'avance (7.2).
      stockpile.fournitures = round2(num(stockpile.fournitures) + (SUPPLY_TUNING.suppliesPerMonth[spec.kind] ?? 0) * 2);
    }
  }
  return normalizeArmy({ stockpile, manpower: { available: preset.manpower, growthPerMonth: preset.growthPerMonth }, divisions });
};

// Les armées de toutes les nations suivies, si elles n'en ont pas encore.
// `capitals` : { polity: { state } } (runtime/worldmap/capitals.js), facultatif.
export const enableHoiArmies = (hoi, { capitals = {}, date = "" } = {}) => {
  if (!isObject(hoi)) return hoi;
  const armies = { ...(isObject(hoi.armies) ? hoi.armies : {}) };
  for (const polity of Object.keys(isObject(hoi.nations) ? hoi.nations : {})) {
    if (armies[polity]) continue;
    armies[polity] = seedArmy(polity, { series: hoi.series ?? "1936", stateId: clean(capitals?.[polity]?.state), date: date || clean(hoi.lastDate) });
  }
  return { ...hoi, armies };
};

// Le résumé d'une armée pour les prompts et les panneaux (7.5, 7.6).
export const summarizeArmy = (input, templates = templatesFor("1936")) => {
  const army = normalizeArmy(input);
  const byTemplate = {};
  for (const division of army.divisions) {
    const entry = (byTemplate[division.template] ??= { count: 0, strength: 0 });
    entry.count += 1;
    entry.strength += divisionStrength(division, templates[division.template]).overall;
  }
  for (const entry of Object.values(byTemplate)) entry.strength = round2(entry.strength / entry.count);
  return { divisions: army.divisions.length, byTemplate, manpower: army.manpower.available, stockpile: army.stockpile };
};
