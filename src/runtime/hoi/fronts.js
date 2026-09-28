// Couche HOI4 — les fronts (phase 7.3).
//
// Run tests: node --test src/runtime/hoi/fronts.test.js
// Import-free : il tourne sans node_modules.
//
// Un front oppose un pays à un ennemi avec qui il est en guerre. Le joueur le
// dessine sur la carte (panneau Fronts, 7.7) ; le moteur l'accroche à la
// frontière réelle : les états que le pays tient au contact d'états que l'ennemi
// tient. Un tracé (`sector`) restreint le front à une partie de cette frontière ;
// vide, il la couvre toute. On y affecte des divisions terrestres et on choisit
// une posture :
//   hold          tenir : défense seule
//   attack        attaquer : attaques sur les états ennemis au contact
//   breakthrough  percer : effort concentré sur l'axe (`axis`), pertes plus lourdes
// Les pays IA ont les mêmes outils (frontOps, dans les impacts d'un événement),
// validés par les mêmes règles. Un décideur local (Jev, via llama-server) pourra
// plus tard choisir leurs ordres parmi des options déjà validées : frontOptions()
// les énumère, setFrontDecider() branche le décideur, applyFrontOp() les applique.
//
// Forme de world.hoi.fronts :
// [{ id, owner, enemy, posture, axis, sector: [ids], divisionIds: [ids], createdDate }]

export const FRONT_POSTURES = Object.freeze(["hold", "attack", "breakthrough"]);
export const FRONT_LIMITS = Object.freeze({ maxFrontsPerPolity: 12, maxAssignPerOp: 60 });

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const slug = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const POSTURE_ALIASES = Object.freeze({
  hold: "hold", tenir: "hold", defend: "hold", defense: "hold", défendre: "hold",
  attack: "attack", attaquer: "attack", offensive: "attack",
  breakthrough: "breakthrough", percer: "breakthrough", percee: "breakthrough", percée: "breakthrough", assault: "breakthrough",
});
export const normalizePosture = (value) => POSTURE_ALIASES[clean(value).toLowerCase()] ?? "";

export const normalizeFront = (value, index = 0) => {
  if (!isObject(value)) return null;
  const owner = clean(value.owner);
  const enemy = clean(value.enemy);
  if (!owner || !enemy || key(owner) === key(enemy)) return null;
  return {
    id: clean(value.id) || `front-${slug(owner)}-${slug(enemy)}-${index + 1}`,
    owner,
    enemy,
    posture: normalizePosture(value.posture) || "hold",
    axis: clean(value.axis),
    sector: [...new Set(list(value.sector).map(clean).filter(Boolean))],
    divisionIds: [...new Set(list(value.divisionIds).map(clean).filter(Boolean))],
    createdDate: clean(value.createdDate),
  };
};

export const normalizeFronts = (value) => list(value).map(normalizeFront).filter(Boolean);

// La ligne d'un front : les états du pays au contact de l'ennemi (own), ceux de
// l'ennemi en face (enemy), et les paires qui se touchent. `map` :
// { states, controllerOf, neighboursOf }. `sector` restreint les états du pays.
export const frontLine = (front, map) => {
  const own = [];
  const enemy = new Set();
  const pairs = [];
  const sector = new Set(list(front?.sector));
  for (const id of map.states) {
    if (key(map.controllerOf(id)) !== key(front.owner)) continue;
    if (sector.size && !sector.has(id)) continue;
    const facing = list(map.neighboursOf(id)).filter((next) => key(map.controllerOf(next)) === key(front.enemy));
    if (!facing.length) continue;
    own.push(id);
    for (const next of facing) { enemy.add(next); pairs.push([id, next]); }
  }
  return { own, enemy: [...enemy], pairs };
};

// Les divisions terrestres d'une armée qu'on peut affecter : sur place, pas
// encerclées, pas déjà sur un autre front (sauf `frontId`).
const assignable = (army, templates, frontId = "") => list(army?.divisions).filter((division) =>
  templates?.[division.template]?.kind === "land" && !(division.encircledDays > 0) && (!division.frontId || division.frontId === frontId));

// Répartit les divisions d'un front sur ses états au contact, à tour de rôle
// (l'axe d'abord, s'il y en a un et qu'il fait face). Renvoie l'armée mise à jour.
export const deployFront = (army, front, line) => {
  if (!line.own.length) return army;
  const axisOwn = front.axis ? line.pairs.filter(([, target]) => target === front.axis).map(([from]) => from) : [];
  const slots = [...new Set([...axisOwn, ...line.own])];
  const ids = new Set(front.divisionIds);
  let turn = 0;
  const divisions = list(army.divisions).map((division) => {
    if (!ids.has(division.id)) return division;
    const stateId = slots[turn % slots.length];
    turn += 1;
    return { ...division, frontId: front.id, stateId };
  });
  return { ...army, divisions };
};

// Une opération de front, du joueur ou d'une IA, contre les règles :
//   { op: "create", polity, enemy, posture?, axis?, sector? }
//   { op: "assign", polity, frontId | enemy, count?, template?, divisionIds? }
//   { op: "posture", polity, frontId | enemy, posture, axis? }
//   { op: "disband", polity, frontId | enemy }
// `context` : { fronts, armies, atWar(a, b), templates, date, map? }.
// Renvoie { fronts, armies, note } ; note.kind "dropped" quand c'est refusé.
export const applyFrontOp = (op, context) => {
  const fronts = normalizeFronts(context.fronts);
  const armies = { ...(context.armies ?? {}) };
  const kind = clean(op?.op).toLowerCase();
  const polity = clean(op?.polity);
  const armyKey = Object.keys(armies).find((name) => key(name) === key(polity)) ?? "";
  const refuse = (text) => ({ fronts, armies, note: { kind: "dropped", text: `frontOps — ${text}` } });
  const ok = (text, next = fronts, nextArmies = armies) => ({ fronts: next, armies: nextArmies, note: { kind: "adjusted", text: `frontOps — ${text}` } });
  if (!polity || !armyKey) return refuse(`"${polity}" has no army; the ${kind || "front"} operation was ignored.`);
  const findFront = () => fronts.find((front) => key(front.owner) === key(armyKey)
    && ((op.frontId && front.id === clean(op.frontId)) || (!op.frontId && op.enemy && key(front.enemy) === key(op.enemy))));

  if (kind === "create") {
    const enemy = clean(op.enemy);
    if (!enemy) return refuse(`${armyKey}: a front needs an enemy.`);
    if (!context.atWar?.(armyKey, enemy)) return refuse(`${armyKey} is not at war with ${enemy}: declare the war before opening a front.`);
    if (fronts.filter((front) => key(front.owner) === key(armyKey)).length >= FRONT_LIMITS.maxFrontsPerPolity) return refuse(`${armyKey} already has ${FRONT_LIMITS.maxFrontsPerPolity} fronts.`);
    const front = normalizeFront({
      id: clean(op.id) || `front-${slug(armyKey)}-${slug(enemy)}-${fronts.length + 1}`,
      owner: armyKey, enemy, posture: op.posture, axis: op.axis, sector: op.sector, createdDate: context.date,
    });
    if (context.map && !frontLine(front, context.map).own.length) return refuse(`${armyKey} holds no state in contact with ${enemy}${front.sector.length ? " in the drawn sector" : ""}: there is no front to open.`);
    return ok(`${armyKey} opened a front against ${enemy} (${front.posture}).`, [...fronts, front]);
  }

  const front = findFront();
  if (!front) return refuse(`${armyKey} has no front ${op.frontId ? `"${clean(op.frontId)}"` : `against ${clean(op.enemy) || "that enemy"}`}.`);

  if (kind === "posture") {
    const posture = normalizePosture(op.posture);
    if (!posture) return refuse(`"${clean(op.posture)}" is not a posture (${FRONT_POSTURES.join(", ")}).`);
    if (posture !== "hold" && !context.atWar?.(armyKey, front.enemy)) return refuse(`${armyKey} is no longer at war with ${front.enemy}: the front can only hold.`);
    const next = { ...front, posture, ...(op.axis !== undefined ? { axis: clean(op.axis) } : {}) };
    return ok(`${armyKey}'s front against ${front.enemy} now ${posture}${next.axis ? ` (axis ${next.axis})` : ""}.`, fronts.map((entry) => (entry.id === front.id ? next : entry)));
  }

  // Un nouveau tracé (le panneau Fronts, 7.7) : vide, toute la frontière.
  if (kind === "sector") {
    const next = { ...front, sector: [...new Set(list(op.sector).map(clean).filter(Boolean))] };
    if (context.map && !frontLine(next, context.map).own.length) return refuse(`the drawn sector touches no state of ${front.enemy}: pick states of yours along the border.`);
    let nextArmies = armies;
    if (context.map && armies[armyKey]) nextArmies = { ...armies, [armyKey]: deployFront(armies[armyKey], next, frontLine(next, context.map)) };
    return ok(`${armyKey}'s front against ${front.enemy} redrawn (${next.sector.length ? `${next.sector.length} state(s)` : "the whole border"}).`, fronts.map((entry) => (entry.id === front.id ? next : entry)), nextArmies);
  }

  if (kind === "disband") {
    const army = armies[armyKey];
    const nextArmies = { ...armies, [armyKey]: { ...army, divisions: list(army.divisions).map((division) => (division.frontId === front.id ? { ...division, frontId: "" } : division)) } };
    return ok(`${armyKey} closed its front against ${front.enemy}.`, fronts.filter((entry) => entry.id !== front.id), nextArmies);
  }

  if (kind === "assign") {
    const army = armies[armyKey];
    const pool = assignable(army, context.templates, front.id).filter((division) => !front.divisionIds.includes(division.id));
    let chosen;
    if (list(op.divisionIds).length) {
      const wanted = new Set(list(op.divisionIds).map(clean));
      chosen = pool.filter((division) => wanted.has(division.id));
    } else {
      const template = clean(op.template).toLowerCase();
      const count = Math.max(1, Math.min(FRONT_LIMITS.maxAssignPerOp, Math.floor(Number(op.count) || 1)));
      chosen = pool.filter((division) => !template || division.template === template).slice(0, count);
    }
    if (!chosen.length) return refuse(`${armyKey} has no free land division to send to the front against ${front.enemy}.`);
    const next = { ...front, divisionIds: [...front.divisionIds, ...chosen.map((division) => division.id)] };
    let nextArmy = army;
    if (context.map) nextArmy = deployFront(army, next, frontLine(next, context.map));
    else nextArmy = { ...army, divisions: list(army.divisions).map((division) => (next.divisionIds.includes(division.id) ? { ...division, frontId: next.id } : division)) };
    return ok(`${armyKey} sent ${chosen.length} division(s) to the front against ${front.enemy}.`, fronts.map((entry) => (entry.id === front.id ? next : entry)), { ...armies, [armyKey]: nextArmy });
  }

  return refuse(`"${kind}" is not a front operation (create, assign, posture, sector, disband).`);
};

// L'opération « front » d'une IA (economyOps : { op: "front", polity, enemy,
// posture?, count?, template? }) devient les ordres de front qu'elle résume :
// ouvrir le front s'il manque, fixer sa posture, y envoyer des divisions.
export const frontOpsFromEconomyOp = (op, fronts = []) => {
  const polity = clean(op?.polity);
  const enemy = clean(op?.enemy);
  if (!polity || !enemy) return [];
  const exists = normalizeFronts(fronts).some((front) => key(front.owner) === key(polity) && key(front.enemy) === key(enemy));
  const ops = [];
  if (!exists) ops.push({ op: "create", polity, enemy, posture: op.posture || "hold" });
  else if (op.posture) ops.push({ op: "posture", polity, enemy, posture: op.posture });
  if (Number(op.count) >= 1) ops.push({ op: "assign", polity, enemy, count: op.count, ...(op.template ? { template: op.template } : {}) });
  return ops;
};

// Toutes les opérations d'une liste, dans l'ordre. Renvoie { fronts, armies, notes }.
export const applyFrontOps = (ops, context) => {
  let fronts = normalizeFronts(context.fronts);
  let armies = context.armies ?? {};
  const notes = [];
  for (const op of list(ops)) {
    const result = applyFrontOp(op, { ...context, fronts, armies });
    fronts = result.fronts;
    armies = result.armies;
    notes.push(result.note);
  }
  return { fronts, armies, notes };
};

// Les ordres de front possibles pour un pays, déjà validés : ouvrir un front
// contre chaque ennemi qui n'en a pas, y envoyer ses divisions libres, changer
// la posture d'un front existant. Pour un décideur qui choisit parmi eux (Jev).
export const frontOptions = (polity, context) => {
  const options = [];
  const army = Object.entries(context.armies ?? {}).find(([name]) => key(name) === key(polity))?.[1];
  if (!army) return options;
  const fronts = normalizeFronts(context.fronts).filter((front) => key(front.owner) === key(polity));
  for (const enemy of list(context.enemiesOf?.(polity))) {
    if (fronts.some((front) => key(front.enemy) === key(enemy))) continue;
    const op = { op: "create", polity, enemy, posture: "hold" };
    if (applyFrontOp(op, context).note.kind !== "dropped") options.push(op);
  }
  const free = assignable(army, context.templates).filter((division) => !division.frontId).length;
  for (const front of fronts) {
    if (free) options.push({ op: "assign", polity, frontId: front.id, count: Math.min(free, FRONT_LIMITS.maxAssignPerOp) });
    for (const posture of FRONT_POSTURES) {
      if (posture === front.posture) continue;
      const op = { op: "posture", polity, frontId: front.id, posture };
      if (applyFrontOp(op, context).note.kind !== "dropped") options.push(op);
    }
  }
  return options;
};

// Le décideur local, facultatif : (polity, options) → options choisies (ou une
// promesse). Absent, les ordres des pays IA viennent de leur réponse de tour.
let frontDecider = null;
export const setFrontDecider = (decider) => { frontDecider = typeof decider === "function" ? decider : null; };
export const getFrontDecider = () => frontDecider;
