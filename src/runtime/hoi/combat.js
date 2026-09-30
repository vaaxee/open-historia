// Couche HOI4 — le combat (phase 7.4).
//
// Run tests: node --test src/runtime/hoi/combat.test.js
// Import-free, à part les modules purs de la couche.
//
// Le moteur résout les batailles, état par état, une fois par saut ; l'IA ne
// fait que raconter le résultat. Pour chaque front qui attaque ou perce :
//   - cibles : l'axe d'abord (percer : l'axe seul), puis les autres états ennemis
//     au contact, dans la limite de ce qu'un front prend par période (warRules) ;
//   - forces : les divisions du front réparties sur les cibles, contre les
//     divisions ennemies qui s'y tiennent (une garnison sinon) ;
//   - puissance d'une division : son type (attaque / défense), ce qu'elle a de
//     son gabarit, son organisation, son moral, son expérience, son ravitaillement ;
//   - modificateurs : terrain (et les blindés qui s'y enlisent), fleuve à
//     franchir, forts, posture, météo (hiver, boue), aviation ;
//   - hasard : ±15 %, tiré d'une graine (partie, date, front, état) : la même
//     situation donne toujours la même bataille.
// Le résultat : l'état pris, tenu, ou l'attaque repoussée ; les pertes en hommes,
// en équipement et en organisation des deux côtés ; les défenseurs d'un état pris
// se replient sur un état voisin de leur camp, ou se rendent s'ils n'en ont pas.
// Une division encerclée depuis 30 jours et sans organisation se rend.
//
// resolveCombat() ne modifie rien : il renvoie les batailles (les fiches que le
// joueur et l'IA lisent), les prises (qui passent par les règles de guerre comme
// toute occupation) et un résultat par division, qu'applyCombatOutcome() porte
// sur les armées du moment.

import { divisionStrength, templatesFor } from "./armies.js";
import { airLosses, frontAir } from "./air.js";
import { frontLine, normalizeFronts } from "./fronts.js";
import { placeNameFor } from "../worldmap/placeNames.js";
import { capitalizeFirst, frenchWithArticle } from "../polityExonyms.js";

export const COMBAT_TUNING = Object.freeze({
  // Attaque et défense de base par gabarit terrestre.
  stats: Object.freeze({
    infanterie: Object.freeze({ attack: 1, defense: 1.3 }),
    blindes: Object.freeze({ attack: 3, defense: 1.5, armour: true }),
    artillerie: Object.freeze({ attack: 2, defense: 1.2 }),
  }),
  // Multiplicateur de la défense selon le terrain de l'état attaqué.
  terrainDefense: Object.freeze({ plaine: 1, desert: 1.1, foret: 1.25, colline: 1.3, marais: 1.4, jungle: 1.4, montagne: 1.6, urbain: 1.5 }),
  // Les blindés s'y enlisent (multiplicateur de leur attaque).
  armourTerrain: Object.freeze({ foret: 0.6, marais: 0.5, jungle: 0.5, montagne: 0.5, urbain: 0.7 }),
  riverDefense: 1.3,
  fortPerLevel: 0.15,
  holdDefense: 1.1,
  breakthroughAttack: 1.25,
  breakthroughLosses: 1.5,
  // Météo : hiver (déc.-fév.) au-delà de 45° de latitude, boue (mars-avril, oct.-nov.) au-delà de 40°.
  winterAttack: 0.8,
  mudAttack: 0.85,
  // L'aviation (supériorité, appui, usure du ravitaillement) : air.js (7.8).
  // Un débarquement : l'attaque qui passe la mer (naval.js : landingAttack), et
  // les pertes d'une tête de pont repoussée, multipliées.
  landingAttack: 0.5,
  landingRepelLosses: 2,
  // Un convoi de débarquement intercepté (la mer passée à l'ennemi) : part perdue.
  interceptedLoss: 0.1,
  dice: 0.15,
  // Test G : le dé propre aux pertes de chaque camp (± 25 %).
  lossDice: 0.25,
  // Rapport de forces à partir duquel l'état est pris, en dessous duquel l'attaque est repoussée.
  captureRatio: 1.3,
  repelRatio: 0.8,
  // Un état sans division ennemie a sa garnison (une demi-division de défense),
  // de tant d'hommes.
  garrison: 0.6,
  garrisonMen: 3000,
  // Chaque bond d'une percée réduit l'attaque de tant (au plus de moitié).
  chainFatigue: 0.1,
  // Pertes par semaine de combat, à rapport de forces égal ; organisation perdue.
  lossPerWeek: 0.03,
  organisationLoss: Object.freeze({ attacker: 25, defender: 20 }),
  moraleWin: 5,
  moraleLoss: 10,
  experiencePerBattle: 0.02,
  surrenderAfterDays: 30,
  // Prises au plus par front et par semaine (comme warRules : OCCUPATIONS_PER_WEEK).
  capturesPerWeek: 3,
  // Test G avec Jev : 34 divisions en percée ont pris Rovno, Białołęka et
  // Varsovie en une semaine de janvier (300 km, marais, hiver). L'avance d'un
  // front se compte maintenant en points par semaine, selon sa posture, réduits
  // par la saison ; une prise coûte selon le terrain de l'état pris, et le front
  // prend tant qu'il lui reste des points (au moins une prise s'il en a). Une
  // prise est toujours un état au contact de la ligne de départ du tour.
  advancePerWeek: Object.freeze({ attack: 2, breakthrough: 3 }),
  advanceWeather: Object.freeze({ winter: 0.5, mud: 0.6 }),
  captureCost: Object.freeze({ plaine: 1, desert: 1, foret: 1.5, colline: 1.5, marais: 1.5, jungle: 1.5, urbain: 1.5, montagne: 2 }),
});

// Les points d'avance d'un front pour un saut : posture, durée, saison.
export const advanceAllowance = ({ posture = "attack", days = 7, weather = "" } = {}) => {
  const T = COMBAT_TUNING;
  const weeks = Math.max(1 / 7, num(days, 7) / 7);
  return round2((T.advancePerWeek[posture] ?? T.advancePerWeek.attack) * weeks * (T.advanceWeather[weather] ?? 1));
};

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10000) / 10000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Un tirage reproductible : la même graine, le même nombre dans [0, 1).
export const seededRandom = (seed) => {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i += 1) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let a = (h ^= h >>> 16) >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// La météo d'une date et d'une latitude : "winter", "mud" ou "".
export const weatherAt = (date, lat) => {
  const month = Number(clean(date).slice(5, 7));
  const north = Math.abs(num(lat));
  const southern = num(lat) < 0;
  const m = southern ? ((month + 5) % 12) + 1 : month;
  if (north >= 45 && [12, 1, 2].includes(m)) return "winter";
  if (north >= 40 && [3, 4, 10, 11].includes(m)) return "mud";
  return "";
};

// La puissance d'une division, en attaque ou en défense, avant les modificateurs du lieu.
export const divisionPower = (division, templates, role = "attack", terrain = "") => {
  const T = COMBAT_TUNING;
  const stats = T.stats[division.template];
  if (!stats) return 0;
  const strength = divisionStrength(division, templates?.[division.template]).overall;
  let base = role === "attack" ? stats.attack : stats.defense;
  if (role === "attack" && stats.armour && T.armourTerrain[terrain]) base *= T.armourTerrain[terrain];
  const organisation = 0.3 + 0.7 * clamp(num(division.organisation, 100), 0, 100) / 100;
  const morale = 0.8 + 0.4 * clamp(num(division.morale, 70), 0, 100) / 100;
  const experience = 1 + 0.5 * clamp(num(division.experience), 0, 1);
  const supply = 0.4 + 0.6 * clamp(num(division.supply, 1), 0, 1);
  return round2(base * strength * organisation * morale * experience * supply);
};

// Les batailles d'un saut. `context` :
//   world    : { hoi: { armies, fronts, series, airMissions, landings } }
//   map      : { states, controllerOf, neighboursOf, riverBetween, infoOf, nameOf, latOf }
//   atWar(a, b), sideOf(polity) → noms du camp (le pays et ses alliés en guerre)
//   date, days, seed, fortAt(stateId) → niveau de fort
//   seaSupport(zoneId, owner) → appui naval d'un débarquement (naval.js), 0 → 0,4
//   landingBlocked(landing) → l'ennemi domine désormais la zone du débarquement
//   capitalOf(polity) → id de l'état capitale (une capitale défendue ne tombe
//   pas à son premier combat)
// Renvoie { battles, captures, outcome, surrenders, intercepted }.
export const resolveCombat = ({ world, map, atWar = () => false, sideOf = (polity) => [polity], date = "", days = 7, seed = "", fortAt = () => 0, seaSupport = () => 0, landingBlocked = () => false, capitalOf = () => "" } = {}) => {
  const T = COMBAT_TUNING;
  const hoi = world?.hoi ?? {};
  const templates = templatesFor(hoi.series);
  const armies = hoi.armies ?? {};
  const fronts = normalizeFronts(hoi.fronts);
  const outcome = {};
  const battles = [];
  const captures = [];
  const surrenders = [];
  const intercepted = [];
  const taken = new Set();
  const byId = new Map();
  for (const [owner, army] of Object.entries(armies)) for (const division of list(army?.divisions)) byId.set(division.id, { owner, division });
  const change = (id) => (outcome[id] ??= { loss: 0, organisation: 0, morale: 0, experience: 0, stateId: "", removed: false });
  const weeks = Math.max(1 / 7, num(days, 7) / 7);
  // Une escadre ne perd ses avions qu'une fois par saut, au pire de ses combats.
  const airLoss = (id, loss) => { const entry = change(id); entry.loss = Math.max(entry.loss, loss); };

  // Les états déjà disputés aux tours précédents (une capitale défendue ne tombe
  // pas au premier).
  const foughtBefore = new Set(list(hoi.battleLog).map((battle) => clean(battle?.stateId)));

  // Les batailles d'un front (ou d'un débarquement : `landing`, avec son appui naval).
  // `points` : l'avance du front pour ce saut (advanceAllowance).
  const engage = (front, { landing = null, points = 1 } = {}) => {
    const enemySide = new Set(sideOf(front.enemy).map(key));
    const state = { captured: 0, spent: 0, points: landing ? 1 : points };
    const canAdvance = () => (landing ? state.captured < 1 : state.spent < state.points);
    // Où se tient une division maintenant : après un repli de ce tour, là où elle s'est repliée.
    const defendersIn = (target) => [...byId.values()].filter(({ owner, division }) => (outcome[division.id]?.stateId || division.stateId) === target
      && enemySide.has(key(owner)) && T.stats[division.template] && !outcome[division.id]?.removed);

    // Une bataille : `origins` sont les états d'où l'on attaque (le fleuve se
    // juge entre eux et la cible), `step` le rang d'un bond de percée.
    const fight = (target, assigned, origins, step = 0) => {
      const info = map.infoOf(target) ?? {};
      const terrain = clean(info.terrain) || "plaine";
      const defenders = defendersIn(target);
      const river = origins.length > 0 && origins.every((from) => map.riverBetween?.(from, target));
      const fort = Math.max(0, Math.round(num(fortAt(target))));
      const weather = weatherAt(date, map.latOf?.(target));
      const defenderHolds = fronts.some((other) => key(other.owner) === key(front.enemy) && key(other.enemy) === key(front.owner) && other.posture === "hold");
      // Le ciel (air.js) : la supériorité aérienne au-dessus de ce front et de cet
      // état, l'appui des bombardiers, et le ravitaillement ennemi qu'ils usent.
      const air = frontAir({ front, stateId: target, armies, airMissions: hoi.airMissions, fronts, templates, sideOf });
      for (const [id, loss] of Object.entries(airLosses(air, days).losses)) airLoss(id, loss);
      const naval = landing ? round2(num(seaSupport(landing.zoneId, front.owner))) : 0;

      const attackBase = assigned.reduce((sum, { division }) => sum + divisionPower(division, templates, "attack", terrain), 0);
      const defenseBase = defenders.length
        ? defenders.reduce((sum, { division }) => sum + divisionPower(division, templates, "defense", terrain), 0)
        : T.garrison;
      const factors = {
        terrain: T.terrainDefense[terrain] ?? 1,
        river: river ? T.riverDefense : 1,
        fort: 1 + T.fortPerLevel * fort,
        hold: defenderHolds ? T.holdDefense : 1,
        posture: front.posture === "breakthrough" ? T.breakthroughAttack : 1,
        weather: weather === "winter" ? T.winterAttack : weather === "mud" ? T.mudAttack : 1,
        air: air.factor,
        superiority: air.superiority,
        ...(air.attrition > 0 ? { bombing: round2(1 - air.attrition) } : {}),
        // Le débarquement : l'attaque qui passe la mer, relevée par l'appui naval.
        ...(landing ? { landing: round2(T.landingAttack * (1 + naval)) } : {}),
        dice: round2(1 + T.dice * (2 * seededRandom(`${seed}|${date}|${front.id}|${target}`) - 1)),
        // Chaque bond d'une percée essouffle un peu l'attaque.
        ...(step > 0 ? { fatigue: round2(Math.max(0.5, 1 - T.chainFatigue * step)) } : {}),
      };
      const attack = round2(attackBase * factors.posture * factors.weather * factors.air * factors.dice * (factors.fatigue ?? 1) * (factors.landing ?? 1));
      const defense = round2(defenseBase * factors.terrain * factors.river * factors.fort * factors.hold * (factors.bombing ?? 1));
      const ratio = defense > 0 ? round2(attack / defense) : 99;
      const canTake = canAdvance();
      // Une capitale défendue tient au moins un tour : elle ne tombe pas à son premier combat.
      const capitalHolds = defenders.length > 0 && target === clean(capitalOf(front.enemy)) && !foughtBefore.has(target);
      // Une tête de pont qui ne prend pas est rembarquée : pas de combat indécis.
      const result = ratio >= T.captureRatio && canTake && !capitalHolds ? "captured" : ratio >= T.repelRatio && !landing ? "stalemate" : "repelled";
      if (capitalHolds) factors.capitalHolds = true;

      // Les pertes suivent le rapport de forces : l'attaquant d'une résistance
      // écrasée ne perd presque rien (test G : 3 000 hommes contre une garnison
      // qui, elle, ne perdait personne), le défenseur écrasé perd l'essentiel.
      // Test G (Rovno puis Varsovie) : l'attaquant perdait exactement 3 320 hommes
      // à chaque fois. Le taux était arrondi à 0,01 : 0,007 et 0,012 donnaient le
      // même 1 % de 332 000 hommes. Il est gardé fin (4 décimales) ; le terrain de
      // l'état attaqué pèse aussi sur les pertes de l'attaquant, et chaque camp a
      // son propre dé (± 25 %).
      const base = T.lossPerWeek * weeks;
      const lossDice = {
        attacker: round2(1 + T.lossDice * (2 * seededRandom(`${seed}|${date}|${front.id}|${target}|attacker-losses`) - 1)),
        defender: round2(1 + T.lossDice * (2 * seededRandom(`${seed}|${date}|${front.id}|${target}|defender-losses`) - 1)),
      };
      const attackerLoss = round4(clamp(base * clamp(1 / Math.max(ratio, 0.01), 0.05, 3) * factors.terrain * lossDice.attacker
        * (front.posture === "breakthrough" ? T.breakthroughLosses : 1) * (landing && result !== "captured" ? T.landingRepelLosses : 1), 0, 0.6));
      const defenderLoss = round4(clamp(base * clamp(ratio, 0.3, 6) * lossDice.defender * (result === "captured" ? 1.5 : 1), 0, 0.8));
      factors.lossDice = lossDice;
      const menBefore = { attacker: 0, defender: 0 };
      for (const { division } of assigned) {
        menBefore.attacker += num(division.men);
        const entry = change(division.id);
        entry.loss = round4(1 - (1 - entry.loss) * (1 - attackerLoss));
        entry.organisation -= T.organisationLoss.attacker;
        entry.morale += result === "captured" ? T.moraleWin : result === "repelled" ? -T.moraleLoss : 0;
        entry.experience += T.experiencePerBattle;
        if (result === "captured") entry.stateId = target;
        // Débarquées ou rembarquées, les divisions redeviennent libres.
        if (landing) entry.frontId = "";
      }
      // Les défenseurs d'un état pris se replient sur un voisin de leur camp qui
      // n'est pas pris ce tour-ci ; sans repli possible, ils se rendent.
      const retreat = result === "captured"
        ? list(map.neighboursOf(target)).find((id) => enemySide.has(key(map.controllerOf(id))) && !taken.has(id) && id !== target) ?? ""
        : "";
      for (const { division } of defenders) {
        menBefore.defender += num(division.men);
        const entry = change(division.id);
        entry.loss = round4(1 - (1 - entry.loss) * (1 - defenderLoss));
        entry.organisation -= T.organisationLoss.defender;
        entry.morale += result === "captured" ? -T.moraleLoss : result === "repelled" ? T.moraleWin : 0;
        entry.experience += T.experiencePerBattle;
        if (result === "captured") {
          if (retreat) entry.stateId = retreat;
          else { entry.removed = true; surrenders.push({ id: division.id, owner: byId.get(division.id)?.owner, stateId: target, reason: "no retreat" }); }
        }
      }
      if (result === "captured") {
        taken.add(target);
        state.captured += 1;
        state.spent += T.captureCost[terrain] ?? 1;
        captures.push({ stateId: target, stateName: map.nameOf?.(target) ?? target, from: map.controllerOf(target), to: front.owner, frontId: front.id });
      }
      const count = (entries) => {
        const out = {};
        for (const { division } of entries) out[division.template] = (out[division.template] ?? 0) + 1;
        return out;
      };
      battles.push({
        id: `battle-${date}-${front.id}-${target}`,
        date,
        frontId: front.id,
        stateId: target,
        stateName: map.nameOf?.(target) ?? target,
        terrain,
        weather,
        attacker: front.owner,
        defender: front.enemy,
        posture: front.posture,
        attackers: count(assigned),
        defenders: count(defenders),
        garrison: defenders.length === 0,
        factors,
        power: { attack, defense, ratio },
        losses: {
          attacker: Math.round(menBefore.attacker * attackerLoss),
          // Une garnison prise est perdue tout entière (tuée ou captive).
          defender: defenders.length
            ? Math.round(menBefore.defender * defenderLoss)
            : result === "captured" ? T.garrisonMen : Math.round(T.garrisonMen * defenderLoss),
        },
        result,
        retreatTo: retreat ? (map.nameOf?.(retreat) ?? retreat) : "",
        surrendered: result === "captured" && !retreat ? defenders.length : 0,
        garrisonTaken: result === "captured" && defenders.length === 0 ? T.garrisonMen : 0,
        // Le ciel de la bataille : supériorité (0 → 1 pour l'attaquant), escadres.
        air: {
          superiority: air.superiority,
          fighters: { attacker: air.own.fighterIds.length, defender: air.enemy.fighterIds.length },
          bombers: air.own.bomberIds.length,
        },
        ...(landing ? { landing: true, zoneId: landing.zoneId, naval } : {}),
      });
      return result;
    };
    return { fight, defendersIn, enemySide, state };
  };

  for (const front of fronts) {
    if (front.posture === "hold" || !atWar(front.owner, front.enemy)) continue;
    const line = frontLine(front, map);
    const attackers = front.divisionIds.map((id) => byId.get(id)).filter((entry) => entry && key(entry.owner) === key(front.owner)
      && T.stats[entry.division.template] && !outcome[entry.division.id]?.removed);
    if (!attackers.length || !line.enemy.length) continue;
    const ordered = [...new Set([...(front.axis && line.enemy.includes(front.axis) ? [front.axis] : []), ...line.enemy])].filter((id) => !taken.has(id));
    // L'avance du front pour ce saut, selon sa posture et la saison sur l'axe.
    const points = advanceAllowance({ posture: front.posture, days, weather: weatherAt(date, map.latOf?.(ordered[0])) });
    const targets = front.posture === "breakthrough" ? ordered.slice(0, 1) : ordered.slice(0, Math.min(Math.max(1, Math.ceil(points)), attackers.length));
    const { fight, defendersIn, state } = engage(front, { points });
    const originsOf = (target) => line.pairs.filter(([, to]) => to === target).map(([from]) => from);

    if (front.posture === "breakthrough") {
      // La percée : l'axe d'abord, puis, tant qu'il reste de l'avance, l'état
      // voisin sur la même ligne de départ (elle élargit la brèche, sans
      // s'enfoncer au-delà de ce qui touchait la ligne en début de tour), le
      // moins défendu, avec toutes les divisions du front.
      let target = ordered[0];
      let step = 0;
      while (target && state.spent < state.points) {
        if (fight(target, attackers, originsOf(target), step) !== "captured") break;
        step += 1;
        const nextTo = new Set(list(map.neighboursOf(target)));
        target = line.enemy
          .filter((id) => !taken.has(id))
          .sort((a, b) => Number(!nextTo.has(a)) - Number(!nextTo.has(b)) || defendersIn(a).length - defendersIn(b).length || a.localeCompare(b))[0];
      }
    } else {
      targets.forEach((target, index) => {
        const assigned = attackers.filter((_, i) => i % targets.length === index);
        if (assigned.length) fight(target, assigned, line.pairs.filter(([, to]) => to === target).map(([from]) => from));
      });
    }
  }

  // Les débarquements préparés au tour d'avant (naval.js) : la bataille de la tête
  // de pont, sans fleuve, l'attaque réduite par la mer et relevée par l'appui naval.
  for (const landing of list(hoi.landings)) {
    const target = clean(landing?.stateId);
    const enemy = clean(map.controllerOf(target));
    const attackers = list(landing?.divisionIds).map((id) => byId.get(id)).filter((entry) => entry && key(entry.owner) === key(landing.owner)
      && T.stats[entry.division.template] && !outcome[entry.division.id]?.removed);
    if (!attackers.length) continue;
    if (!enemy || !atWar(landing.owner, enemy) || taken.has(target)) {
      // La côte n'est plus ennemie (ou déjà prise) : les divisions débarquent sans combat, ou restent.
      for (const { division } of attackers) change(division.id).frontId = "";
      continue;
    }
    if (landingBlocked(landing)) {
      // L'ennemi a pris la mer entre-temps : le convoi est intercepté et rentre, avec des pertes.
      for (const { division } of attackers) {
        const entry = change(division.id);
        entry.frontId = "";
        entry.loss = round2(1 - (1 - entry.loss) * (1 - T.interceptedLoss));
        entry.organisation -= T.organisationLoss.defender;
      }
      intercepted.push({ id: clean(landing.id), owner: landing.owner, enemy, stateId: target, stateName: map.nameOf?.(target) ?? target, zoneId: landing.zoneId, divisions: attackers.length });
      continue;
    }
    const { fight } = engage({ id: clean(landing.id), owner: landing.owner, enemy, posture: "attack" }, { landing });
    fight(target, attackers, []);
  }

  // Les poches : une division encerclée depuis assez longtemps et sans organisation se rend.
  for (const { owner, division } of byId.values()) {
    if (outcome[division.id]?.removed) continue;
    if (num(division.encircledDays) >= T.surrenderAfterDays && num(division.organisation) <= 0) {
      change(division.id).removed = true;
      surrenders.push({ id: division.id, owner, stateId: division.stateId, reason: "encircled" });
    }
  }
  // Les avions perdus ce tour, par pays (Statistiques, fiche).
  const aircraft = {};
  for (const [id, entry] of Object.entries(outcome)) {
    const found = byId.get(id);
    if (!found || templates[found.division.template]?.kind !== "air" || !(entry.loss > 0)) continue;
    const lost = (aircraft[found.owner] ??= {});
    for (const [item, count] of Object.entries(found.division.equipment ?? {})) lost[item] = round2((lost[item] ?? 0) + num(count) * entry.loss);
  }
  return { battles, captures, outcome, surrenders, intercepted, aircraft };
};

// Deux résultats par division (la mer, puis la terre et l'air) en un seul.
export const mergeOutcomes = (...outcomes) => {
  const out = {};
  for (const outcome of outcomes) {
    for (const [id, entry] of Object.entries(outcome ?? {})) {
      const prev = out[id];
      if (!prev) { out[id] = { ...entry }; continue; }
      out[id] = {
        ...prev,
        loss: round2(1 - (1 - num(prev.loss)) * (1 - num(entry.loss))),
        organisation: num(prev.organisation) + num(entry.organisation),
        morale: num(prev.morale) + num(entry.morale),
        experience: num(prev.experience) + num(entry.experience),
        stateId: entry.stateId || prev.stateId,
        removed: Boolean(prev.removed || entry.removed),
        ...(entry.frontId !== undefined ? { frontId: entry.frontId } : {}),
      };
    }
  }
  return out;
};

// Porte le résultat du combat sur les armées du moment (celles du tour, qui ont
// pu recruter entre-temps) : pertes, organisation, moral, expérience,
// déplacements et redditions, division par division.
export const applyCombatOutcome = (armies, outcome) => {
  if (!armies || !outcome || !Object.keys(outcome).length) return armies;
  const out = {};
  for (const [owner, army] of Object.entries(armies)) {
    const divisions = [];
    for (const division of list(army?.divisions)) {
      const entry = outcome[division.id];
      if (!entry) { divisions.push(division); continue; }
      if (entry.removed) continue;
      const keep = 1 - clamp(entry.loss, 0, 1);
      divisions.push({
        ...division,
        men: Math.round(num(division.men) * keep),
        equipment: Object.fromEntries(Object.entries(division.equipment ?? {}).map(([item, count]) => [item, round2(num(count) * keep)])),
        organisation: round2(clamp(num(division.organisation, 100) + entry.organisation, 0, 100)),
        morale: round2(clamp(num(division.morale, 70) + entry.morale, 0, 100)),
        experience: round2(clamp(num(division.experience) + entry.experience, 0, 1)),
        ...(entry.stateId ? { stateId: entry.stateId } : {}),
        ...(entry.frontId !== undefined ? { frontId: entry.frontId } : {}),
      });
    }
    out[owner] = { ...army, divisions };
  }
  return out;
};

const RESULT_WORDS = {
  fr: { captured: "prise", stalemate: "combats indécis", repelled: "attaque repoussée" },
  en: { captured: "captured", stalemate: "indecisive fighting", repelled: "attack repelled" },
};

// L'événement du moteur pour une bataille, dans la langue du tour (fr ou en) :
// titre et récit factuels, que le narrateur peut reprendre sans rien changer
// aux chiffres ; la prise, s'il y en a une, en regionControlOps.
export const battleEvent = (battle, { language = "en", nameOf = (name) => name } = {}) => {
  const fr = language === "fr";
  const words = RESULT_WORDS[fr ? "fr" : "en"];
  const attacker = nameOf(battle.attacker);
  const defender = nameOf(battle.defender);
  // Test G : les articles (« l'Union soviétique attaque Rovno, tenue par la Pologne »).
  const the = (name, form = "") => (fr ? frenchWithArticle(name, form) : name);
  // Les lieux dans la langue du tour (test G : « Warsaw » dans un récit français).
  const place = placeNameFor(battle.stateName, fr ? "fr" : "en");
  const retreatTo = placeNameFor(battle.retreatTo, fr ? "fr" : "en");
  const title = battle.landing
    ? (fr ? `Débarquement à ${place} : ${battle.result === "captured" ? "tête de pont tenue" : "rembarquement"}` : `Landing at ${place}: ${battle.result === "captured" ? "bridgehead held" : "thrown back into the sea"}`)
    : fr ? `Bataille de ${place} : ${words[battle.result]}` : `Battle of ${place}: ${words[battle.result]}`;
  const sides = battle.landing
    ? (fr
      ? `${capitalizeFirst(the(attacker))} débarque à ${place}, tenue par ${the(defender)}${battle.garrison ? " (garnison seule)" : ""}.`
      : `${attacker} lands at ${place}, held by ${defender}${battle.garrison ? " (garrison only)" : ""}.`)
    : fr
      ? `${capitalizeFirst(the(attacker))} attaque ${place}, tenue par ${the(defender)}${battle.garrison ? " (garnison seule)" : ""}.`
      : `${attacker} attacks ${place}, held by ${defender}${battle.garrison ? " (garrison only)" : ""}.`;
  const losses = fr
    ? `Pertes : ${battle.losses.attacker.toLocaleString("fr-FR")} hommes pour ${the(attacker)}, ${battle.losses.defender.toLocaleString("fr-FR")} pour ${the(defender)}.`
    : `Losses: ${battle.losses.attacker.toLocaleString("en-US")} men for ${attacker}, ${battle.losses.defender.toLocaleString("en-US")} for ${defender}.`;
  const garrison = battle.garrisonTaken
    ? (fr ? ` ; la garnison (${battle.garrisonTaken.toLocaleString("fr-FR")} hommes) est tuée ou capturée` : `; its garrison (${battle.garrisonTaken.toLocaleString("en-US")} men) is killed or captured`)
    : "";
  const end = battle.result === "captured"
    ? (fr
      ? `${place} passe sous le contrôle ${the(attacker, "de")}${retreatTo ? ` ; les défenseurs se replient sur ${retreatTo}` : battle.surrendered ? ` ; ${battle.surrendered} division(s) sans issue se rendent` : garrison}.`
      : `${place} falls under ${attacker}'s control${retreatTo ? `; the defenders fall back on ${retreatTo}` : battle.surrendered ? `; ${battle.surrendered} trapped division(s) surrender` : garrison}.`)
    : battle.result === "repelled"
      ? (fr ? `L'attaque est repoussée ; ${place} reste ${the(defender, "à")}.` : `The attack is thrown back; ${place} stays with ${defender}.`)
      : (fr ? `Les combats restent indécis ; ${place} reste ${the(defender, "à")}.` : `The fighting is indecisive; ${place} stays with ${defender}.`);
  return {
    date: battle.date,
    title,
    description: `${sides} ${losses} ${end}`,
    kind: "military",
    importance: battle.result === "captured" ? "major" : "normal",
    notable: battle.result === "captured",
    source: "engine",
    combatants: [battle.attacker, battle.defender],
    battle,
    battleId: battle.id,
    impacts: battle.result === "captured"
      ? { regionControlOps: [{ op: "control", regionId: battle.stateId, regionName: battle.stateName, fromCode: battle.defender, toCode: battle.attacker, note: `engine battle ${battle.id}` }] }
      : {},
  };
};

// Les fiches de bataille pour le prompt du tour : ce qui a été décidé, à raconter.
export const describeBattles = (battles) => list(battles).map((battle) => {
  const f = battle.factors ?? {};
  const mods = [
    `terrain ${battle.terrain} ×${f.terrain}`,
    f.river > 1 ? `river ×${f.river}` : "",
    f.fort > 1 ? `forts ×${f.fort}` : "",
    battle.weather ? `${battle.weather} ×${f.weather}` : "",
    // Un ciel vide des deux côtés (50 %, ×1) ne se dit pas.
    f.superiority !== undefined && (f.air !== 1 || f.superiority !== 0.5) ? `air superiority ${Math.round(f.superiority * 100)}% ×${f.air}` : "",
    f.bombing ? `bombed supply ×${f.bombing}` : "",
    f.landing ? `landing ×${f.landing}` : "",
    `dice ×${f.dice}`,
  ].filter(Boolean).join(", ");
  return `- ${battle.date} ${battle.stateName}: ${battle.attacker} (${battle.posture}) against ${battle.defender}${battle.garrison ? " (garrison)" : ""} — power ${battle.power.attack} vs ${battle.power.defense} (${mods}) → ${battle.result.toUpperCase()}; losses ${battle.losses.attacker} / ${battle.losses.defender} men${battle.retreatTo ? `; defenders retreat to ${battle.retreatTo}` : ""}${battle.surrendered ? `; ${battle.surrendered} division(s) surrender` : ""}.`;
}).join("\n");
