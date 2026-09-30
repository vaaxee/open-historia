// Test G (29 janvier – 5 février 1936) : deux fautes de l'IA dans un même tour.
//
// 1. Une bataille en double : le moteur avait livré « Bataille de Varsovie :
//    combats indécis » ; l'IA a écrit la sienne, « les Soviétiques progressent…
//    gains territoriaux ». Quand le moteur a livré une bataille, l'IA ne raconte
//    pas une seconde version, et n'annonce jamais de gains que la fiche ne donne pas.
// 2. Un anachronisme : le 4 février, « crise après les élections espagnoles de
//    février », qui ont lieu le 16. L'IA ne raconte pas le résultat d'une élection
//    que le moteur n'a pas tenue (phase 8 : c'est lui qui les décide), ni un
//    événement daté après la fin du tour.
// Pur : les noms de pays d'un texte viennent de `mentions(text)`.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const fold = (value) => clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const key = (value) => fold(value).replace(/[^a-z0-9]+/g, "");
const textOf = (event) => `${clean(event?.title)}. ${clean(event?.description)}`;

const BATTLE_WORDS = /\b(batailles?|combats?|offensives?|assauts?|attaqu\w*|siege|battles?|fighting|assaults?|offensive|siege)\b/;
const GAIN_WORDS = /(gains? territoriau\w*|territorial gains?|s'empar\w*|prend\w* le controle|prise de|captur\w*|conqu[ie]\w*|progress\w*|avanc\w* (sur|vers|jusqu)|perc\w* (le front|les lignes)|seiz\w*|takes? (control|the city)|advanc\w* (on|toward|into)|break\w* through)/;

// Les événements de l'IA qui racontent à nouveau une bataille du moteur, ou lui
// ajoutent des gains : { index, battle, reason }. `placeNames(battle)` : les
// noms du lieu (carte, français…).
export const duplicateBattleEvents = (events, battles, { mentions = () => [], placeNames = (battle) => [battle?.stateName] } = {}) => {
  const fought = list(battles).filter((battle) => clean(battle?.attacker) && clean(battle?.defender));
  if (!fought.length) return [];
  const found = [];
  list(events).forEach((event, index) => {
    if (!event || clean(event.source) === "engine" || clean(event.battleId)) return;
    const text = fold(textOf(event));
    const named = new Set(list(mentions(textOf(event))).map(key));
    const combatants = new Set(list(event.combatants).map(key));
    for (const battle of fought) {
      const sides = [battle.attacker, battle.defender].map(key);
      const bothSides = sides.every((side) => named.has(side) || combatants.has(side));
      const place = list(placeNames(battle)).map(fold).filter(Boolean).some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
      if (place && BATTLE_WORDS.test(text)) { found.push({ index, battle, reason: "retells" }); return; }
      if (bothSides && GAIN_WORDS.test(text) && !battle.result?.startsWith?.("captured")) { found.push({ index, battle, reason: "gains" }); return; }
      if (bothSides && combatants.size && BATTLE_WORDS.test(text)) { found.push({ index, battle, reason: "retells" }); return; }
    }
  });
  return found;
};

export const describeDuplicateBattle = ({ battle, reason }, title) => (reason === "gains"
  ? `"${title}" announces gains in the war between ${battle.attacker} and ${battle.defender} that the engine's battle sheet does not give (${battle.stateName}: ${battle.result}). Only the engine's battles move the front: remove that event or tell it without gains.`
  : `"${title}" tells again the battle of ${battle.stateName} (${battle.attacker} against ${battle.defender}), which the engine fought and wrote as its own event (${battle.result}). Do not write a second version of an engine battle: remove that event, or tell only what happens around it.`);

// Le résultat d'une élection.
const ELECTION_RESULT = /(resultats? des elections|apres les elections|victoire electorale|remport\w* (les|des) elections|elections? [^.]{0,60}(remport|gagn|victoire)|election results?|won the elections?|wins? the elections?|after the elections?|electoral victory|elections? [^.]{0,60}\b(won|victory)\b)/;

// Les événements de l'IA qui racontent le résultat d'une élection que le moteur
// n'a pas tenue : { index, polities }. `held` : les élections du moteur
// ({ polity, date }) jusqu'à cette période comprise.
export const electionsNotHeld = (events, held, { mentions = () => [] } = {}) => {
  const found = [];
  list(events).forEach((event, index) => {
    if (!event || clean(event.source) === "engine") return;
    const text = fold(textOf(event));
    if (!ELECTION_RESULT.test(text)) return;
    const date = clean(event.date);
    const named = list(mentions(textOf(event)));
    const ok = named.some((polity) => list(held).some((election) => key(election.polity) === key(polity) && (!date || clean(election.date) <= date)));
    if (!ok) found.push({ index, polities: named });
  });
  return found;
};

const MONTHS = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const FUTURE = /\b(prevu\w*|doit|doivent|devr\w*|aura lieu|auront lieu|a venir|prochain\w*|se tiendr\w*|annonc\w* pour|will|scheduled|planned|upcoming|due to|to be held|expected)\b/;

// Les dates explicites (jour et mois) d'un texte qui tombent après `stopDate`,
// dites au passé : ["1936-02-16", …]. L'année manquante est celle de l'événement.
export const datesAfter = (event, stopDate) => {
  const stop = clean(stopDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stop)) return [];
  const text = fold(textOf(event));
  const year = clean(event?.date).slice(0, 4) || stop.slice(0, 4);
  const found = [];
  const pattern = /\b(?:le |on |the )?(\d{1,2})(?:er)? (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?: (\d{4}))?|\b(january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?/g;
  for (const match of text.matchAll(pattern)) {
    const [day, month, y] = match[2] ? [match[1], MONTHS[match[2]], match[3]] : [match[5], MONTHS[match[4]], match[6]];
    const iso = `${y || year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (iso <= stop) continue;
    const around = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 20);
    if (FUTURE.test(around)) continue;
    found.push(iso);
  }
  return [...new Set(found)];
};
