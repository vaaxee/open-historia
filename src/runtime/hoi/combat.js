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
import { frontLine, normalizeFronts } from "./fronts.js";

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
  // Aviation : chaque escadre de chasse de plus que l'adversaire (supériorité
  // aérienne), chaque escadre de bombardement (appui au sol), plafonnées.
  airPerWing: 0.03,
  airCap: 0.15,
  bomberPerWing: 0.02,
  bomberCap: 0.1,
  dice: 0.15,
  // Rapport de forces à partir duquel l'état est pris, en dessous duquel l'attaque est repoussée.
  captureRatio: 1.3,
  repelRatio: 0.8,
  // Un état sans division ennemie a sa garnison (une demi-division de défense).
  garrison: 0.6,
  // Pertes par semaine de combat, à rapport de forces égal ; organisation perdue.
  lossPerWeek: 0.03,
  organisationLoss: Object.freeze({ attacker: 25, defender: 20 }),
  moraleWin: 5,
  moraleLoss: 10,
  experiencePerBattle: 0.02,
  surrenderAfterDays: 30,
  // Prises au plus par front et par semaine (comme warRules : OCCUPATIONS_PER_WEEK).
  capturesPerWeek: 3,
});

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round2 = (value) => Math.round(value * 100) / 100;
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

const airWings = (army, templates, template) => list(army?.divisions).filter((division) => division.template === template
  && templates?.[template]?.kind === "air" && divisionStrength(division, templates[template]).overall > 0.3).length;

// Les batailles d'un saut. `context` :
//   world    : { hoi: { armies, fronts, series } }
//   map      : { states, controllerOf, neighboursOf, riverBetween, infoOf, nameOf, latOf }
//   atWar(a, b), sideOf(polity) → noms du camp (le pays et ses alliés en guerre)
//   date, days, seed, fortAt(stateId) → niveau de fort
// Renvoie { battles, captures, outcome, surrenders }.
export const resolveCombat = ({ world, map, atWar = () => false, sideOf = (polity) => [polity], date = "", days = 7, seed = "", fortAt = () => 0 } = {}) => {
  const T = COMBAT_TUNING;
  const hoi = world?.hoi ?? {};
  const templates = templatesFor(hoi.series);
  const armies = hoi.armies ?? {};
  const fronts = normalizeFronts(hoi.fronts);
  const outcome = {};
  const battles = [];
  const captures = [];
  const surrenders = [];
  const taken = new Set();
  const byId = new Map();
  for (const [owner, army] of Object.entries(armies)) for (const division of list(army?.divisions)) byId.set(division.id, { owner, division });
  const change = (id) => (outcome[id] ??= { loss: 0, organisation: 0, morale: 0, experience: 0, stateId: "", removed: false });
  const weeks = Math.max(1 / 7, num(days, 7) / 7);
  const allowance = Math.max(1, Math.ceil(T.capturesPerWeek * weeks));

  for (const front of fronts) {
    if (front.posture === "hold" || !atWar(front.owner, front.enemy)) continue;
    const line = frontLine(front, map);
    const attackers = front.divisionIds.map((id) => byId.get(id)).filter((entry) => entry && key(entry.owner) === key(front.owner)
      && T.stats[entry.division.template] && !outcome[entry.division.id]?.removed);
    if (!attackers.length || !line.enemy.length) continue;
    const ordered = [...new Set([...(front.axis && line.enemy.includes(front.axis) ? [front.axis] : []), ...line.enemy])].filter((id) => !taken.has(id));
    const targets = front.posture === "breakthrough" ? ordered.slice(0, 1) : ordered.slice(0, Math.min(allowance, attackers.length));
    const enemySide = new Set(sideOf(front.enemy).map(key));
    const ownAir = { fighters: airWings(armies[front.owner], templates, "chasse"), bombers: airWings(armies[front.owner], templates, "bombardement") };
    const enemyAir = { fighters: airWings(armies[front.enemy], templates, "chasse") };
    const air = 1 + clamp((ownAir.fighters - enemyAir.fighters) * T.airPerWing, -T.airCap, T.airCap) + Math.min(T.bomberCap, ownAir.bombers * T.bomberPerWing);
    let captured = 0;

    targets.forEach((target, index) => {
      const assigned = attackers.filter((_, i) => i % targets.length === index);
      if (!assigned.length) return;
      const info = map.infoOf(target) ?? {};
      const terrain = clean(info.terrain) || "plaine";
      const defenders = [...byId.values()].filter(({ owner, division }) => division.stateId === target && enemySide.has(key(owner))
        && T.stats[division.template] && !outcome[division.id]?.removed);
      const origins = line.pairs.filter(([, to]) => to === target).map(([from]) => from);
      const river = origins.length > 0 && origins.every((from) => map.riverBetween?.(from, target));
      const fort = Math.max(0, Math.round(num(fortAt(target))));
      const weather = weatherAt(date, map.latOf?.(target));
      const defenderHolds = fronts.some((other) => key(other.owner) === key(front.enemy) && key(other.enemy) === key(front.owner) && other.posture === "hold");

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
        air: round2(air),
        dice: round2(1 + T.dice * (2 * seededRandom(`${seed}|${date}|${front.id}|${target}`) - 1)),
      };
      const attack = round2(attackBase * factors.posture * factors.weather * factors.air * factors.dice);
      const defense = round2(defenseBase * factors.terrain * factors.river * factors.fort * factors.hold);
      const ratio = defense > 0 ? round2(attack / defense) : 99;
      const canTake = captured < allowance;
      const result = ratio >= T.captureRatio && canTake ? "captured" : ratio >= T.repelRatio ? "stalemate" : "repelled";

      const base = T.lossPerWeek * weeks;
      const attackerLoss = round2(clamp(base * clamp(1 / Math.max(ratio, 0.01), 0.3, 3) * (front.posture === "breakthrough" ? T.breakthroughLosses : 1), 0, 0.6));
      const defenderLoss = round2(clamp(base * clamp(ratio, 0.3, 3) * (result === "captured" ? 1.5 : 1), 0, 0.8));
      const menBefore = { attacker: 0, defender: 0 };
      for (const { division } of assigned) {
        menBefore.attacker += num(division.men);
        const entry = change(division.id);
        entry.loss = round2(1 - (1 - entry.loss) * (1 - attackerLoss));
        entry.organisation -= T.organisationLoss.attacker;
        entry.morale += result === "captured" ? T.moraleWin : result === "repelled" ? -T.moraleLoss : 0;
        entry.experience += T.experiencePerBattle;
        if (result === "captured") entry.stateId = target;
      }
      // Les défenseurs d'un état pris se replient sur un voisin de leur camp qui
      // n'est pas pris ce tour-ci ; sans repli possible, ils se rendent.
      const retreat = result === "captured"
        ? list(map.neighboursOf(target)).find((id) => enemySide.has(key(map.controllerOf(id))) && !taken.has(id) && id !== target) ?? ""
        : "";
      for (const { division } of defenders) {
        menBefore.defender += num(division.men);
        const entry = change(division.id);
        entry.loss = round2(1 - (1 - entry.loss) * (1 - defenderLoss));
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
        captured += 1;
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
          defender: Math.round(menBefore.defender * defenderLoss),
        },
        result,
        retreatTo: retreat ? (map.nameOf?.(retreat) ?? retreat) : "",
        surrendered: result === "captured" && !retreat ? defenders.length : 0,
      });
    });
  }

  // Les poches : une division encerclée depuis assez longtemps et sans organisation se rend.
  for (const { owner, division } of byId.values()) {
    if (outcome[division.id]?.removed) continue;
    if (num(division.encircledDays) >= T.surrenderAfterDays && num(division.organisation) <= 0) {
      change(division.id).removed = true;
      surrenders.push({ id: division.id, owner, stateId: division.stateId, reason: "encircled" });
    }
  }
  return { battles, captures, outcome, surrenders };
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
  const place = battle.stateName;
  const title = fr ? `Bataille de ${place} : ${words[battle.result]}` : `Battle of ${place}: ${words[battle.result]}`;
  const sides = fr
    ? `${attacker} attaque ${place}, tenue par ${defender}${battle.garrison ? " (garnison seule)" : ""}.`
    : `${attacker} attacks ${place}, held by ${defender}${battle.garrison ? " (garrison only)" : ""}.`;
  const losses = fr
    ? `Pertes : ${battle.losses.attacker.toLocaleString("fr-FR")} hommes pour ${attacker}, ${battle.losses.defender.toLocaleString("fr-FR")} pour ${defender}.`
    : `Losses: ${battle.losses.attacker.toLocaleString("en-US")} men for ${attacker}, ${battle.losses.defender.toLocaleString("en-US")} for ${defender}.`;
  const end = battle.result === "captured"
    ? (fr
      ? `${place} passe sous le contrôle de ${attacker}${battle.retreatTo ? ` ; les défenseurs se replient sur ${battle.retreatTo}` : battle.surrendered ? ` ; ${battle.surrendered} division(s) sans issue se rendent` : ""}.`
      : `${place} falls under ${attacker}'s control${battle.retreatTo ? `; the defenders fall back on ${battle.retreatTo}` : battle.surrendered ? `; ${battle.surrendered} trapped division(s) surrender` : ""}.`)
    : battle.result === "repelled"
      ? (fr ? `L'attaque est repoussée ; ${place} reste à ${defender}.` : `The attack is thrown back; ${place} stays with ${defender}.`)
      : (fr ? `Les combats restent indécis ; ${place} reste à ${defender}.` : `The fighting is indecisive; ${place} stays with ${defender}.`);
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
    f.air !== 1 ? `air ×${f.air}` : "",
    `dice ×${f.dice}`,
  ].filter(Boolean).join(", ");
  return `- ${battle.date} ${battle.stateName}: ${battle.attacker} (${battle.posture}) against ${battle.defender}${battle.garrison ? " (garrison)" : ""} — power ${battle.power.attack} vs ${battle.power.defense} (${mods}) → ${battle.result.toUpperCase()}; losses ${battle.losses.attacker} / ${battle.losses.defender} men${battle.retreatTo ? `; defenders retreat to ${battle.retreatTo}` : ""}${battle.surrendered ? `; ${battle.surrendered} division(s) surrender` : ""}.`;
}).join("\n");
