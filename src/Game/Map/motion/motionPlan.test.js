// Phase 9 — carte, bâtiments, motion design.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  MOTION_TIMINGS, adjacencyFromArcs, battlePulseAt, classifyOwnerChanges, dashSequence, desaturate, divisionMoves, easeAt,
  fpsFrom, glideAt, motionTimings, normalizeMotionLevel, onScreen, spreadOrder, tourStops,
} from "./motionPlan.js";
import { buildingCounterFeatures, nearestState, BUILDING_DETAIL_ZOOM } from "../buildingCounts.js";
import { buildingSheetRows } from "../../Selection/buildingSheet.js";
import { stateOutlineLines } from "./motionOverlays.js";
import { MAP_LAYER_ORDER } from "../mapLayerOrder.js";
import { decodePng, encodePngRgb, parentHeights, toHeights, toTerrariumRgb } from "../../../../scripts/worldmap/dem-pyramid.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", "..", "..", ...parts), "utf8");

// ——— Le motion design ———

test("a capture spreads from the neighbouring state the winner held, province after province", () => {
  // 1 — 2 — 3 — 4 in a row; 1 was the winner's, 2, 3 and 4 are taken.
  const arcs = [[1, 1, 2], [2, 2, 3], [3, 3, 4], [4, 4, 0]];
  const adjacency = adjacencyFromArcs(arcs);
  assert.deepEqual([...adjacency.get(4)], [3], "the sea (0) is no neighbour");
  const before = ["A", "B", "B", "B"]; const after = ["A", "A", "A", "A"];
  const rank = spreadOrder([2, 3, 4], { adjacency, newOwnerOf: (id) => after[id - 1], oldOwnerOf: (id) => before[id - 1] });
  assert.deepEqual([...rank.entries()], [[2, 0], [3, 1], [4, 2]]);
  // A landing: no province of the winner beside it, all at once.
  const landing = spreadOrder([3, 4], { adjacency, newOwnerOf: () => "C", oldOwnerOf: (id) => before[id - 1] });
  assert.deepEqual([...landing.values()], [0, 0]);
});

test("changes of hands: a capture (control) or an annexation (sovereignty too)", () => {
  const out = classifyOwnerChanges(
    { owners: ["A", "B", "B", "C"], sovereign: ["A", "B", "B", "C"] },
    { owners: ["A", "A", "A", "D"], sovereign: ["A", "B", "A", "D"] },
  );
  assert.deepEqual(out, { captures: [2], annexations: [3, 4] });
});

test("timings: full, reduced (shorter, no ambient, no flyover), off (everything at once)", () => {
  assert.equal(normalizeMotionLevel("whatever"), "full");
  assert.equal(motionTimings("reduced").ambient, false);
  assert.equal(motionTimings("reduced").tour, false);
  assert.ok(motionTimings("reduced").spreadFade < motionTimings("full").spreadFade);
  assert.ok(Object.values(MOTION_TIMINGS.off).every((value) => value === 0 || value === false));
  assert.equal(easeAt(0, 100, 200), 0);
  assert.equal(easeAt(300, 100, 200), 1);
  assert.equal(easeAt(200, 100, 200), 0.5);
  assert.equal(easeAt(5, 0, 0), 1, "off: at once");
});

test("a battle pulses, then flashes in its result's colour; pieces glide; fronts' dashes move", () => {
  const pulse = battlePulseAt(0, { pulse: 1000, flash: 400 });
  assert.equal(pulse.flash, 0);
  assert.ok(pulse.radius >= 10);
  const flash = battlePulseAt(1200, { pulse: 1000, flash: 400 });
  assert.equal(flash.flash, 1);
  assert.ok(flash.opacity < 0.9 && flash.radius > 18);
  assert.deepEqual(battlePulseAt(2000, { pulse: 1000, flash: 400 }), { radius: 0, opacity: 0, flash: 0 });
  assert.deepEqual(glideAt([0, 0], [10, 20], 0), [0, 0]);
  assert.deepEqual(glideAt([0, 0], [10, 20], 1), [10, 20]);
  const moves = divisionMoves(
    { A: { divisions: [{ id: "a1", stateId: "s1" }, { id: "a2", stateId: "s1" }, { id: "a3", stateId: "s2" }] } },
    { A: { divisions: [{ id: "a1", stateId: "s2" }, { id: "a2", stateId: "s2" }, { id: "a3", stateId: "s2" }, { id: "new", stateId: "s1" }] } },
    { s1: [0, 0], s2: [1, 1] },
  );
  assert.deepEqual(moves, [{ owner: "A", from: "s1", to: "s2", count: 2 }], "grouped; a new division does not glide");
  const dashes = dashSequence(2, 2, 8);
  assert.equal(dashes.length, 8);
  assert.ok(dashes.every((pattern) => pattern.length === 4 && Math.abs(pattern.reduce((a, b) => a + b, 0) - 4) < 0.02), "every step keeps the period");
});

test("the flyover follows the turn's events in order; a capitulation greys; only what is on screen moves; fps", () => {
  const centers = { s1: [10, 50], s2: [20, 52] };
  const stops = tourStops([
    { date: "1936-01-11", title: "B", impacts: { regionControlOps: [{ regionId: "s2" }] } },
    { date: "1936-01-04", title: "A", battle: { stateId: "s1" } },
    { date: "1936-01-12", title: "C", impacts: { regionControlOps: [{ regionId: "s2" }] } },
  ], centers);
  assert.deepEqual(stops.map((stop) => [stop.label, stop.kind]), [["A", "battle"], ["B", "change"]]);
  // Gris = 0,3 × 200 + 0,59 × 40 + 0,11 × 40 = 88 ; 85 % du chemin vers lui.
  assert.equal(desaturate("rgb(200, 40, 40)"), "rgb(105, 81, 81)");
  assert.equal(desaturate("#c82828", 0), "rgb(200, 40, 40)");
  assert.equal(onScreen([10, 50], [[0, 40], [20, 60]]), true);
  assert.equal(onScreen([100, 50], [[0, 40], [20, 60]]), false);
  assert.equal(onScreen([179, 0], [[170, -10], [-170, 10]]), true, "across the antimeridian");
  assert.deepEqual(fpsFrom([0, 16, 33, 50, 100]), { fps: 40, min: 20, frames: 5 });
});

// ——— Les bâtiments ———

test("buildings counted by state, one icon per type, at most four; the sheet: level, production, upkeep, effect, damage", () => {
  const centers = { s1: [10, 50], s2: [30, 50] };
  assert.equal(nearestState(11, 50.5, centers), "s1");
  const markers = [
    { lng: 10.2, lat: 50.1, building: { type: "usine_civile" } },
    { lng: 10.1, lat: 49.9, building: { type: "usine_civile" } },
    { regionId: "s2", lng: 0, lat: 0, building: { type: "port" } },
    { lng: 10, lat: 50, building: { type: "fort" } },
    { lng: 10, lat: 50, kind: "embassy" },
  ];
  const { features } = buildingCounterFeatures(markers, centers, { iconOf: (icon) => `hoi-building:${icon}` });
  assert.deepEqual(features.map((f) => [f.properties.stateId, f.properties.type, f.properties.label]), [["s1", "usine_civile", "2"], ["s1", "fort", ""], ["s2", "port", ""]]);
  assert.equal(features[0].properties.icon, "hoi-building:factory");
  assert.equal(BUILDING_DETAIL_ZOOM, 5);
  const rows = buildingSheetRows({ type: "usine_militaire", level: 3, condition: 60 });
  assert.deepEqual(rows.map((row) => row.key), ["level", "production", "upkeep", "effect", "damage"]);
  assert.equal(rows[0].value, "3 / 5");
  assert.equal(rows[1].value, "+1.8 usines militaires");
  assert.match(rows[2].value, /^réparation : \d+ points de construction$/);
  assert.equal(rows[4].value, "40 %");
  assert.match(buildingSheetRows({ type: "fort", level: 2, condition: 10 })[1].value, /arrêtée/);
  const outline = stateOutlineLines(["s1"], { features: [{ properties: { id: "s1" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] });
  assert.equal(outline.features[0].geometry.type, "LineString");
});

// ——— Le relief ———

test("the relief pyramid: Terrarium encoding round-trips, and a parent tile averages its four children", () => {
  const heights = new Float32Array([0, 100, -50, 4807.5]);
  const back = toHeights(decodePng(encodePngRgb(toTerrariumRgb(heights), 2, 2)));
  assert.deepEqual([...back].map((v) => Math.round(v * 10) / 10), [0, 100, -50, 4807.5]);
  const child = new Float32Array(256 * 256).fill(1000);
  const parent = parentHeights([child, null, null, child]);
  assert.equal(parent[0], 1000, "top-left from the first child");
  assert.equal(parent[255], 0, "top-right: no child, sea level");
  assert.equal(parent[256 * 255 + 255], 1000);
});

// ——— Le câblage ———

test("wired: the v3 look, the relief, the motion, the counters, the clickable buildings, the setting", () => {
  const layer = read("src", "Game", "Map", "WorldMapLayer.jsx");
  assert.match(layer, /id="worldmap-terrain"/);
  assert.match(layer, /"fill-opacity": POLITICAL_OPACITY/);
  assert.match(layer, /type="raster-dem" tiles=\{\[`\$\{origin\}\/api\/worldmap\/dem\/\{z\}\/\{x\}\/\{y\}\.png`\]\}/);
  assert.match(layer, /id="worldmap-relief"\r?\n\s+type="hillshade"/);
  assert.match(layer, /const rank = spreadOrder\(spread,/);
  assert.match(layer, /stampCapitulation\(map, \[lng, lat\], \{ duration: T\.stamp \}\);/);
  for (const id of ["worldmap-coast-halo", "worldmap-terrain", "worldmap-relief", "worldmap-country-borders-inner", "motion-border", "motion-blockade", "worldmap-fronts-motion", "worldmap-buildings-count", "motion-battles", "motion-moves"]) {
    assert.ok(MAP_LAYER_ORDER.includes(id), id);
  }
  assert.ok(MAP_LAYER_ORDER.indexOf("worldmap-terrain") < MAP_LAYER_ORDER.indexOf("worldmap-fill"));
  assert.ok(MAP_LAYER_ORDER.indexOf("worldmap-fill") < MAP_LAYER_ORDER.indexOf("worldmap-relief"));
  assert.match(read("server", "worldMap.js"), /app\.get\("\/api\/worldmap\/dem\/:z\/:x\/:y\.png"/);
  assert.match(read("src", "Game", "Map", "Nations.jsx"), /"markers-building-icons",\r?\n\s+"cities-shapes",/);
  assert.match(read("src", "Game", "Map", "ArmiesLayer.jsx"), /<ArmiesMotion map=\{map\}/);
  assert.match(read("src", "Game", "Map", "BuildingCounters.jsx"), /map\.setLayerZoomRange\(id, min, 24\)/);
  assert.match(read("src", "runtime", "mapSettings.js"), /animations: "map_animations",/);
  assert.match(read("src", "Game", "GameUI", "settings.jsx"), /<select id="game-map-animations"/);
});
