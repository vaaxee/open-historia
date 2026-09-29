// Phase 7.6 — la fiche d'une bataille du moteur (runtime/hoi/combat.js), en
// lignes à afficher : les camps et leurs forces, les facteurs et leur poids, la
// puissance de chaque côté, le jet de dés, le résultat et les pertes.
// Import-free à part les tables de noms, pour les tests.
//
// Test G : la fiche était mi-anglaise (« breakthrough », « Garrison only »,
// « State captured », « men », « Warsaw ») dans une partie en français. Elle est
// maintenant écrite entièrement dans la langue du joueur, pays et lieux compris,
// et soustraite au traducteur de l'interface.

import { frenchPolityName } from "../../runtime/polityExonyms.js";
import { placeNameFor } from "../../runtime/worldmap/placeNames.js";

const list = (value) => (Array.isArray(value) ? value : []);

const WORDS = {
  en: {
    attacker: "Attacker", attackingForces: "Attacking forces", defender: "Defender", defendingForces: "Defending forces",
    garrisonOnly: "Garrison only", terrain: "Terrain", defence: "defence", attack: "attack", river: "River crossing", forts: "Forts",
    hold: "Holding posture", breakthrough: "Breakthrough", fatigue: "Fatigue", weather: "Weather", air: "Air", dice: "Dice",
    power: "Power", against: "against", ratio: "ratio", result: "Result", losses: "Losses", attackerSide: "attacker",
    defenderSide: "defender", men: "men", fellBack: "Defenders fell back to", surrendered: "Surrendered", divisions: "division(s)",
    garrisonTaken: "Garrison taken", none: "—",
    postures: { hold: "hold", attack: "attack", breakthrough: "breakthrough" },
    weathers: { winter: "winter", mud: "mud" },
    results: { captured: "State captured", stalemate: "Indecisive", repelled: "Attack repelled" },
    terrains: { plaine: "plains", foret: "forest", colline: "hills", montagne: "mountains", marais: "marsh", jungle: "jungle", urbain: "urban", desert: "desert" },
    templates: { infanterie: "infantry", blindes: "armour", artillerie: "artillery", chasse: "fighters", bombardement: "bombers", flotte: "fleet" },
    number: (value) => Number(value || 0).toLocaleString("en-US"),
    polity: (name) => name,
  },
  fr: {
    attacker: "Attaquant", attackingForces: "Forces d'attaque", defender: "Défenseur", defendingForces: "Forces en défense",
    garrisonOnly: "Garnison seule", terrain: "Terrain", defence: "défense", attack: "attaque", river: "Franchissement d'un fleuve", forts: "Forts",
    hold: "Posture défensive", breakthrough: "Percée", fatigue: "Essoufflement", weather: "Météo", air: "Aviation", dice: "Dés",
    power: "Puissance", against: "contre", ratio: "rapport", result: "Résultat", losses: "Pertes", attackerSide: "attaquant",
    defenderSide: "défenseur", men: "hommes", fellBack: "Repli des défenseurs sur", surrendered: "Redditions", divisions: "division(s)",
    garrisonTaken: "Garnison prise", none: "—",
    postures: { hold: "tenir", attack: "attaquer", breakthrough: "percer" },
    weathers: { winter: "hiver", mud: "boue" },
    results: { captured: "État pris", stalemate: "Combats indécis", repelled: "Attaque repoussée" },
    terrains: { plaine: "plaine", foret: "forêt", colline: "collines", montagne: "montagne", marais: "marais", jungle: "jungle", urbain: "ville", desert: "désert" },
    templates: { infanterie: "infanterie", blindes: "blindés", artillerie: "artillerie", chasse: "chasse", bombardement: "bombardement", flotte: "flotte" },
    number: (value) => Number(value || 0).toLocaleString("fr-FR"),
    polity: (name) => frenchPolityName(name),
  },
};

export const sheetWords = (language = "en") => (/^fr\b/i.test(String(language || "")) ? WORDS.fr : WORDS.en);
export const RESULT_LABELS = Object.freeze({ ...WORDS.en.results });

export const battleSheetRows = (battle, { language = "en" } = {}) => {
  if (!battle) return [];
  const w = sheetWords(language);
  const lang = w === WORDS.fr ? "fr" : "en";
  const place = (name) => placeNameFor(name, lang);
  const forces = (counts) => Object.entries(counts ?? {}).map(([template, count]) => `${count} ${w.templates[template] ?? template}`).join(", ") || w.none;
  const f = battle.factors ?? {};
  const factor = (label, value) => (Number.isFinite(value) && value !== 1 ? [{ label, value: `×${value}` }] : []);
  return [
    { label: w.attacker, value: `${w.polity(battle.attacker)} (${w.postures[battle.posture] ?? battle.posture})` },
    { label: w.attackingForces, value: forces(battle.attackers) },
    { label: w.defender, value: w.polity(battle.defender) },
    { label: w.defendingForces, value: battle.garrison ? w.garrisonOnly : forces(battle.defenders) },
    { label: w.terrain, value: `${w.terrains[battle.terrain] ?? battle.terrain} (${w.defence} ×${f.terrain ?? 1})` },
    ...factor(w.river, f.river),
    ...factor(w.forts, f.fort),
    ...factor(w.hold, f.hold),
    ...factor(w.breakthrough, f.posture),
    ...factor(w.fatigue, f.fatigue),
    ...(battle.weather ? [{ label: w.weather, value: `${w.weathers[battle.weather] ?? battle.weather} (${w.attack} ×${f.weather})` }] : []),
    ...factor(w.air, f.air),
    { label: w.dice, value: `×${f.dice ?? 1}` },
    { label: w.power, value: `${battle.power?.attack ?? 0} ${w.against} ${battle.power?.defense ?? 0} (${w.ratio} ${battle.power?.ratio ?? 0})` },
    { label: w.result, value: w.results[battle.result] ?? battle.result },
    { label: w.losses, value: `${w.attackerSide} ${w.number(battle.losses?.attacker)} ${w.men}, ${w.defenderSide} ${w.number(battle.losses?.defender)} ${w.men}` },
    ...(battle.garrisonTaken ? [{ label: w.garrisonTaken, value: `${w.number(battle.garrisonTaken)} ${w.men}` }] : []),
    ...(battle.retreatTo ? [{ label: w.fellBack, value: place(battle.retreatTo) }] : []),
    ...(battle.surrendered ? [{ label: w.surrendered, value: `${battle.surrendered} ${w.divisions}` }] : []),
  ];
};

// Le titre d'une fiche : « Bataille de Rovno, 11 janv. 1936 ».
export const battleSheetTitle = (battle, { language = "en" } = {}) => {
  const fr = /^fr\b/i.test(String(language || ""));
  return fr ? `Bataille de ${placeNameFor(battle?.stateName, "fr")}` : `Battle of ${battle?.stateName ?? ""}`;
};

// La bataille d'un événement, d'après son identifiant, dans le journal du monde.
export const findBattle = (battleLog, battleId) => (battleId ? list(battleLog).find((battle) => battle?.id === battleId) ?? null : null);
