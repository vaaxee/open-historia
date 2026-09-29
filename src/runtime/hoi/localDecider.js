// Couche HOI4 — le décideur local des pays IA (phase 7.9).
//
// Run tests: node --test src/runtime/hoi/localDecider.test.js
// Import-free à part les modules purs de la couche : le décideur (Jev, jev.js)
// est passé en paramètre, un faux dans les tests.
//
// Le moteur construit les options LÉGALES d'un pays IA — tenir, attaquer ou
// percer, et vers quel axe ; où envoyer ses divisions libres ; ses escadres et
// ses flottes ; ce qu'il recrute — en questions à choix. Le décideur juge chaque
// option ; le moteur applique la meilleure. Sans décideur, ou s'il ne répond
// pas, les règles du moteur (défense par défaut, frontsTurn.js) restent seules.
//
// Chaque pays a sa fiche, tenue par le moteur, EN TÊTE du prompt pour que le
// serveur la garde en cache d'une question à l'autre : son programme (fixé par
// la grande IA, economyOps « programme »), ses 5 à 10 dernières décisions et
// leurs résultats, ses alliances et ses rancunes. L'état du tour vient ensuite.
//
// Budget : au plus 20 décisions par tour, les plus importantes d'abord (les pays
// en guerre qui attaquent ou sont attaqués, puis les autres pays en guerre, puis
// le recrutement des pays en paix).
//
// Forme de world.hoi.jevMemory :
//   { [polity]: { programme, decisions: [{ date, question, choice, result }] } }

import { templatesFor } from "./armies.js";
import { frontLine, frontOptions, normalizeFronts } from "./fronts.js";
import { normalizeAirMissions } from "./air.js";
import { enemyDominates, normalizeNavalMissions } from "./naval.js";
import { availableFocuses, normalizeFocusState } from "./focus.js";

export const LOCAL_DECIDER_TUNING = Object.freeze({
  maxDecisionsPerTurn: 20,
  memoryDecisions: 10,
  sheetDecisions: 6,
  maxOptions: 6,
  // Un tour ne passe pas plus de tant à décider (le reste suit les règles).
  turnBudgetMs: 120000,
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const armyKeyOf = (armies, polity) => Object.keys(armies ?? {}).find((name) => key(name) === key(polity)) ?? "";

const POSTURE_WORDS = { hold: "Hold the line", attack: "Attack", breakthrough: "Break through" };

// Les options d'une question, chacune avec les ordres qu'elle donne :
// { text, orders: [{ kind: "front" | "air" | "naval" | "recruit", op }] }.
// `context` : { armies, fronts, templates, map, seas, seaControl, airMissions,
// navalMissions, enemiesOf(p), atWar(a, b) }.
export const decisionQuestions = (polity, context) => {
  const armies = context.armies ?? {};
  const owner = armyKeyOf(armies, polity);
  if (!owner) return [];
  const templates = context.templates ?? templatesFor("1936");
  const map = context.map;
  const army = armies[owner];
  const enemies = list(context.enemiesOf?.(owner));
  const fronts = normalizeFronts(context.fronts).filter((front) => key(front.owner) === key(owner));
  const nameOf = (id) => clean(map?.nameOf?.(id)) || id;
  const defenders = new Map();
  for (const [name, entry] of Object.entries(armies)) {
    if (!enemies.some((enemy) => key(enemy) === key(name))) continue;
    for (const division of list(entry?.divisions)) if (templates[division.template]?.kind === "land") defenders.set(division.stateId, (defenders.get(division.stateId) ?? 0) + 1);
  }
  const questions = [];
  const legal = frontOptions(owner, { ...context, armies, fronts: context.fronts, templates, enemiesOf: () => enemies });

  // 1. Chaque front : la posture, et l'axe (les deux états ennemis de la ligne
  // les moins défendus).
  for (const front of fronts) {
    const line = map ? frontLine(front, map) : { enemy: [] };
    const axes = [...line.enemy].sort((a, b) => (defenders.get(a) ?? 0) - (defenders.get(b) ?? 0) || a.localeCompare(b)).slice(0, 2);
    const options = [{ text: `${POSTURE_WORDS.hold} against ${front.enemy}`, orders: [{ kind: "front", op: { op: "posture", polity: owner, frontId: front.id, posture: "hold" } }] }];
    for (const posture of ["attack", "breakthrough"]) {
      if (!legal.some((op) => op.op === "posture" && op.frontId === front.id && op.posture === posture) && front.posture !== posture) continue;
      for (const axis of axes) {
        options.push({
          text: `${POSTURE_WORDS[posture]} toward ${nameOf(axis)} (${defenders.get(axis) ?? 0} enemy divisions there)`,
          orders: [{ kind: "front", op: { op: "posture", polity: owner, frontId: front.id, posture, axis } }],
        });
      }
    }
    if (options.length > 1) {
      questions.push({
        id: `front-${front.id}`,
        kind: "front",
        importance: 3,
        question: `What should ${owner} do on its front against ${front.enemy}? It has ${front.divisionIds.length} divisions there, now ordered to ${front.posture}.`,
        options: options.slice(0, LOCAL_DECIDER_TUNING.maxOptions),
      });
    }
  }

  // 2. Les divisions libres : vers quel front, ou en réserve.
  const assigns = legal.filter((op) => op.op === "assign");
  if (assigns.length) {
    const free = assigns[0].count;
    questions.push({
      id: "reserve",
      kind: "front",
      importance: 2,
      question: `${owner} has ${free} free divisions in reserve. Where should they go?`,
      options: [
        { text: "Keep them in reserve", orders: [] },
        ...assigns.map((op) => {
          const front = fronts.find((entry) => entry.id === op.frontId);
          return { text: `Send ${op.count} to the front against ${front?.enemy ?? "the enemy"}`, orders: [{ kind: "front", op }] };
        }),
      ].slice(0, LOCAL_DECIDER_TUNING.maxOptions),
    });
  }

  // 3. L'aviation et la marine libres.
  const busyAir = new Set(normalizeAirMissions(context.airMissions).flatMap((mission) => mission.wingIds));
  const busySea = new Set(normalizeNavalMissions(context.navalMissions).flatMap((mission) => mission.fleetIds));
  const freeOf = (template) => list(army?.divisions).filter((division) => division.template === template && !busyAir.has(division.id) && !busySea.has(division.id)).length;
  const fighters = freeOf("chasse"); const bombers = freeOf("bombardement"); const fleets = freeOf("flotte");
  const airSea = [];
  for (const front of fronts) {
    if (fighters) airSea.push({ text: `Send ${fighters} fighter wings over the front against ${front.enemy}`, orders: [{ kind: "air", op: { op: "assign", polity: owner, frontId: front.id, mission: "superiority", count: fighters } }] });
    if (bombers) airSea.push({ text: `Send ${bombers} bomber wings to support the front against ${front.enemy}`, orders: [{ kind: "air", op: { op: "assign", polity: owner, frontId: front.id, mission: "support", count: bombers } }] });
  }
  if (fleets && context.seas?.zones && map) {
    const isEnemy = (id) => enemies.some((enemy) => key(enemy) === key(map.controllerOf(id)));
    const isOwn = (id) => key(map.controllerOf(id)) === key(owner);
    const contact = Object.entries(context.seas.zones)
      .map(([zoneId, zone]) => ({ zoneId, enemy: list(zone.coastalStates).filter(isEnemy), own: list(zone.coastalStates).filter(isOwn) }))
      .filter((zone) => zone.enemy.length && zone.own.length)
      .sort((a, b) => b.enemy.length - a.enemy.length || a.zoneId.localeCompare(b.zoneId))
      .slice(0, 2);
    for (const zone of contact) {
      const off = nameOf(zone.enemy[0]);
      airSea.push({ text: `Blockade the enemy coast off ${off} with ${fleets} fleets`, orders: [{ kind: "naval", op: { op: "assign", polity: owner, zoneId: zone.zoneId, mission: "blockade", count: fleets } }] });
      airSea.push({ text: `Escort our convoys off ${nameOf(zone.own[0])} with ${fleets} fleets`, orders: [{ kind: "naval", op: { op: "assign", polity: owner, zoneId: zone.zoneId, mission: "escort", count: fleets } }] });
      const coast = zone.enemy.filter((id) => !enemyDominates(context.seaControl, zone.zoneId, owner, context.atWar ?? (() => false)))
        .sort((a, b) => (defenders.get(a) ?? 0) - (defenders.get(b) ?? 0))[0];
      if (coast && (defenders.get(coast) ?? 0) <= 1) {
        airSea.push({
          text: `Land 3 divisions at ${nameOf(coast)}, with the fleet in support`,
          orders: [
            { kind: "naval", op: { op: "assign", polity: owner, zoneId: zone.zoneId, mission: "support", count: fleets } },
            { kind: "naval", op: { op: "land", polity: owner, stateId: coast, count: 3 } },
          ],
        });
      }
    }
  }
  if (airSea.length) {
    questions.push({
      id: "air-sea",
      kind: "air-sea",
      importance: 2,
      question: `What should ${owner}'s free air force (${fighters} fighter, ${bombers} bomber wings) and navy (${fleets} fleets) do?`,
      options: [{ text: "Keep them at home", orders: [] }, ...airSea].slice(0, LOCAL_DECIDER_TUNING.maxOptions),
    });
  }

  // 3 bis. Phase 8 : le prochain focus national, s'il n'en a pas en cours.
  if (context.focus !== undefined) {
    const state = normalizeFocusState(context.focus?.[owner]);
    const options = state.current ? [] : availableFocuses(owner, state, context.politics?.[owner] ?? null).slice(0, LOCAL_DECIDER_TUNING.maxOptions);
    if (options.length > 1) {
      questions.push({
        id: "focus",
        kind: "focus",
        importance: 1,
        question: `Which national focus should ${owner} pursue next?`,
        options: options.map((focus) => ({ text: focus.name.en, orders: [{ kind: "focus", op: { polity: owner, focusId: focus.id } }] })),
      });
    }
  }

  // 4. Le recrutement, dans ce que la réserve permet.
  const stock = army?.stockpile ?? {};
  const affordable = Object.entries(templates).filter(([, spec]) => Object.entries(spec.equipment).every(([item, need]) => Number(stock[item] ?? 0) >= need)
    && Number(army?.manpower?.available ?? 0) >= spec.men).map(([template]) => template);
  if (affordable.length) {
    questions.push({
      id: "recruit",
      kind: "recruit",
      importance: enemies.length ? 2 : 1,
      question: `${owner} can raise new units from its stockpile. What should it recruit this turn?`,
      options: [
        { text: "Recruit nothing and keep the stockpile", orders: [] },
        ...affordable.map((template) => ({ text: `Raise one ${templates[template].label}`, orders: [{ kind: "recruit", op: { op: "recruit", polity: owner, template, count: 1 } }] })),
      ].slice(0, LOCAL_DECIDER_TUNING.maxOptions),
    });
  }
  return questions;
};

// La fiche d'un pays : la tête stable (programme, alliances, rancunes, dernières
// décisions), puis l'état du tour. `memory` : world.hoi.jevMemory[polity].
export const decisionSheet = (polity, { memory = {}, allies = [], grudges = [], date = "", army = null, fronts = [], templates = templatesFor("1936") } = {}) => {
  const head = [
    `You are ${polity}.`,
    `Programme: ${clean(memory.programme) || "defend the country and its interests"}.`,
    // Phase 8 : ce que son régime et ses focus disent de lui (focus.js programmeFor).
    ...(clean(memory.policy) ? [`Policy: ${clean(memory.policy)}.`] : []),
    `Allies: ${allies.length ? allies.join(", ") : "none"}.`,
    `Grudges: ${grudges.length ? grudges.join(", ") : "none"}.`,
    "Recent decisions:",
    ...(list(memory.decisions).slice(-LOCAL_DECIDER_TUNING.sheetDecisions).map((entry) => `- ${entry.date}: ${entry.choice}${entry.result ? ` (${entry.result})` : ""}`)),
  ];
  if (!list(memory.decisions).length) head.push("- none yet");
  const counts = {};
  for (const division of list(army?.divisions)) counts[division.template] = (counts[division.template] ?? 0) + 1;
  const forces = Object.entries(counts).map(([template, count]) => `${count} ${templates[template]?.label ?? template}`).join(", ") || "none";
  const body = [
    "",
    `Date: ${date}.`,
    `Forces: ${forces}; manpower ${Math.round(Number(army?.manpower?.available ?? 0)).toLocaleString("en-US")}.`,
    ...normalizeFronts(fronts).filter((front) => key(front.owner) === key(polity)).map((front) => `Front against ${front.enemy}: ${front.posture}, ${front.divisionIds.length} divisions.`),
  ];
  return [...head, ...body].join("\n");
};

// Qui compte d'abord : un pays en guerre dont un front attaque ou a combattu au
// dernier tour, puis un pays en guerre, puis les autres.
export const countryPriority = (polity, { fronts = [], enemies = [], battles = [] } = {}) => {
  if (!enemies.length) return 1;
  const active = normalizeFronts(fronts).some((front) => (key(front.owner) === key(polity) || key(front.enemy) === key(polity)) && front.posture !== "hold")
    || list(battles).some((battle) => key(battle.attacker) === key(polity) || key(battle.defender) === key(polity));
  return active ? 3 : 2;
};

// Les décisions d'un tour. `decide(polity, { sheet, question, options })` →
// promesse de { best, scores, probs, ms } (jev.js createJevClient().score, ou
// un faux). Renvoie { orders, decisions, ms, stopped } ; une erreur du décideur
// arrête le tour (les règles prennent le reste) sans rien perdre de ce qui est
// déjà décidé.
export const runLocalDecisions = async (world, { decide, map, seas = null, date = "", player = "", enemiesOf = () => [], alliesOf = () => [], atWar = () => false, now = () => Date.now(), budget = LOCAL_DECIDER_TUNING.maxDecisionsPerTurn } = {}) => {
  const hoi = world?.hoi ?? {};
  const templates = templatesFor(hoi.series);
  const started = now();
  const countries = Object.keys(hoi.armies ?? {}).filter((polity) => !player || key(polity) !== key(player));
  const context = {
    armies: hoi.armies, fronts: hoi.fronts, templates, map, seas, seaControl: hoi.seaControl,
    airMissions: hoi.airMissions, navalMissions: hoi.navalMissions, enemiesOf, atWar, date,
    // Phase 8 : les focus et la politique, si la partie en a.
    ...(hoi.focus || hoi.politics ? { focus: hoi.focus ?? {}, politics: hoi.politics ?? {} } : {}),
  };
  // Toutes les questions, rangées : priorité du pays, puis importance de la question.
  const queue = [];
  for (const polity of countries) {
    const enemies = list(enemiesOf(polity));
    const priority = countryPriority(polity, { fronts: hoi.fronts, enemies, battles: hoi.lastBattles });
    for (const question of decisionQuestions(polity, context)) queue.push({ polity, priority, question });
  }
  queue.sort((a, b) => b.priority - a.priority || b.question.importance - a.question.importance || a.polity.localeCompare(b.polity));
  // Les questions d'un même pays à la suite : sa fiche reste dans le cache.
  const order = [];
  for (const entry of queue.slice(0, budget)) order.push(entry);
  order.sort((a, b) => b.priority - a.priority || a.polity.localeCompare(b.polity) || b.question.importance - a.question.importance);
  const sheets = new Map();
  const orders = [];
  const decisions = [];
  let stopped = "";
  for (const { polity, question } of order) {
    if (now() - started > LOCAL_DECIDER_TUNING.turnBudgetMs) { stopped = "time budget"; break; }
    if (!sheets.has(polity)) {
      const enemies = list(enemiesOf(polity));
      sheets.set(polity, decisionSheet(polity, {
        memory: hoi.jevMemory?.[polity], allies: list(alliesOf(polity)).filter((name) => key(name) !== key(polity)), grudges: enemies,
        date, army: hoi.armies[polity], fronts: hoi.fronts, templates,
      }));
    }
    let verdict;
    try {
      verdict = await decide(polity, { sheet: sheets.get(polity), question: question.question, options: question.options.map((option) => option.text) });
    } catch (error) {
      stopped = clean(error?.message) || "the decider failed";
      break;
    }
    const best = Number.isInteger(verdict?.best) && question.options[verdict.best] ? verdict.best : 0;
    const choice = question.options[best];
    orders.push(...choice.orders);
    decisions.push({ polity, date, questionId: question.id, question: question.question, choice: choice.text, scores: list(verdict?.scores), ms: Number(verdict?.ms) || 0 });
  }
  return { orders, decisions, ms: now() - started, stopped, asked: order.length, queued: queue.length };
};

// La mémoire après le tour : les décisions prises (10 au plus par pays), leur
// résultat (les batailles de ce pays pendant le tour), et le programme que la
// grande IA a fixé (economyOps « programme »).
// `policies` (phase 8) : { [pays]: phrase }, le programme tiré du régime et des focus.
export const updateDecisionMemory = (memory = {}, { decisions = [], battles = [], programmes = [], policies = {}, date = "" } = {}) => {
  const out = { ...memory };
  const outcomeFor = (polity) => {
    const mine = list(battles).filter((battle) => key(battle.attacker) === key(polity) || key(battle.defender) === key(polity));
    if (!mine.length) return "no battle";
    const taken = mine.filter((battle) => key(battle.attacker) === key(polity) && battle.result === "captured").length;
    const lost = mine.filter((battle) => key(battle.defender) === key(polity) && battle.result === "captured").length;
    const repelled = mine.filter((battle) => key(battle.attacker) === key(polity) && battle.result === "repelled").length;
    return [taken ? `took ${taken} state(s)` : "", lost ? `lost ${lost} state(s)` : "", repelled ? `${repelled} attack(s) repelled` : ""].filter(Boolean).join(", ") || "fighting without result";
  };
  // Les décisions de ce tour, puis toutes celles encore sans résultat reçoivent
  // celui du tour qui vient de se jouer.
  for (const decision of list(decisions)) {
    const entry = out[decision.polity] ?? { programme: "", decisions: [] };
    out[decision.polity] = {
      ...entry,
      decisions: [...list(entry.decisions), { date: decision.date || date, question: decision.questionId, choice: decision.choice, result: "" }].slice(-LOCAL_DECIDER_TUNING.memoryDecisions),
    };
  }
  for (const [polity, entry] of Object.entries(out)) {
    const pending = list(entry?.decisions).some((decision) => !decision.result);
    if (!pending) continue;
    const result = outcomeFor(polity);
    out[polity] = { ...entry, decisions: list(entry.decisions).map((decision) => (decision.result ? decision : { ...decision, result })) };
  }
  for (const programme of list(programmes)) {
    const polity = clean(programme.polity);
    if (!polity || !clean(programme.label)) continue;
    out[polity] = { ...(out[polity] ?? { decisions: [] }), programme: clean(programme.label).slice(0, 240) };
  }
  for (const [polity, policy] of Object.entries(policies ?? {})) {
    if (!clean(policy)) continue;
    out[polity] = { ...(out[polity] ?? { programme: "", decisions: [] }), policy: clean(policy).slice(0, 240) };
  }
  return out;
};
