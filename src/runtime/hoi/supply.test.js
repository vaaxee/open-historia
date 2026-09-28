import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { SUPPLY_TUNING, applySupply, computeSupply, railLevel, sourcesFor, stateCost, truckShare } from "./supply.js";
import { advanceArmy, normalizeArmy, templatesFor } from "./armies.js";
import { buildSupplyFor, summarizeSupply } from "../worldmap/supplyMap.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const T36 = templatesFor("1936");

// A line of states, west to east: Moscow — Smolensk — Minsk — Vilnius — Kaunas — Memel.
const LINE = ["moscow", "smolensk", "minsk", "vilnius", "kaunas", "memel"];
const neighbours = Object.fromEntries(LINE.map((id, i) => [id, [LINE[i - 1], LINE[i + 1]].filter(Boolean)]));
const map = (holders, info = {}) => ({
  states: LINE,
  controllerOf: (id) => holders[id] ?? "Soviet Union",
  neighboursOf: (id) => neighbours[id] ?? [],
  infoOf: (id) => info[id] ?? { terrain: "plaine", rail: 0 },
});

test("rail: density of track per 1 000 km² gives a level 0-5, and a well-railed state costs far less to cross", () => {
  assert.equal(railLevel(0, 10000), 0);
  assert.equal(railLevel(3157, 29024), 5, "Berlin, 109 km per 1 000 km²");
  assert.equal(railLevel(201, 8904), 3, "Kaunas, 23 km per 1 000 km²");
  assert.equal(railLevel(630, 145648), 1, "Irkutsk");
  assert.equal(stateCost({ terrain: "plaine", rail: 0 }), 1);
  assert.equal(stateCost({ terrain: "montagne", rail: 0 }), 2.5);
  assert.equal(stateCost({ terrain: "plaine", rail: 5 }), 0.3);
  assert.equal(stateCost({}), 1, "unknown: plain, no rail");
});

test("supply reaches in full near a source, fades beyond its range, and trucks carry it further", () => {
  const plain = map({});
  const supply = computeSupply({ side: ["Soviet Union"], ...plain, sources: [{ stateId: "moscow", startCost: 0 }] });
  assert.equal(supply.get("moscow").level, 1);
  assert.equal(supply.get("memel").cost, 5, "five plain states away");
  assert.equal(supply.get("memel").level, 1, "within range 8");
  const mountains = map({}, Object.fromEntries(LINE.map((id) => [id, { terrain: "montagne", rail: 0 }])));
  const far = computeSupply({ side: ["Soviet Union"], ...mountains, sources: [{ stateId: "moscow", startCost: 0 }] });
  assert.equal(far.get("memel").cost, 12.5);
  assert.equal(far.get("memel").level, Math.round((1 - (12.5 - SUPPLY_TUNING.range) / SUPPLY_TUNING.falloff) * 100) / 100);
  const trucked = computeSupply({ side: ["Soviet Union"], ...mountains, sources: [{ stateId: "moscow", startCost: 0 }], trucks: 1 });
  assert.ok(trucked.get("memel").level > far.get("memel").level, "trucks lengthen the reach");
  const railed = map({}, Object.fromEntries(LINE.map((id) => [id, { terrain: "montagne", rail: 5 }])));
  assert.equal(computeSupply({ side: ["Soviet Union"], ...railed, sources: [{ stateId: "moscow", startCost: 0 }] }).get("memel").level, 1, "the railway carries it through the mountains");
});

test("encirclement: a held state no friendly path links to a source is cut off; allies' ground carries supply", () => {
  // Minsk falls to Poland: Vilnius, Kaunas and Memel, still Soviet, are cut off.
  const pocket = map({ minsk: "Poland" });
  const supply = computeSupply({ side: ["Soviet Union"], ...pocket, sources: [{ stateId: "moscow", startCost: 0 }] });
  assert.equal(supply.has("minsk"), false, "not held by the side");
  for (const id of ["vilnius", "kaunas", "memel"]) assert.deepEqual(supply.get(id), { level: 0, cost: Infinity, encircled: true }, id);
  assert.equal(supply.get("smolensk").encircled, false);
  const allied = computeSupply({ side: ["Soviet Union", "Poland"], ...pocket, sources: [{ stateId: "moscow", startCost: 0 }] });
  assert.equal(allied.get("kaunas").encircled, false, "through an ally's Minsk");
  // A port in the pocket keeps it supplied, a little less generously.
  const port = computeSupply({ side: ["Soviet Union"], ...pocket, sources: sourcesFor({ polity: "Soviet Union", controllerOf: pocket.controllerOf, capital: "moscow", ports: ["memel"] }) });
  assert.equal(port.get("kaunas").encircled, false);
  assert.equal(port.get("memel").cost, SUPPLY_TUNING.portStartCost);
});

test("by sea: a colony or an island is supplied from its own coast; an occupied coast is not", () => {
  const catalog = [
    { id: "london", country: "United Kingdom", adjacencies: [] },
    { id: "lagos", country: "United Kingdom", adjacencies: ["kano"] },
    { id: "kano", country: "United Kingdom", adjacencies: ["lagos"] },
    { id: "calais", country: "France", adjacencies: [] },
  ];
  const info = {
    london: { coastal: true, neighbours: [] },
    lagos: { coastal: true, neighbours: ["kano"] },
    kano: { coastal: false, neighbours: ["lagos"] },
    calais: { coastal: true, neighbours: [] },
  };
  const world = { regionOwnershipOverrides: { calais: "United Kingdom" }, regionSovereigntyOverrides: { calais: "France" } };
  const supply = buildSupplyFor({ world, catalog, info, capitals: { "United Kingdom": { state: "london" } } })("United Kingdom");
  assert.equal(supply.get("lagos").cost, SUPPLY_TUNING.coastStartCost, "landed on its own coast");
  assert.equal(supply.get("kano").encircled, false, "and inland from there");
  assert.equal(supply.get("calais").encircled, true, "an occupied French coast is supplied by land, from the front, not by sea");
});

test("sources: the capital, the depots and the ports the country holds — none it has lost", () => {
  const controllerOf = (id) => (id === "moscow" ? "Germany" : "Soviet Union");
  assert.deepEqual(sourcesFor({ polity: "Soviet Union", controllerOf, capital: "moscow", depots: ["minsk"], ports: ["memel", "minsk"] }), [
    { stateId: "minsk", startCost: 0 },
    { stateId: "memel", startCost: SUPPLY_TUNING.portStartCost },
  ]);
});

test("divisions: supplies are drawn from the stockpile; short supply, poor reach and encirclement tell", () => {
  const division = (id, stateId, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 100, stateId, ...extra });
  const army = normalizeArmy({ stockpile: { fournitures: 6 }, divisions: [division("a", "moscow"), division("b", "kaunas")] });
  const supply = new Map([["moscow", { level: 1, encircled: false }], ["kaunas", { level: 0, encircled: true }]]);
  const { army: after, report } = applySupply(army, supply, 30, T36);
  assert.equal(report.needed, 12);
  assert.equal(report.consumed, 6);
  assert.equal(report.ratio, 0.5, "half the supplies needed were in reserve");
  assert.deepEqual(report.encircled, ["b"]);
  assert.equal(after.stockpile.fournitures, 0);
  assert.equal(after.divisions[0].supply, 0.5);
  assert.equal(after.divisions[1].supply, 0);
  assert.equal(after.divisions[1].encircledDays, 30);
  assert.equal(after.divisions[1].organisation, 100 - SUPPLY_TUNING.encircledOrganisationPerDay * 30);
  assert.equal(truckShare({ stockpile: { camions: 5 }, divisions: [division("a", "x")] }, T36), 1);
  assert.equal(truckShare({ stockpile: {}, divisions: [division("a", "x"), division("b", "x")] }, T36), 0);
});

test("the turn: an encircled division is not refilled, and a poorly supplied one does not reorganise", () => {
  const weak = (id, stateId) => ({ id, template: "infanterie", men: 5000, equipment: { fusils: 110, artillerie: 4 }, organisation: 10, stateId });
  const army = { stockpile: { fusils: 500, artillerie: 20 }, manpower: { available: 20000 }, divisions: [weak("free", "moscow"), weak("cut", "kaunas")] };
  const supply = new Map([["moscow", { level: 1, encircled: false }], ["kaunas", { level: 0, encircled: true }]]);
  const { army: after, report } = advanceArmy(army, 30, { produced: { fournitures: 100 }, templates: T36, supply });
  const free = after.divisions.find((d) => d.id === "free");
  const cut = after.divisions.find((d) => d.id === "cut");
  assert.equal(free.men, 10000, "refilled");
  assert.equal(cut.men, 5000, "not refilled");
  assert.equal(cut.organisation, 0);
  assert.deepEqual(report.supply.encircled, ["cut"]);
  assert.deepEqual(report.reinforced.map((entry) => entry.id), ["free"]);
});

test("the map: controllers, wars and depots build each country's supply, once per country", () => {
  const catalog = LINE.map((id) => ({ id, country: id === "kaunas" || id === "memel" ? "Lithuania" : "Soviet Union", adjacencies: neighbours[id] }));
  const world = {
    regionOwnershipOverrides: { kaunas: "Soviet Union" }, // occupied
    wars: [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }],
    markers: [{ building: { type: "complexe_industriel" }, ownerCode: "Lithuania", lng: 21.1, lat: 55.7 }],
    hoi: { armies: { "Soviet Union": { stockpile: { camions: 1000 }, divisions: [] } } },
  };
  const supplyFor = buildSupplyFor({ world, catalog, capitals: { "Soviet Union": { state: "moscow" }, Lithuania: { state: "kaunas" } }, stateAt: () => "memel" });
  const soviet = supplyFor("Soviet Union");
  assert.equal(soviet.get("kaunas").encircled, false, "the occupied state is supplied from Moscow");
  assert.equal(supplyFor("Soviet Union"), soviet, "computed once");
  const lithuania = supplyFor("Lithuania");
  assert.deepEqual([...lithuania.keys()], ["memel"], "its capital is occupied: only Memel is still Lithuanian");
  assert.equal(lithuania.get("memel").encircled, false, "its industrial complex keeps Memel supplied");
  assert.deepEqual(summarizeSupply(soviet), { states: 5, full: 5, poor: 0, encircled: 0 });
});

test("wired: the data script, the server route, and the turn pass each country's supply to the engine", () => {
  const root = path.join(here, "..", "..", "..");
  const script = fs.readFileSync(path.join(root, "scripts", "worldmap", "supply-states.mjs"), "utf8");
  assert.match(script, /if \(feature\?\.properties\?\.featurecla !== "Railroad"\) continue;/, "rail ferries are left out");
  assert.match(script, /rail: railLevel\(railKm, state\.areaKm2\),/);
  assert.match(fs.readFileSync(path.join(root, "scripts", "worldmap", "fetch-sources.mjs"), "utf8"), /\["ne_10m_railroads\.zip", `\$\{NE\}\/cultural\/ne_10m_railroads\.zip`, 15116579,/);
  assert.match(fs.readFileSync(path.join(root, "server", "worldMap.js"), "utf8"), /app\.get\("\/api\/worldmap\/supply"/);
  const gameplay = fs.readFileSync(path.join(root, "src", "Game", "AI", "gameplay.js"), "utf8");
  assert.match(gameplay, /supplyFor: await supplyForTurn\(impactedWorld\),/);
  assert.match(gameplay, /if \(!world\?\.hoi\?\.armies \|\| !\(await isWorldMapGame\(\)\)\) return null;/);
  const engine = fs.readFileSync(path.join(here, "engine.js"), "utf8");
  assert.match(engine, /produced\.fournitures = Math\.round\(\(num\(produced\.fournitures\) \+ intendance\(civilian, days\)\) \* 100\) \/ 100;/, "the civilian economy supplies the troops");
});
