// Couche HOI4 — la politique intérieure (phase 8).
//
// Run tests: node --test src/runtime/hoi/politics.test.js
// Import-free.
//
// Chaque pays suivi a, dans world.hoi.politics[pays] :
//   ideology   : l'idéologie au pouvoir (democratic, communist, fascist, authoritarian)
//   parties    : la popularité des quatre courants, en % (somme 100)
//   stability  : 0 → 100
//   warSupport : 0 → 100 (le soutien à la guerre)
//   elections  : { everyYears, next } pour une démocratie, sinon null
//   opinions   : { [pays]: -100 → 100 }, ce que les focus et la guerre en font
//   lastChange : { date, kind: "election" | "coup", from, to } le dernier changement
//
// Ces chiffres pèsent sur le jeu, par le moteur seul :
//   - la production : un modificateur « politique » de −20 % à +20 % selon la stabilité ;
//   - le recrutement : la main-d'œuvre croît de 50 % à 150 % selon le soutien à la guerre ;
//   - le droit de déclarer une guerre : sous 25 de soutien, un pays ne déclare pas
//     de guerre d'agression (il peut toujours se défendre) ;
//   - les élections (démocraties, à leur date) et les coups d'État (stabilité sous
//     25 et un courant hors du pouvoir au-dessus de 40 %), déclenchés par le moteur
//     selon ces seuils ; l'IA les raconte.

export const IDEOLOGIES = Object.freeze(["democratic", "communist", "fascist", "authoritarian"]);
export const POLITICS_TUNING = Object.freeze({
  // Par mois : la guerre use la stabilité, le soutien baisse chez l'agresseur et
  // monte chez l'attaqué ; en paix, les deux reviennent lentement vers 50.
  warStabilityPerMonth: -1.5,
  aggressorWarSupportPerMonth: -2,
  defenderWarSupportPerMonth: 3,
  peaceDriftPerMonth: 0.5,
  // Le courant au pouvoir gagne un peu, chaque mois, en paix et stable.
  rulingDriftPerMonth: 0.3,
  productionPerStability: 0.004, // (stabilité − 50) × 0,004 → ±20 %
  minWarSupportToDeclare: 25,
  coupStability: 25,
  coupPopularity: 40,
  electionEveryYears: 4,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(value * 10) / 10;
const list = (value) => (Array.isArray(value) ? value : []);

export const IDEOLOGY_WORDS = Object.freeze({
  en: { democratic: "democratic", communist: "communist", fascist: "fascist", authoritarian: "authoritarian" },
  fr: { democratic: "démocrate", communist: "communiste", fascist: "fasciste", authoritarian: "autoritaire" },
});

// Les partis, ramenés à 100.
const normalizeParties = (value, ideology) => {
  const raw = Object.fromEntries(IDEOLOGIES.map((name) => [name, Math.max(0, num(value?.[name]))]));
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (!total) return Object.fromEntries(IDEOLOGIES.map((name) => [name, name === ideology ? 55 : 15]));
  return Object.fromEntries(IDEOLOGIES.map((name) => [name, round1((raw[name] / total) * 100)]));
};

export const normalizePolitics = (value) => {
  const source = isObject(value) ? value : {};
  const ideology = IDEOLOGIES.includes(source.ideology) ? source.ideology : "authoritarian";
  return {
    ideology,
    parties: normalizeParties(source.parties, ideology),
    stability: round1(clamp(num(source.stability, 50), 0, 100)),
    warSupport: round1(clamp(num(source.warSupport, 30), 0, 100)),
    elections: ideology === "democratic"
      ? { everyYears: Math.max(1, Math.round(num(source.elections?.everyYears, POLITICS_TUNING.electionEveryYears))), next: clean(source.elections?.next) }
      : null,
    opinions: Object.fromEntries(Object.entries(isObject(source.opinions) ? source.opinions : {})
      .map(([name, opinion]) => [name, round1(clamp(num(opinion), -100, 100))]).filter(([name]) => clean(name))),
    lastChange: isObject(source.lastChange) ? source.lastChange : null,
  };
};

// 1936 : les huit puissances et la Pologne (le reste se lit dans leur fiche).
export const POLITICS_PRESETS_1936 = Object.freeze({
  Germany: { ideology: "fascist", parties: { fascist: 80, authoritarian: 10, democratic: 5, communist: 5 }, stability: 75, warSupport: 35 },
  "Soviet Union": { ideology: "communist", parties: { communist: 90, authoritarian: 5, democratic: 3, fascist: 2 }, stability: 60, warSupport: 40 },
  France: { ideology: "democratic", parties: { democratic: 60, communist: 20, fascist: 8, authoritarian: 12 }, stability: 45, warSupport: 15, elections: { everyYears: 4, next: "1936-04-26" } },
  "United Kingdom": { ideology: "democratic", parties: { democratic: 85, communist: 5, fascist: 4, authoritarian: 6 }, stability: 70, warSupport: 20, elections: { everyYears: 5, next: "1940-11-01" } },
  "United States": { ideology: "democratic", parties: { democratic: 88, communist: 3, fascist: 4, authoritarian: 5 }, stability: 65, warSupport: 10, elections: { everyYears: 4, next: "1936-11-03" } },
  Italy: { ideology: "fascist", parties: { fascist: 70, authoritarian: 15, democratic: 10, communist: 5 }, stability: 65, warSupport: 60 },
  "Imperialist Japan": { ideology: "authoritarian", parties: { authoritarian: 55, fascist: 30, democratic: 12, communist: 3 }, stability: 60, warSupport: 55 },
  "Kuomintang China": { ideology: "authoritarian", parties: { authoritarian: 55, communist: 25, democratic: 12, fascist: 8 }, stability: 35, warSupport: 45 },
  Poland: { ideology: "authoritarian", parties: { authoritarian: 55, democratic: 30, fascist: 8, communist: 7 }, stability: 55, warSupport: 40 },
});

// L'idéologie d'un pays sans préréglage, lue dans sa fiche (« government »).
export const ideologyFromGovernment = (text) => {
  const t = clean(text).toLowerCase();
  if (/commun|soviet|marxis|socialist republic|people's republic/.test(t)) return "communist";
  if (/fascis|nazi|national socialis|falang/.test(t)) return "fascist";
  if (/democra|republic|parliament|liberal/.test(t) && !/dictator|junta|military|authoritarian|one-party/.test(t)) return "democratic";
  return "authoritarian";
};

// Les chiffres de départ d'un pays : son préréglage, sinon sa fiche.
export const seedPolitics = (polity, { government = "", date = "" } = {}) => {
  const preset = POLITICS_PRESETS_1936[polity];
  if (preset) return normalizePolitics(preset);
  const ideology = ideologyFromGovernment(government);
  const parties = Object.fromEntries(IDEOLOGIES.map((name) => [name, name === ideology ? 60 : ideology === "democratic" && name === "authoritarian" ? 20 : 20 / 3]));
  const year = Number(clean(date).slice(0, 4)) || 1936;
  return normalizePolitics({
    ideology, parties, stability: 50, warSupport: 25,
    ...(ideology === "democratic" ? { elections: { everyYears: 4, next: `${year + 2}-06-01` } } : {}),
  });
};

// La couche politique d'une partie : chaque nation suivie reçoit ses chiffres.
export const enableHoiPolitics = (hoi, { countryStats = {}, date = "" } = {}) => {
  if (!isObject(hoi)) return hoi;
  const politics = { ...(isObject(hoi.politics) ? hoi.politics : {}) };
  for (const polity of Object.keys(isObject(hoi.nations) ? hoi.nations : {})) {
    if (politics[polity]) continue;
    politics[polity] = seedPolitics(polity, { government: countryStats?.[polity]?.government ?? "", date });
  }
  return { ...hoi, politics };
};

// Un pays peut-il déclarer une guerre ? Toujours pour se défendre ; pour attaquer,
// il lui faut assez de soutien. Renvoie { ok, reason }.
export const canDeclareWar = (hoi, polity, { defending = false } = {}) => {
  const name = Object.keys(hoi?.politics ?? {}).find((entry) => key(entry) === key(polity));
  if (!name || defending) return { ok: true, reason: "" };
  const support = normalizePolitics(hoi.politics[name]).warSupport;
  if (support >= POLITICS_TUNING.minWarSupportToDeclare) return { ok: true, reason: "" };
  return { ok: false, reason: `${name}'s war support is ${support}%, under the ${POLITICS_TUNING.minWarSupportToDeclare}% needed to declare a war of aggression` };
};

// Le modificateur de production que donne la stabilité (−0,2 → +0,2).
export const stabilityProductionModifier = (stability) => Math.round((num(stability, 50) - 50) * POLITICS_TUNING.productionPerStability * 100) / 100;
// Le facteur de croissance de la main-d'œuvre que donne le soutien (0,5 → 1,5).
export const warSupportManpowerFactor = (warSupport) => Math.round((0.5 + clamp(num(warSupport, 50), 0, 100) / 100) * 100) / 100;

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const addYears = (date, years) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

// Le courant le plus populaire hors du pouvoir.
const strongestOpposition = (politics) => IDEOLOGIES.filter((name) => name !== politics.ideology)
  .sort((a, b) => politics.parties[b] - politics.parties[a])[0];

// Les parts d'un courant qui monte, prises aux autres au prorata.
export const shiftPopularity = (parties, ideology, delta) => {
  if (!IDEOLOGIES.includes(ideology) || !delta) return parties;
  const target = clamp(num(parties[ideology]) + delta, 0, 100);
  const others = IDEOLOGIES.filter((name) => name !== ideology);
  const rest = others.reduce((sum, name) => sum + num(parties[name]), 0);
  const out = { [ideology]: round1(target) };
  for (const name of others) out[name] = round1(rest > 0 ? (num(parties[name]) / rest) * (100 - target) : (100 - target) / others.length);
  return out;
};

// Un saut de politique pour un pays, du `fromDate` au `toDate` : dérive, guerre,
// élections et coups. `war` : { atWar, aggressor }. Renvoie { politics, changes }
// où chaque changement est { date, kind, from, to, ... } pour les événements.
export const advancePolitics = (input, { fromDate, toDate, war = { atWar: false, aggressor: false } } = {}) => {
  const T = POLITICS_TUNING;
  let politics = normalizePolitics(input);
  const changes = [];
  const days = Math.max(0, (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
  if (!(days > 0)) return { politics, changes };
  const months = days / 30;
  let { stability, warSupport } = politics;
  if (war.atWar) {
    stability += T.warStabilityPerMonth * months;
    warSupport += (war.aggressor ? T.aggressorWarSupportPerMonth : T.defenderWarSupportPerMonth) * months;
  } else {
    stability += Math.sign(50 - stability) * Math.min(Math.abs(50 - stability), T.peaceDriftPerMonth * months);
    warSupport += Math.sign(30 - warSupport) * Math.min(Math.abs(30 - warSupport), T.peaceDriftPerMonth * months);
  }
  let parties = politics.parties;
  if (!war.atWar && stability >= 50) parties = shiftPopularity(parties, politics.ideology, T.rulingDriftPerMonth * months);
  politics = { ...politics, parties, stability: round1(clamp(stability, 0, 100)), warSupport: round1(clamp(warSupport, 0, 100)) };

  // Les élections tombées dans la période : le courant le plus populaire gouverne ;
  // une démocratie que gagne un autre courant change de régime.
  if (politics.elections?.next && politics.elections.next > fromDate && politics.elections.next <= toDate) {
    const date = politics.elections.next;
    const winner = IDEOLOGIES.slice().sort((a, b) => politics.parties[b] - politics.parties[a])[0];
    const next = addYears(date, politics.elections.everyYears);
    changes.push({ date, kind: "election", from: politics.ideology, to: winner, share: politics.parties[winner] });
    politics = {
      ...politics,
      ideology: winner,
      stability: round1(clamp(politics.stability + (winner === politics.ideology ? 5 : -5), 0, 100)),
      elections: winner === "democratic" ? { ...politics.elections, next } : null,
      lastChange: { date, kind: "election", from: politics.ideology, to: winner },
    };
  }
  // Le coup d'État : un régime instable, un courant d'opposition fort.
  const opposition = strongestOpposition(politics);
  if (politics.stability < T.coupStability && politics.parties[opposition] > T.coupPopularity) {
    const date = addDays(fromDate, Math.max(1, Math.round(days / 2)));
    changes.push({ date, kind: "coup", from: politics.ideology, to: opposition, share: politics.parties[opposition] });
    politics = {
      ...politics,
      ideology: opposition,
      stability: 45,
      parties: shiftPopularity(politics.parties, opposition, 15),
      elections: opposition === "democratic" ? { everyYears: T.electionEveryYears, next: addYears(date, T.electionEveryYears) } : null,
      lastChange: { date, kind: "coup", from: politics.ideology, to: opposition },
    };
  }
  return { politics: normalizePolitics(politics), changes };
};

// Les effets de la politique sur l'économie et l'armée, posés par le moteur à
// chaque tour : le modificateur « politique » (remplacé), et la croissance de la
// main-d'œuvre. `hoi` : world.hoi. Pur.
export const applyPoliticsEffects = (hoi) => {
  if (!isObject(hoi?.politics)) return hoi;
  const nations = { ...(hoi.nations ?? {}) };
  const armies = { ...(hoi.armies ?? {}) };
  for (const [polity, raw] of Object.entries(hoi.politics)) {
    const politics = normalizePolitics(raw);
    const nationKey = Object.keys(nations).find((name) => key(name) === key(polity));
    if (nationKey) {
      const nation = nations[nationKey] ?? {};
      const value = stabilityProductionModifier(politics.stability);
      const modifiers = list(nation.modifiers).filter((modifier) => modifier?.id !== "politics-stability");
      nations[nationKey] = { ...nation, modifiers: value ? [...modifiers, { id: "politics-stability", target: "production", value, untilDate: null, label: "stability" }] : modifiers };
    }
    const armyKey = Object.keys(armies).find((name) => key(name) === key(polity));
    if (armyKey) {
      const army = armies[armyKey] ?? {};
      armies[armyKey] = { ...army, manpower: { ...(army.manpower ?? {}), growthFactor: warSupportManpowerFactor(politics.warSupport) } };
    }
  }
  return { ...hoi, nations, ...(hoi.armies ? { armies } : {}) };
};

// L'événement du moteur pour une élection ou un coup, dans la langue du tour ;
// l'IA le raconte, sans en changer l'issue.
export const politicsEvent = (polity, change, { language = "en", nameOf = (name) => name, the = null } = {}) => {
  const fr = language === "fr";
  const words = IDEOLOGY_WORDS[fr ? "fr" : "en"];
  const who = the ? the(polity) : nameOf(polity);
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  if (change.kind === "election") {
    const same = change.from === change.to;
    return {
      date: change.date,
      title: fr ? `Élections : ${nameOf(polity)}` : `Elections in ${polity}`,
      description: fr
        ? `${cap(who)} vote. Le courant ${words[change.to]} arrive en tête avec ${change.share} % ; ${same ? "il reste au pouvoir" : `il remplace le gouvernement ${words[change.from]}`}.`
        : `${polity} goes to the polls. The ${words[change.to]} movement wins with ${change.share}%; ${same ? "it stays in power" : `it replaces the ${words[change.from]} government`}.`,
      kind: "political", importance: same ? "normal" : "major", notable: !same, source: "engine", impacts: {},
    };
  }
  return {
    date: change.date,
    title: fr ? `Coup d'État : ${nameOf(polity)}` : `Coup in ${polity}`,
    description: fr
      ? `Le gouvernement ${words[change.from]} ${fr && the ? the(polity, "de") : `de ${nameOf(polity)}`} est renversé : le courant ${words[change.to]} (${change.share} %) prend le pouvoir par la force.`
      : `${polity}'s ${words[change.from]} government is overthrown: the ${words[change.to]} movement (${change.share}%) seizes power.`,
    kind: "political", importance: "major", notable: true, source: "engine", impacts: {},
  };
};
