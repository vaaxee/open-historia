// Phase 7.8 — l'interface de l'aviation et de la marine : onglets Air et Mer du
// panneau Fronts, fiches, statistiques, compteurs de la carte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { airPanelModel, applyPlayerAirOp, applyPlayerNavalOp, navalPanelModel, panelMap } from "./frontsModel.js";
import { battleSheetRows, battleSheetTitle, findBattle } from "./battleSheet.js";
import { militaryStats } from "./militaryStats.js";
import { airFeatures, armyStackFeatures, navalFeatures } from "../Map/armyFeatures.js";
import { MAP_LAYER_ORDER } from "../Map/mapLayerOrder.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, ...parts), "utf8");

const info = {
  riga: { neighbours: ["vilnius"], coastal: true, lng: 24.1, lat: 56.9 },
  vilnius: { neighbours: ["riga", "kaunas"], lng: 25.3, lat: 54.7 },
  kaunas: { neighbours: ["vilnius", "memel"], lng: 23.9, lat: 54.9 },
  memel: { neighbours: ["kaunas"], coastal: true, lng: 21.1, lat: 55.7 },
};
const stateOwners = { riga: "Soviet Union", vilnius: "Soviet Union", kaunas: "Lithuania", memel: "Lithuania" };
const stateNames = { riga: "Riga", vilnius: "Vilnius", kaunas: "Kaunas", memel: "Memel" };
const seas = {
  zones: { 20001: { center: [20, 56], neighbours: [], coastalStates: ["memel", "riga"] }, 20002: { center: [0, 0], neighbours: [], coastalStates: [] } },
  stateSeas: { memel: [20001], riga: [20001] },
};
const unit = (id, template, stateId, extra = {}) => ({ id, template, men: 1000, equipment: {}, organisation: 100, morale: 70, experience: 0, supply: 1, stateId, ...extra });
const world = () => ({
  wars: [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }],
  hoi: {
    series: "1936",
    armies: {
      "Soviet Union": { divisions: [
        unit("s0", "infanterie", "vilnius", { frontId: "f" }), unit("m1", "infanterie", "riga"), unit("m2", "infanterie", "riga"),
        unit("c1", "chasse", "vilnius", { equipment: { chasseurs: 22 } }), unit("b1", "bombardement", "vilnius"), unit("n1", "flotte", "riga", { equipment: { navires: 4 } }),
      ] },
      Lithuania: { divisions: [unit("l0", "infanterie", "kaunas")] },
    },
    fronts: [{ id: "f", owner: "Soviet Union", enemy: "Lithuania", posture: "attack", divisionIds: ["s0"] }],
  },
});
const map = (w) => panelMap(w, { info, stateOwners, stateNames });

test("the Air tab: free wings, zones to fly over, an order sent, a refused one changing nothing", () => {
  const w = world();
  const model = airPanelModel(w, "Soviet Union", map(w));
  assert.deepEqual(model.free, { chasse: 1, bombardement: 1 });
  assert.deepEqual(model.fronts, [{ id: "f", enemy: "Lithuania" }]);
  assert.deepEqual(model.states.map((s) => s.name), ["Kaunas", "Vilnius"], "the states the front faces and holds");
  const sent = applyPlayerAirOp(w, { polity: "Soviet Union", op: "assign", frontId: "f", mission: "superiority", template: "chasse", count: 1 });
  assert.equal(sent.note.kind, "adjusted");
  const after = airPanelModel(sent.world, "Soviet Union", map(w));
  assert.deepEqual(after.free, { bombardement: 1 });
  assert.deepEqual(after.missions[0].over, { kind: "front", enemy: "Lithuania" });
  const refused = applyPlayerAirOp(sent.world, { polity: "Soviet Union", op: "assign", frontId: "f", mission: "superiority", count: 1 });
  assert.equal(refused.world, sent.world, "a refused order changes nothing");
});

test("the Sea tab: zones along the coasts, fleets sent to blockade, a landing prepared on an enemy coast", () => {
  const w = world();
  const model = navalPanelModel(w, "Soviet Union", map(w), seas);
  assert.deepEqual(model.zones.map((zone) => [zone.zoneId, zone.name, zone.enemy, zone.own]), [["20001", "Riga", 1, 1]], "only the zones along a coast");
  assert.equal(model.freeFleets, 1);
  assert.equal(model.onCoast, 2);
  assert.deepEqual(model.coasts, [{ id: "memel", name: "Memel", owner: "Lithuania" }]);
  const blockade = applyPlayerNavalOp(w, { polity: "Soviet Union", op: "assign", zoneId: "20001", mission: "blockade" }, map(w), seas);
  assert.equal(blockade.world.hoi.navalMissions[0].mission, "blockade");
  const landing = applyPlayerNavalOp(blockade.world, { polity: "Soviet Union", op: "land", stateId: "memel", count: 2 }, map(w), seas);
  assert.equal(landing.note.kind, "adjusted");
  const after = navalPanelModel(landing.world, "Soviet Union", map(w), seas);
  assert.equal(after.landings[0].divisionIds.length, 2);
  assert.equal(after.onCoast, 0, "embarked divisions are no longer free");
  assert.equal(navalPanelModel(w, "Soviet Union", map(w), null), null, "no sea zones: no tab content");
  // A blockade against the player shows as such.
  const against = { ...w, hoi: { ...w.hoi, blockades: [{ owner: "Lithuania", zoneId: "20001", states: ["riga"] }] } };
  assert.equal(navalPanelModel(against, "Soviet Union", map(w), seas).blockades[0].against, true);
});

test("the battle sheet: air superiority replaces the old Air factor; a landing and a naval battle have their own sheet, in French", () => {
  const battle = {
    id: "b", stateName: "Kaunas", terrain: "plaine", attacker: "Soviet Union", defender: "Lithuania", posture: "attack",
    attackers: { infanterie: 3 }, defenders: {}, garrison: true, result: "captured", losses: { attacker: 10, defender: 3000 }, power: { attack: 4, defense: 0.6, ratio: 6.67 },
    factors: { terrain: 1, river: 1, fort: 1, hold: 1, posture: 1, weather: 1, air: 1.12, superiority: 0.67, bombing: 0.97, dice: 1.02 },
    air: { superiority: 0.67, fighters: { attacker: 2, defender: 1 }, bombers: 1 },
  };
  const rows = battleSheetRows(battle, { language: "fr" });
  const sky = rows.find((row) => row.label === "Supériorité aérienne");
  assert.equal(sky.value, "67 % (escadres de chasse 2 contre 1, 1 bombardiers en appui) ×1.12");
  assert.ok(rows.some((row) => row.label === "Ravitaillement bombardé" && row.value === "×0.97"));
  assert.ok(!rows.some((row) => row.label === "Aviation"), "no longer the old factor");
  const landing = { ...battle, landing: true, naval: 0.2, factors: { ...battle.factors, landing: 0.6 } };
  assert.ok(battleSheetRows(landing, { language: "fr" }).some((row) => row.label === "Débarquement" && row.value === "×0.6 (appui naval +20 %)"));
  assert.equal(battleSheetTitle(landing, { language: "fr" }), "Débarquement à Kovno", "the French place name");
  const naval = {
    id: "naval-1936-06-10-20001", kind: "naval", date: "1936-06-10", zoneId: "20001", zoneName: "Memel", attacker: "Soviet Union", defender: "Lithuania",
    sides: { a: ["Soviet Union"], b: ["Lithuania"] }, fleets: { a: 3, b: 1 }, power: { attack: 3.2, defense: 1.1, ratio: 2.91 },
    losses: { attacker: 200, defender: 900 }, sunk: { attacker: 0.4, defender: 1.2 }, result: "won",
  };
  const navalRows = battleSheetRows(naval, { language: "fr" });
  assert.deepEqual(navalRows.map((row) => row.label), ["Zone maritime", "Flottes", "Puissance", "Résultat", "Zone tenue par", "Navires perdus", "Pertes"]);
  assert.equal(navalRows[0].value, "20001 (au large de Memel)");
  assert.equal(navalRows[3].value, "Zone gagnée");
  assert.equal(battleSheetTitle(naval, { language: "fr" }), "Combat naval au large de Memel");
  assert.equal(findBattle([], naval.id, [naval]), naval, "found in the naval log");
});

test("Statistics > Military: the air force and the navy", () => {
  const w = world();
  w.hoi.airMissions = [{ owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, mission: "superiority", wingIds: ["c1"] }];
  w.hoi.navalMissions = [{ owner: "Soviet Union", zoneId: "20001", mission: "blockade", fleetIds: ["n1"] }];
  w.hoi.seaControl = { 20001: { owners: ["Soviet Union"], contested: false } };
  w.hoi.blockades = [{ owner: "Soviet Union", zoneId: "20001", states: ["memel"] }];
  w.hoi.lastAircraftLosses = { "Soviet Union": { chasseurs: 1.1 } };
  w.hoi.navalLog = [{ id: "n", kind: "naval", date: "1936-06-10", zoneId: "20001", sides: { a: ["Soviet Union"], b: ["Lithuania"] }, sunk: { attacker: 0.4, defender: 1.2 }, result: "won" }];
  const stats = militaryStats(w, "Soviet Union");
  assert.deepEqual(stats.air, { wings: 2, onMission: 1, superiority: 1, support: 0, lostLastTurn: { chasseurs: 1.1 } });
  assert.equal(stats.navy.fleets, 1);
  assert.deepEqual(stats.navy.missions, [{ zoneId: "20001", mission: "blockade", count: 1 }]);
  assert.equal(stats.navy.zonesHeld, 1);
  assert.equal(stats.navy.blockading, 1);
  assert.equal(stats.navy.shipsLost, 0.4);
  assert.match(read("MilitaryStats.jsx"), /<div style=\{heading\}>Air force<\/div>[\s\S]*<div style=\{heading\}>Navy<\/div>/);
});

test("map counters: land stacks without wings and fleets; ✈ over the front, ⚓ or ⛔ in the sea zone", () => {
  const w = world();
  const centers = Object.fromEntries(Object.entries(info).map(([id, entry]) => [id, [entry.lng, entry.lat]]));
  const land = armyStackFeatures(w.hoi.armies, centers, { counts: (division) => ["infanterie"].includes(division.template) });
  assert.deepEqual(land.features.map((f) => [f.properties.stateId, f.properties.count]).sort(), [["kaunas", 1], ["riga", 2], ["vilnius", 1]]);
  const air = airFeatures([{ owner: "Soviet Union", zone: { kind: "front", frontId: "f" }, mission: "superiority", wingIds: ["c1"] }], { centers, fronts: w.hoi.fronts, armies: w.hoi.armies });
  assert.equal(air.features[0].properties.label, "✈ 1");
  assert.deepEqual(air.features[0].geometry.coordinates, [25.3, 55.6], "above the front's divisions");
  const naval = navalFeatures([{ owner: "Soviet Union", zoneId: "20001", mission: "blockade", fleetIds: ["n1"] }], { zones: seas.zones, blockades: [{ owner: "Soviet Union", zoneId: "20001", states: ["memel"] }] });
  assert.equal(naval.features[0].properties.label, "⛔ 1", "a blockade that holds");
  assert.deepEqual(naval.features[0].geometry.coordinates, [20, 56]);
  assert.ok(MAP_LAYER_ORDER.includes("worldmap-air") && MAP_LAYER_ORDER.includes("worldmap-naval"));
  const layer = read("..", "Map", "ArmiesLayer.jsx");
  assert.match(layer, /counts: \(division\) => templates\[division\.template\]\?\.kind === "land",/);
  assert.match(layer, /<Source id="worldmap-naval-source" type="geojson" data=\{navalMarks\}>/);
  const panel = read("fronts.jsx");
  assert.match(panel, /const TABS = \[\["land", "Land"\], \["air", "Air"\], \["sea", "Sea"\]\];/);
  assert.match(panel, /onClick=\{\(\) => runSea\(\{ op: "land", stateId: coast, count: landForm\.count \}\)\}>Prepare<\/button>/);
});
