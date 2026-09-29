import test from "node:test";
import assert from "node:assert/strict";
import { COMBAT_TUNING, advanceAllowance, applyCombatOutcome, battleEvent, describeBattles, divisionPower, resolveCombat, seededRandom, weatherAt } from "./combat.js";
import { templatesFor } from "./armies.js";
import { buildWarMap } from "../worldmap/warMap.js";

const T36 = templatesFor("1936");
const info = {
  vilnius: { terrain: "plaine", neighbours: ["kaunas", "alytus"], lat: 54.7 },
  alytus: { terrain: "foret", neighbours: ["vilnius", "kaunas"], lat: 54.4 },
  kaunas: { terrain: "plaine", neighbours: ["vilnius", "alytus", "memel"], lat: 55.4, riverNeighbours: [] },
  memel: { terrain: "plaine", neighbours: ["kaunas"], lat: 55.7 },
};
const catalog = [
  { id: "vilnius", country: "Soviet Union", name: "Vilnius" },
  { id: "alytus", country: "Lithuania", name: "Alytus" },
  { id: "kaunas", country: "Lithuania", name: "Kaunas" },
  { id: "memel", country: "Lithuania", name: "Memel" },
];
const map = (extraInfo = {}) => buildWarMap({ world: {}, catalog, info: { ...info, ...extraInfo } });
const inf = (id, stateId, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 100, morale: 70, experience: 0, supply: 1, stateId, ...extra });
const world = ({ posture = "attack", axis = "kaunas", soviet = 6, lithuanian = 1, fronts = [] } = {}) => ({
  hoi: {
    series: "1936",
    armies: {
      "Soviet Union": { divisions: Array.from({ length: soviet }, (_, i) => inf(`s${i}`, "vilnius", { frontId: "f" })) },
      Lithuania: { divisions: Array.from({ length: lithuanian }, (_, i) => inf(`l${i}`, "kaunas")) },
    },
    fronts: [{ id: "f", owner: "Soviet Union", enemy: "Lithuania", posture, axis, divisionIds: Array.from({ length: soviet }, (_, i) => `s${i}`) }, ...fronts],
  },
});
const atWar = () => true;
const run = (w, extra = {}) => resolveCombat({ world: w, map: map(), atWar, date: "1936-06-10", days: 7, seed: "g", ...extra });

test("a division's power: its type, what it has of its template, organisation, morale, experience, supply", () => {
  assert.equal(divisionPower(inf("a", "x"), T36, "attack"), Math.round(1 * 1 * 1 * (0.8 + 0.28) * 1 * 1 * 100) / 100);
  assert.ok(divisionPower(inf("a", "x", { organisation: 0 }), T36) < divisionPower(inf("a", "x"), T36));
  assert.ok(divisionPower(inf("a", "x", { supply: 0 }), T36) < divisionPower(inf("a", "x"), T36));
  const tank = { ...inf("t", "x"), template: "blindes", men: 8000, equipment: { chars: 45, fusils: 110, camions: 20 } };
  assert.ok(divisionPower(tank, T36, "attack", "plaine") > divisionPower(tank, T36, "attack", "marais") * 1.9, "armour bogs down in a marsh");
  assert.equal(divisionPower({ ...inf("x", "y"), template: "chasse" }, T36), 0, "an air wing does not fight on the ground");
});

test("the same battle twice gives the same result; weather by season and latitude", () => {
  assert.equal(seededRandom("a|b"), seededRandom("a|b"));
  assert.notEqual(seededRandom("a|b"), seededRandom("a|c"));
  assert.deepEqual(run(world()), run(world()));
  assert.equal(weatherAt("1936-01-15", 55), "winter");
  assert.equal(weatherAt("1936-04-15", 55), "mud");
  assert.equal(weatherAt("1936-07-15", 55), "");
  assert.equal(weatherAt("1936-01-15", 30), "");
  assert.equal(weatherAt("1936-07-15", -50), "winter", "the southern winter");
});

test("six Soviet divisions against one Lithuanian on open ground: Kaunas is taken, the defenders fall back", () => {
  const { battles, captures, outcome } = run(world({ posture: "breakthrough" }));
  const [battle] = battles;
  assert.equal(battle.stateName, "Kaunas", "the axis first");
  assert.equal(battle.result, "captured");
  assert.deepEqual(captures[0], { stateId: "kaunas", stateName: "Kaunas", from: "Lithuania", to: "Soviet Union", frontId: "f" });
  assert.ok(["Alytus", "Memel"].includes(battle.retreatTo));
  assert.ok(battle.losses.defender > battle.losses.attacker, "the crushed side loses the most");
  assert.ok(outcome.l0.stateId && outcome.l0.stateId !== "kaunas", "the defenders fall back");
  assert.equal(outcome.s0.stateId, captures.at(-1).stateId, "the attackers stand where the breakthrough stopped");
});

// Test G: thirty divisions in breakthrough against garrisons took one state in a
// week; test G with Jev: then three in a row, 300 km deep, in January. A
// breakthrough now widens the breach along the line it started from, and never
// goes deeper than the states that touched it.
test("a breakthrough takes what touches its starting line, within its weekly advance, never deeper", () => {
  const { battles, captures } = run(world({ posture: "breakthrough", lithuanian: 0 }));
  assert.deepEqual(captures.map((c) => c.stateId), ["kaunas", "alytus"], "Kaunas, then Alytus beside it; Memel lies behind Kaunas");
  assert.deepEqual(battles.map((b) => b.result), ["captured", "captured"]);
  assert.ok(battles[1].factors.fatigue < 1, "each bound tires the attack");
});

test("the advance: points per week by posture, halved in winter, less in mud; a capture costs by terrain", () => {
  assert.equal(advanceAllowance({ posture: "attack", days: 7 }), 2);
  assert.equal(advanceAllowance({ posture: "breakthrough", days: 7 }), 3);
  assert.equal(advanceAllowance({ posture: "breakthrough", days: 7, weather: "winter" }), 1.5);
  assert.equal(advanceAllowance({ posture: "attack", days: 7, weather: "winter" }), 1);
  assert.equal(advanceAllowance({ posture: "attack", days: 14, weather: "mud" }), 2.4);
  assert.equal(COMBAT_TUNING.captureCost.marais, 1.5);
  // January, a marsh first: one capture only (1.5 points spent of 1.5).
  const winter = resolveCombat({ world: world({ posture: "breakthrough", lithuanian: 0 }), map: map({ kaunas: { ...info.kaunas, terrain: "marais" } }), atWar, date: "1936-01-10", days: 7, seed: "g" });
  assert.deepEqual(winter.captures.map((c) => c.stateId), ["kaunas"]);
});

test("a defended capital does not fall at its first battle", () => {
  const capitalOf = (polity) => (polity === "Lithuania" ? "kaunas" : "");
  const first = run(world({ posture: "breakthrough", soviet: 30 }), { capitalOf });
  const [battle] = first.battles;
  assert.equal(battle.stateId, "kaunas");
  assert.equal(battle.result, "stalemate", "held despite the odds");
  assert.equal(battle.factors.capitalHolds, true);
  assert.ok(battle.power.ratio >= COMBAT_TUNING.captureRatio);
  // Fought over once already: it can fall.
  const again = world({ posture: "breakthrough", soviet: 30 });
  again.hoi.battleLog = [{ stateId: "kaunas" }];
  assert.equal(run(again, { capitalOf }).battles[0].result, "captured");
  // Undefended, it falls like any state.
  assert.equal(run(world({ posture: "breakthrough", lithuanian: 0 }), { capitalOf }).battles[0].result, "captured");
});

// Test G: "3000 / 0 men" at 47 to 1 against a garrison.
test("a crushed garrison loses its men; its attacker loses next to nothing", () => {
  const { battles } = run(world({ posture: "breakthrough", lithuanian: 0 }));
  const [battle] = battles;
  assert.equal(battle.garrison, true);
  assert.equal(battle.losses.defender, COMBAT_TUNING.garrisonMen);
  assert.equal(battle.garrisonTaken, COMBAT_TUNING.garrisonMen);
  assert.ok(battle.losses.attacker < 300, `${battle.losses.attacker} men lost against a garrison crushed at ${battle.power.ratio} to 1`);
});

test("one division against a defended forest with a river and forts is thrown back", () => {
  const w = world({ soviet: 1, lithuanian: 2, axis: "alytus", posture: "breakthrough" });
  w.hoi.armies.Lithuania.divisions = [inf("l0", "alytus"), inf("l1", "alytus")];
  const { battles, captures } = run(w, { map: map({ alytus: { ...info.alytus, riverNeighbours: ["vilnius"] } }), fortAt: () => 2 });
  assert.equal(battles[0].result, "repelled");
  assert.equal(captures.length, 0);
  assert.equal(battles[0].factors.river, COMBAT_TUNING.riverDefense);
  assert.equal(battles[0].factors.fort, 1.3);
  assert.equal(battles[0].factors.terrain, 1.25);
});

test("attack spreads over several states up to the front's weekly allowance; hold does not fight; no war, no battle", () => {
  const { battles } = run(world({ soviet: 6 }));
  assert.deepEqual(battles.map((b) => b.stateName).sort(), ["Alytus", "Kaunas"], "both states in contact");
  assert.equal(battles.find((b) => b.stateName === "Kaunas").garrison, false, "Kaunas has its division");
  assert.equal(run(world({ posture: "hold" })).battles.length, 0);
  assert.equal(resolveCombat({ world: world(), map: map(), atWar: () => false, date: "1936-06-10" }).battles.length, 0);
});

test("with nowhere to retreat, the defenders surrender; a long encirclement without organisation ends in surrender", () => {
  const cut = map({ kaunas: { ...info.kaunas, neighbours: ["vilnius"] }, alytus: { ...info.alytus, neighbours: ["vilnius"] } });
  const { battles, surrenders, outcome } = run(world({ posture: "breakthrough" }), { map: cut });
  assert.equal(battles[0].surrendered, 1);
  assert.equal(outcome.l0.removed, true);
  assert.equal(surrenders[0].reason, "no retreat");
  const pocket = world({ posture: "hold" });
  pocket.hoi.armies.Lithuania.divisions = [inf("l0", "memel", { encircledDays: 35, organisation: 0 })];
  assert.equal(run(pocket).surrenders[0].reason, "encircled");
});

test("the outcome is carried onto the armies of the moment, recruits and all", () => {
  const { outcome } = run(world({ posture: "breakthrough" }));
  const now = world({ posture: "breakthrough" }).hoi.armies;
  now["Soviet Union"].divisions.push(inf("recruit", "moscow"));
  const next = applyCombatOutcome(now, outcome);
  const s0 = next["Soviet Union"].divisions.find((d) => d.id === "s0");
  assert.ok(s0.men < 10000 && s0.equipment.fusils < 220);
  assert.ok(s0.organisation <= 100 - COMBAT_TUNING.organisationLoss.attacker, "every battle costs organisation");
  assert.ok(["kaunas", "alytus", "memel"].includes(s0.stateId));
  assert.equal(next["Soviet Union"].divisions.find((d) => d.id === "recruit").stateId, "moscow", "untouched");
  assert.equal(applyCombatOutcome(now, {}), now);
});

test("the battle's own event, and the sheet the AI reads", () => {
  const { battles } = run(world({ posture: "breakthrough" }));
  const event = battleEvent(battles[0], { language: "fr", nameOf: (name) => ({ "Soviet Union": "Union soviétique", Lithuania: "Lituanie" })[name] ?? name });
  // The places by their French names of the time (Kaunas was Kovno).
  assert.equal(event.title, "Bataille de Kovno : prise");
  // Test G avec Jev : les articles (« attaque Rovno, tenue par Pologne… de Union soviétique »).
  assert.match(event.description, /^L'Union soviétique attaque Kovno, tenue par la Lituanie\. Pertes : [\d\s ]+ hommes pour l'Union soviétique, [\d\s ]+ pour la Lituanie\. Kovno passe sous le contrôle de l'Union soviétique ; les défenseurs se replient sur (Alytus|Memel)\.$/);
  const garrison = battleEvent({ ...battles[0], retreatTo: "", garrisonTaken: 3000 }, { language: "fr" });
  assert.match(garrison.description, /la garnison \(3[\s  ]000 hommes\) est tuée ou capturée\.$/);
  assert.deepEqual(event.impacts.regionControlOps, [{ op: "control", regionId: "kaunas", regionName: "Kaunas", fromCode: "Lithuania", toCode: "Soviet Union", note: `engine battle ${battles[0].id}` }]);
  assert.equal(event.source, "engine");
  assert.match(describeBattles(battles).split("\n")[0], /^- 1936-06-10 Kaunas: Soviet Union \(breakthrough\) against Lithuania — power [\d.]+ vs [\d.]+ \(terrain plaine ×1, dice ×[\d.]+\) → CAPTURED; losses \d+ \/ \d+ men; defenders retreat to (Alytus|Memel)\.$/);
});
