import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { armyStackFeatures, battleFeatures, frontFeatures } from "./armyFeatures.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { battleSheetRows, findBattle } from "../GameUI/battleSheet.js";
import { militaryStats } from "../GameUI/militaryStats.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", ...parts), "utf8");
const centers = { vilnius: [25.3, 54.7], kaunas: [23.9, 54.9], alytus: [24.0, 54.4], memel: [21.1, 55.7] };
const owners = { vilnius: "Soviet Union", kaunas: "Lithuania", alytus: "Lithuania", memel: "Lithuania" };
const neighbours = { vilnius: ["kaunas", "alytus"], kaunas: ["vilnius", "alytus", "memel"], alytus: ["vilnius", "kaunas"], memel: ["kaunas"] };
const inf = (id, stateId, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 90, stateId, ...extra });
const battle = {
  id: "battle-1936-06-10-f-kaunas", date: "1936-06-10", frontId: "f", stateId: "kaunas", stateName: "Kaunas", terrain: "plaine", weather: "",
  attacker: "Soviet Union", defender: "Lithuania", posture: "breakthrough", attackers: { infanterie: 6 }, defenders: { infanterie: 1 }, garrison: false,
  factors: { terrain: 1, river: 1, fort: 1, hold: 1, posture: 1.25, weather: 1, air: 1.06, dice: 1.04 },
  power: { attack: 8.2, defense: 1.4, ratio: 5.86 }, losses: { attacker: 600, defender: 1400 }, result: "captured", retreatTo: "Alytus", surrendered: 0,
};

test("counters: one per country and state, with its number of divisions, side by side when two share a state", () => {
  const armies = { "Soviet Union": { divisions: [inf("s1", "vilnius", { frontId: "f" }), inf("s2", "vilnius"), inf("s3", "kaunas")] }, Lithuania: { divisions: [inf("l1", "kaunas"), inf("x", "")] } };
  const { features } = armyStackFeatures(armies, centers, { colourOf: (owner) => (owner === "Lithuania" ? "#fc0" : "#c00") });
  const vilnius = features.find((f) => f.properties.stateId === "vilnius");
  assert.deepEqual(vilnius.properties, { stateId: "vilnius", owner: "Soviet Union", count: 2, label: "2", strength: 1, onFront: 1, colour: "#c00" });
  assert.deepEqual(vilnius.geometry.coordinates, [25.3, 54.7]);
  const kaunas = features.filter((f) => f.properties.stateId === "kaunas").map((f) => f.geometry.coordinates[0]).sort();
  assert.deepEqual(kaunas, [23.6, 24.2], "two countries in Kaunas, drawn apart");
  assert.equal(features.length, 3, "a division with no state is not drawn");
});

test("fronts: a stroke on each border in contact, and an arrow per target when attacking (the axis marked)", () => {
  const front = { id: "f", owner: "Soviet Union", enemy: "Lithuania", posture: "attack", axis: "kaunas", sector: [] };
  const { features } = frontFeatures([front], { centers, ownerOf: (id) => owners[id], neighboursOf: (id) => neighbours[id] });
  assert.equal(features.filter((f) => f.properties.kind === "front").length, 2, "Vilnius touches Kaunas and Alytus");
  const arrows = features.filter((f) => f.properties.kind === "arrow");
  assert.deepEqual(arrows.map((f) => f.properties.axis), [true, false]);
  const hold = frontFeatures([{ ...front, posture: "hold" }], { centers, ownerOf: (id) => owners[id], neighboursOf: (id) => neighbours[id] });
  assert.equal(hold.features.filter((f) => f.properties.kind === "arrow").length, 0, "holding: no arrow");
  assert.deepEqual(battleFeatures([battle], centers).features[0].properties, { battleId: battle.id, result: "captured", label: "⚔ ✓ Kaunas" });
});

test("the battle sheet: forces, the factors that weighed, power, dice, result, losses", () => {
  const rows = battleSheetRows(battle);
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel.Attacker, "Soviet Union (breakthrough)");
  assert.equal(byLabel["Attacking forces"], "6 infanterie");
  assert.equal(byLabel.Breakthrough, "×1.25");
  assert.equal(byLabel.Air, "×1.06");
  assert.equal(byLabel["River crossing"], undefined, "a factor that did not weigh is not listed");
  assert.equal(byLabel.Result, "State captured");
  assert.equal(byLabel.Losses, "600 / 1400 men");
  assert.equal(byLabel["Defenders fell back to"], "Alytus");
  assert.equal(findBattle([battle], battle.id), battle);
  assert.equal(findBattle([battle], ""), null);
});

test("the Statistics tab's military figures", () => {
  const world = {
    hoi: {
      series: "1936",
      nations: { "Soviet Union": {} },
      armies: { "Soviet Union": { stockpile: { fusils: 120 }, manpower: { available: 900000 }, divisions: [inf("s1", "vilnius", { encircledDays: 3 }), inf("s2", "vilnius", { supply: 0.2 })] } },
      fronts: [{ id: "f", owner: "Soviet Union", enemy: "Lithuania", posture: "attack", divisionIds: ["s1"] }],
      battleLog: [battle],
      lastReport: { nations: { "Soviet Union": { produced: { fusils: 300 }, army: { supply: { consumed: 20, needed: 24 } } } } },
    },
  };
  const stats = militaryStats(world, "Soviet Union");
  assert.equal(stats.totalDivisions, 2);
  assert.equal(stats.men, 20000);
  assert.deepEqual(stats.divisions, [{ template: "infanterie", label: "division d'infanterie", count: 2, strength: 1, organisation: 90 }]);
  assert.deepEqual(stats.supply, { encircled: 1, poorlySupplied: 1, consumed: 20, needed: 24 });
  assert.deepEqual(stats.produced, { fusils: 300 });
  assert.equal(stats.fronts.length, 1);
  assert.equal(stats.lostInBattle, 600);
  assert.equal(militaryStats(world, "Lithuania"), null);
});

test("wired: the layers in the map order, the layer in the world map, the sheet in the event card, the tab in Statistics", () => {
  for (const id of ["worldmap-fronts", "worldmap-front-arrows", "worldmap-battles", "worldmap-armies", "worldmap-armies-count"]) assert.ok(MAP_LAYER_ORDER.includes(id), id);
  assert.ok(MAP_LAYER_ORDER.indexOf("worldmap-fronts") > MAP_LAYER_ORDER.indexOf("worldmap-country-borders"));
  assert.match(read("Map", "WorldMapLayer.jsx"), /<ArmiesLayer stateOwners=\{data\.scenario\?\.stateOwners \?\? \{\}\} colourOf=\{data\.colourOf\} \/>/);
  assert.match(read("GameUI", "time.jsx"), /\{event\.battleId \? <BattleSheet battleId=\{event\.battleId\} \/> : null\}/);
  assert.match(read("GameUI", "stats.jsx"), /<MilitaryStats world=\{worldSnapshot\} targetCountry=\{targetCountry\} \/>/);
  assert.match(read("..", "runtime", "gameState.js"), /battleId: normalizeOptionalString\(entry\.battleId \|\| entry\.battle\?\.id\)/);
  assert.match(read("AI", "gameplay.js"), /battleLog: \[\.\.\.normalizeArray\(impactedWorld\.hoi\.battleLog\), \.\.\.normalizeArray\(combat\?\.battles\)\]\.slice\(-60\),/);
});
