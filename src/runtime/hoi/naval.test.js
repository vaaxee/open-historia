// Phase 7.8 — aviation, marine, blocus, débarquements.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { AIR_TUNING, applyAirOp, airLosses, frontAir, normalizeAirMissions } from "./air.js";
import {
  applyNavalOp,
  blockadedStates,
  defaultAirNavalOps,
  describeNaval,
  enemyDominates,
  landingSupport,
  navalBattleEvent,
  normalizeNavalMission,
  resolveNaval,
} from "./naval.js";
import { battleEvent, describeBattles, mergeOutcomes, resolveCombat } from "./combat.js";
import { templatesFor } from "./armies.js";
import { applyEconomyOps, normalizeEconomyOp } from "./economyOps.js";
import { buildMilitaryPromptBlock } from "./militaryPrompt.js";
import { applyFrontsForTurn, mapOrdersFromEconomyOp } from "../worldmap/frontsTurn.js";
import { buildSupplyFor } from "../worldmap/supplyMap.js";
import { buildWarMap } from "../worldmap/warMap.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const T36 = templatesFor("1936");

// La Baltique de 1936 en miniature : Riga soviétique et Memel lituanienne bordent
// la même zone de mer ; Kaunas est à l'intérieur.
const info = {
  riga: { terrain: "plaine", neighbours: ["vilnius"], coastal: true, lat: 56.9 },
  vilnius: { terrain: "plaine", neighbours: ["riga", "kaunas"], lat: 54.7 },
  kaunas: { terrain: "plaine", neighbours: ["vilnius", "memel"], lat: 54.9 },
  memel: { terrain: "plaine", neighbours: ["kaunas"], coastal: true, lat: 55.7 },
};
const catalog = [
  { id: "riga", country: "Soviet Union", name: "Riga" },
  { id: "vilnius", country: "Soviet Union", name: "Vilnius" },
  { id: "kaunas", country: "Lithuania", name: "Kaunas" },
  { id: "memel", country: "Lithuania", name: "Memel" },
];
const seas = {
  zones: { 20001: { center: [20, 56], neighbours: [20002], coastalStates: ["memel", "riga"] }, 20002: { center: [18, 57], neighbours: [20001], coastalStates: [] } },
  stateSeas: { memel: [20001], riga: [20001] },
};
const wars = [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }];
const warOf = (a, b) => [a, b].sort().join() === "Lithuania,Soviet Union";
const map = (world = {}) => buildWarMap({ world, catalog, info });

const inf = (id, stateId, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 100, morale: 70, experience: 0, supply: 1, stateId, ...extra });
const fighter = (id, extra = {}) => ({ id, template: "chasse", men: 1500, equipment: { chasseurs: 22 }, organisation: 100, morale: 70, experience: 0, supply: 1, stateId: "vilnius", ...extra });
const bomber = (id) => ({ id, template: "bombardement", men: 2000, equipment: { bombardiers: 15 }, organisation: 100, morale: 70, experience: 0, supply: 1, stateId: "vilnius" });
const fleet = (id, stateId = "riga") => ({ id, template: "flotte", men: 4000, equipment: { navires: 4 }, organisation: 100, morale: 70, experience: 0, supply: 1, stateId });

const world = ({ soviet = {}, lithuania = {}, hoi = {} } = {}) => ({
  wars,
  hoi: {
    series: "1936",
    armies: {
      "Soviet Union": { divisions: [inf("s0", "vilnius", { frontId: "f" }), inf("s1", "vilnius", { frontId: "f" }), inf("s2", "vilnius", { frontId: "f" }), ...(soviet.extra ?? [])] },
      Lithuania: { divisions: [inf("l0", "kaunas"), ...(lithuania.extra ?? [])] },
    },
    fronts: [{ id: "f", owner: "Soviet Union", enemy: "Lithuania", posture: "attack", axis: "kaunas", divisionIds: ["s0", "s1", "s2"] }],
    ...hoi,
  },
});

// ——— Aviation ———

test("air: wings go to a front or a state, a recall frees them, the wrong wing is refused", () => {
  const w = world({ soviet: { extra: [fighter("c1"), fighter("c2"), bomber("b1")] } });
  const context = { armies: w.hoi.armies, airMissions: [], fronts: w.hoi.fronts, templates: T36 };
  const sent = applyAirOp({ op: "assign", polity: "Soviet Union", frontId: "f", mission: "chasse", count: 2 }, context);
  assert.equal(sent.note.kind, "adjusted");
  assert.deepEqual(sent.airMissions[0].wingIds, ["c1", "c2"]);
  assert.equal(sent.airMissions[0].mission, "superiority", "« chasse » is air superiority");
  const again = applyAirOp({ op: "assign", polity: "Soviet Union", frontId: "f", mission: "superiority" }, { ...context, airMissions: sent.airMissions });
  assert.equal(again.note.kind, "dropped", "no free fighter left");
  const support = applyAirOp({ op: "assign", polity: "Soviet Union", stateId: "kaunas", mission: "appui" }, { ...context, airMissions: sent.airMissions });
  assert.deepEqual(support.airMissions[1], { id: "air-soviet-union-2", owner: "Soviet Union", zone: { kind: "state", stateId: "kaunas" }, mission: "support", wingIds: ["b1"] });
  assert.equal(applyAirOp({ op: "assign", polity: "Lithuania", frontId: "f" }, context).note.kind, "dropped", "Lithuania has no wing");
  const recalled = applyAirOp({ op: "recall", polity: "Soviet Union", missionId: sent.airMissions[0].id }, { ...context, airMissions: sent.airMissions });
  assert.equal(recalled.airMissions.length, 0);
  assert.deepEqual(normalizeAirMissions([{ owner: "x" }, null]), [], "a mission without a zone is dropped");
});

test("air superiority: fighters against fighters over the front; bombers support the attack and wear the defence", () => {
  const w = world({ soviet: { extra: [fighter("c1"), fighter("c2"), fighter("c3"), bomber("b1"), bomber("b2")] }, lithuania: { extra: [fighter("lc")] } });
  const airMissions = [
    { owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, mission: "superiority", wingIds: ["c1", "c2", "c3"] },
    { owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, mission: "support", wingIds: ["b1", "b2"] },
    // Lithuania flies over the state under attack.
    { owner: "Lithuania", zone: { kind: "state", stateId: "kaunas" }, mission: "superiority", wingIds: ["lc"] },
  ];
  const front = w.hoi.fronts[0];
  const air = frontAir({ front, stateId: "kaunas", armies: w.hoi.armies, airMissions, fronts: w.hoi.fronts, templates: T36 });
  assert.equal(air.superiority, 0.75, "three fighters to one");
  assert.ok(air.support > 0 && air.attrition > 0);
  assert.equal(air.factor, Math.round((1 + AIR_TUNING.superiorityWeight * 0.25 + air.support) * 100) / 100);
  const elsewhere = frontAir({ front, stateId: "memel", armies: w.hoi.armies, airMissions, fronts: w.hoi.fronts, templates: T36 });
  assert.equal(elsewhere.superiority, 1, "Lithuania's fighters guard Kaunas only");
  const empty = frontAir({ front, armies: w.hoi.armies, airMissions: [], fronts: w.hoi.fronts, templates: T36 });
  assert.deepEqual([empty.superiority, empty.factor], [0.5, 1], "an empty sky changes nothing");
  // Losses: the outnumbered fighter loses more than each of the three.
  const { losses } = airLosses(air, 7);
  assert.ok(losses.lc > losses.c1);
  assert.ok(losses.b1 > 0, "bombers lose some to the enemy fighters");
});

test("combat: air superiority replaces the old air factor; the wings' losses and the aircraft lost are counted", () => {
  const base = world({ soviet: { extra: [fighter("c1"), fighter("c2"), bomber("b1")] }, lithuania: { extra: [fighter("lc")] } });
  const withAir = { ...base, hoi: { ...base.hoi, airMissions: [
    { owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, mission: "superiority", wingIds: ["c1", "c2"] },
    { owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, mission: "support", wingIds: ["b1"] },
    { owner: "Lithuania", zone: { kind: "state", stateId: "kaunas" }, mission: "superiority", wingIds: ["lc"] },
  ] } };
  const run = (w) => resolveCombat({ world: w, map: map(w), atWar: warOf, date: "1936-06-10", days: 7, seed: "g" });
  const plain = run(base);
  const flown = run(withAir);
  const [b0] = plain.battles; const [b1] = flown.battles;
  assert.equal(b0.factors.air, 1, "wings kept at home do not fight (the old factor counted every wing)");
  assert.equal(b1.factors.superiority, 0.67);
  assert.ok(b1.factors.air > 1 && b1.factors.bombing < 1);
  assert.ok(b1.power.attack > b0.power.attack && b1.power.defense < b0.power.defense);
  assert.deepEqual(b1.air, { superiority: 0.67, fighters: { attacker: 2, defender: 1 }, bombers: 1 });
  assert.ok(flown.outcome.lc.loss > 0 && flown.outcome.c1.loss > 0, "aircraft are lost");
  assert.ok(flown.aircraft.Lithuania.chasseurs > 0 && flown.aircraft["Soviet Union"].bombardiers > 0);
  assert.match(describeBattles(flown.battles), /air superiority 67% ×[\d.]+, bombed supply ×0\.\d+/);
});

// ——— Marine ———

test("naval orders: fleets to a sea zone, a mission's name in French or English, zones that do not exist refused", () => {
  const w = world({ soviet: { extra: [fleet("n1"), fleet("n2")] } });
  const context = { armies: w.hoi.armies, navalMissions: [], seas, templates: T36, atWar: warOf, controllerOf: map(w).controllerOf };
  const sent = applyNavalOp({ op: "assign", polity: "Soviet Union", zoneId: "20001", mission: "blocus", count: 2 }, context);
  assert.deepEqual(sent.navalMissions[0], { id: "sea-soviet-union-20001-blockade", owner: "Soviet Union", zoneId: "20001", mission: "blockade", fleetIds: ["n1", "n2"] });
  assert.equal(applyNavalOp({ op: "assign", polity: "Soviet Union", zoneId: "29999" }, context).note.kind, "dropped");
  assert.equal(normalizeNavalMission("escorte"), "escort");
  assert.equal(normalizeNavalMission("appui"), "support");
});

test("a naval battle: the stronger side holds the zone, both lose ships, and its blockade cuts the enemy coast", () => {
  const w = world({ soviet: { extra: [fleet("n1"), fleet("n2"), fleet("n3")] }, lithuania: { extra: [fleet("ln", "memel")] } });
  w.hoi.navalMissions = [
    { owner: "Soviet Union", zoneId: "20001", mission: "blockade", fleetIds: ["n1", "n2", "n3"] },
    { owner: "Lithuania", zoneId: "20001", mission: "escort", fleetIds: ["ln"] },
  ];
  const m = map(w);
  const naval = resolveNaval({ world: w, seas, atWar: warOf, controllerOf: m.controllerOf, nameOf: m.nameOf, date: "1936-06-10", days: 7, seed: "g" });
  assert.deepEqual(naval.control["20001"], { owners: ["Soviet Union"], contested: false });
  const [battle] = naval.battles;
  assert.equal(battle.kind, "naval");
  assert.equal(battle.result, "won");
  assert.equal(battle.zoneName, "Memel");
  assert.ok(battle.sunk.defender > 0 && battle.sunk.attacker > 0);
  assert.ok(naval.outcome.ln.loss > naval.outcome.n1.loss, "the beaten fleet loses more");
  assert.deepEqual(naval.blockades, [{ owner: "Soviet Union", zoneId: "20001", states: ["memel"] }]);
  assert.deepEqual([...blockadedStates({ hoi: { blockades: naval.blockades } })], ["memel"]);
  assert.equal(enemyDominates(naval.control, "20001", "Lithuania", warOf), true);
  assert.deepEqual(resolveNaval({ world: w, seas, atWar: warOf, controllerOf: m.controllerOf, date: "1936-06-10", seed: "g" }).battles[0].power,
    battle.power, "the same battle twice gives the same result");
  // An even fight leaves the zone contested: the blockade cuts nothing.
  const even = world({ soviet: { extra: [fleet("n1")] }, lithuania: { extra: [fleet("ln", "memel")] } });
  even.hoi.navalMissions = [
    { owner: "Soviet Union", zoneId: "20001", mission: "blockade", fleetIds: ["n1"] },
    { owner: "Lithuania", zoneId: "20001", mission: "blockade", fleetIds: ["ln"] },
  ];
  const tie = resolveNaval({ world: even, seas, atWar: warOf, controllerOf: m.controllerOf, date: "1936-06-10", seed: "g" });
  assert.equal(tie.control["20001"].contested, true);
  assert.deepEqual(tie.blockades, []);
  // The sheet and the event, in French.
  const event = navalBattleEvent(battle, { language: "fr", nameOf: (name) => ({ "Soviet Union": "Union soviétique", Lithuania: "Lituanie" })[name] ?? name });
  assert.equal(event.title, "Combat naval au large de Memel");
  assert.match(event.description, /^Les flottes de l'Union soviétique \(3\) et de la Lituanie \(1\) s'affrontent au large de Memel\. Navires perdus : [\d.]+ pour l'Union soviétique, [\d.]+ pour la Lituanie\. L'Union soviétique garde la maîtrise de la zone\.$/);
  assert.match(describeNaval(naval), /BLOCKADE by Soviet Union in sea zone 20001: 1 enemy coastal state/);
});

test("a blockade cuts sea supply: a coast under blockade is no longer a supply source", () => {
  const base = { wars, hoi: { series: "1936", armies: { Lithuania: { divisions: [] } } } };
  const open = buildSupplyFor({ world: base, catalog, info, capitals: {} })("Lithuania");
  const cut = buildSupplyFor({ world: { ...base, hoi: { ...base.hoi, blockades: [{ owner: "Soviet Union", zoneId: "20001", states: ["memel"] }] } }, catalog, info, capitals: {} })("Lithuania");
  assert.ok(open.get("memel").level > 0, "supplied from its own coast");
  assert.ok(!(cut.get("memel")?.level > 0), "blockaded: nothing comes by sea");
});

// ——— Débarquements ———

test("a landing: free divisions on their own coast, on an enemy coast across a sea the enemy does not hold", () => {
  const w = world({ soviet: { extra: [inf("m1", "riga"), inf("m2", "riga"), inf("far", "vilnius")] } });
  const m = map(w);
  const context = { armies: w.hoi.armies, navalMissions: [], landings: [], seas, templates: T36, atWar: warOf, controllerOf: m.controllerOf, nameOf: m.nameOf, date: "1936-06-03" };
  const done = applyNavalOp({ op: "land", polity: "Soviet Union", stateId: "memel", count: 5 }, context);
  assert.equal(done.note.kind, "adjusted");
  assert.deepEqual(done.landings[0].divisionIds, ["m1", "m2"], "only the divisions on a coast embark");
  assert.equal(done.landings[0].zoneId, "20001");
  assert.equal(done.armies["Soviet Union"].divisions.find((d) => d.id === "m1").frontId, done.landings[0].id, "embarked, no longer free");
  assert.equal(applyNavalOp({ op: "land", polity: "Soviet Union", stateId: "kaunas" }, context).note.kind, "dropped", "Kaunas has no coast");
  const held = applyNavalOp({ op: "land", polity: "Soviet Union", stateId: "memel" }, { ...context, seaControl: { 20001: { owners: ["Lithuania"], contested: false } } });
  assert.match(held.note.text, /the enemy dominates every sea zone off Memel/);
});

test("the bridgehead battle: a weak garrison is overrun; the landed divisions stand ashore and are free again", () => {
  const w = world({ soviet: { extra: [inf("m1", "riga", { frontId: "landing-x" }), inf("m2", "riga", { frontId: "landing-x" }), inf("m3", "riga", { frontId: "landing-x" }), fleet("n1")] } });
  w.hoi.fronts = [];
  w.hoi.navalMissions = [{ owner: "Soviet Union", zoneId: "20001", mission: "support", fleetIds: ["n1"] }];
  w.hoi.landings = [{ id: "landing-x", owner: "Soviet Union", enemy: "Lithuania", zoneId: "20001", stateId: "memel", divisionIds: ["m1", "m2", "m3"] }];
  const m = map(w);
  const support = landingSupport(w, "20001", "Soviet Union", {}, warOf);
  assert.ok(support > 0, "the fleet in support helps");
  const combat = resolveCombat({ world: w, map: m, atWar: warOf, date: "1936-06-10", days: 7, seed: "g", seaSupport: () => support });
  const [battle] = combat.battles;
  assert.equal(battle.landing, true);
  assert.equal(battle.result, "captured");
  assert.equal(battle.factors.landing, Math.round(0.5 * (1 + support) * 100) / 100);
  assert.deepEqual([combat.outcome.m1.stateId, combat.outcome.m1.frontId], ["memel", ""]);
  const event = battleEvent(battle, { language: "fr" });
  assert.equal(event.title, "Débarquement à Memel : tête de pont tenue");
  assert.equal(event.impacts.regionControlOps[0].regionId, "memel");
  // The enemy took the sea meanwhile: the convoy is intercepted and turns back.
  const blocked = resolveCombat({ world: w, map: m, atWar: warOf, date: "1936-06-10", seed: "g", landingBlocked: () => true });
  assert.equal(blocked.battles.length, 0);
  assert.equal(blocked.intercepted[0].divisions, 3);
  assert.equal(blocked.outcome.m1.frontId, "");
  assert.ok(blocked.outcome.m1.loss > 0 && !blocked.outcome.m1.stateId);
});

test("outcomes from the sea and the land merge into one per division", () => {
  const merged = mergeOutcomes({ a: { loss: 0.1, organisation: -10, morale: 0, experience: 0, stateId: "", removed: false } }, { a: { loss: 0.1, organisation: -5, morale: 2, experience: 0.02, stateId: "x", removed: false, frontId: "" } });
  assert.deepEqual(merged.a, { loss: 0.19, organisation: -15, morale: 2, experience: 0.02, stateId: "x", removed: false, frontId: "" });
});

// ——— IA ———

test("AI defaults: wings over its busiest front, bombers in support of an attack, fleets blockading where they are stronger", () => {
  const w = world({ soviet: { extra: [fighter("c1"), bomber("b1"), fleet("n1"), fleet("n2")] }, lithuania: { extra: [fleet("ln", "memel")] } });
  const m = map(w);
  const ops = defaultAirNavalOps("Soviet Union", { armies: w.hoi.armies, fronts: w.hoi.fronts, seas, templates: T36, enemies: ["Lithuania"], controllerOf: m.controllerOf });
  assert.deepEqual(ops, [
    { kind: "air", op: { op: "assign", polity: "Soviet Union", frontId: "f", mission: "superiority", count: 1 } },
    { kind: "air", op: { op: "assign", polity: "Soviet Union", frontId: "f", mission: "support", count: 1 } },
    { kind: "naval", op: { op: "assign", polity: "Soviet Union", zoneId: "20001", mission: "blockade", count: 2 } },
  ]);
  const weaker = defaultAirNavalOps("Lithuania", { armies: w.hoi.armies, fronts: [], seas, templates: T36, enemies: ["Soviet Union"], controllerOf: m.controllerOf });
  assert.deepEqual(weaker, [{ kind: "naval", op: { op: "assign", polity: "Lithuania", zoneId: "20001", mission: "escort", count: 1 } }], "outnumbered: it escorts");
  assert.deepEqual(defaultAirNavalOps("Soviet Union", { armies: w.hoi.armies, seas, templates: T36, enemies: [] }), [], "at peace: nothing");
});

test("the turn: AI air and naval orders apply, AI countries at war send their free forces, the player's stay home", () => {
  const w = world({ soviet: { extra: [fighter("c1"), fleet("n1"), inf("m1", "riga")] }, lithuania: { extra: [fleet("ln", "memel"), fleet("ln2", "memel")] } });
  const events = [{ title: "Opération Baltique", impacts: { economyOps: [
    { op: "naval", polity: "Lithuania", enemy: "Soviet Union", mission: "blockade", count: 2 },
    { op: "air", polity: "Lithuania", enemy: "Soviet Union", mission: "superiority" },
  ] } }];
  const { world: next, notes } = applyFrontsForTurn(w, { events, map: map(w), seas, player: "Soviet Union", date: "1936-06-03" });
  assert.deepEqual(next.hoi.navalMissions.map((mission) => [mission.owner, mission.zoneId, mission.mission, mission.fleetIds.length]), [["Lithuania", "20001", "blockade", 2]]);
  assert.ok(notes.some((note) => /^Event "Opération Baltique": navalOps — Lithuania sent 2 fleet\(s\) on blockade/.test(note.text)));
  // Lithuania's default defence opened its front; it has no wing to fly over it.
  assert.ok(notes.some((note) => /^Event "Opération Baltique": airOps — Lithuania has no free chasse wing/.test(note.text)), "Lithuania has no wing");
  assert.equal(next.hoi.airMissions.length, 0, "the player's wings wait for the player");
  // An AI landing order picks the least defended enemy coast.
  const orders = mapOrdersFromEconomyOp(normalizeEconomyOp({ op: "naval", polity: "Soviet Union", enemy: "Lithuania", mission: "landing", count: 1 }), { map: map(w), seas, armies: w.hoi.armies, atWar: warOf });
  assert.deepEqual(orders, [{ kind: "naval", op: { op: "land", polity: "Soviet Union", stateId: "memel", count: 1 } }]);
  // Missions over a closed front disappear with it.
  const peace = applyFrontsForTurn({ ...next, wars: [], hoi: { ...next.hoi, airMissions: [{ owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, wingIds: ["c1"] }] } }, { map: map(w), seas });
  assert.deepEqual(peace.world.hoi.airMissions, []);
});

test("economyOps air and naval: kept whole, applied by the turn with the map, not by the economy", () => {
  assert.deepEqual(normalizeEconomyOp({ op: "marine", polity: "Italy", enemy: "Greece", mission: "Blockade", count: "2" }), { op: "naval", polity: "Italy", enemy: "Greece", mission: "blockade", count: 2 });
  assert.equal(normalizeEconomyOp({ op: "air", polity: "Italy" }), null, "no enemy");
  assert.equal(applyEconomyOps({ nations: { Italy: {} } }, [{ op: "air", polity: "Italy", enemy: "Greece", mission: "support" }]).notes.length, 0);
});

test("the AIs read the air and the sea; the schema offers the orders; the turn resolves the sea before the land", () => {
  const w = world({ soviet: { extra: [fighter("c1"), fleet("n1")] } });
  w.hoi.airMissions = [{ owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, mission: "superiority", wingIds: ["c1"] }];
  w.hoi.navalMissions = [{ owner: "Soviet Union", zoneId: "20001", mission: "blockade", fleetIds: ["n1"] }];
  w.hoi.blockades = [{ owner: "Soviet Union", zoneId: "20001", states: ["memel"] }];
  const block = buildMilitaryPromptBlock(w, "Soviet Union", { others: 2, forTurn: true });
  assert.match(block, /Air and sea:\n- Soviet Union: 1 wing\(s\) on superiority over the front against Lithuania\.\n- Soviet Union: 1 fleet\(s\) on blockade in sea zone 20001\.\n- Soviet Union blockades sea zone 20001/);
  assert.match(block, /economyOps air \(enemy, mission superiority\/support, count of wings\) and naval/);
  const schemas = fs.readFileSync(path.join(here, "..", "..", "Game", "AI", "gameplaySchemas.js"), "utf8");
  assert.match(schemas, /mission: \{ type: "string", enum: \["superiority", "support", "escort", "blockade", "landing"\] \},/);
  const gameplay = fs.readFileSync(path.join(here, "..", "..", "Game", "AI", "gameplay.js"), "utf8");
  const naval = gameplay.indexOf("? resolveNaval({ world, seas, atWar: warOf");
  const land = gameplay.indexOf("const combat = resolveCombat({", naval);
  assert.ok(naval > 0 && land > naval, "the sea first, then the land (landings use the naval support)");
  assert.match(gameplay, /blockades: normalizeArray\(combat\?\.naval\?\.blockades\),/);
  assert.match(gameplay, /applyFrontsForTurn\(world, \{ events, map: buildWarMap\(\{ world, \.\.\.context \}\), date, player, seas: await seasForTurn\(\), orders: normalizeArray\(orders\) \}\)/);
  const server = fs.readFileSync(path.join(here, "..", "..", "..", "server", "worldMap.js"), "utf8");
  assert.match(server, /app\.get\("\/api\/worldmap\/seas"/);
});
