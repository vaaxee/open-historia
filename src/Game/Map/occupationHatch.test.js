import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { cssColourToRgb, hatchMask, hatchPatternName, hatchPixels, occupationFeatures, occupiedStates } from "./occupationHatch.js";
import { isWorldMapGame, resetWorldMapGameCache } from "../../runtime/worldmap/gameMode.js";

test("occupied states: a controller that is not the lawful sovereign", () => {
  const occupied = occupiedStates({
    sovereignty: { kaunas: "Lithuania", vyborg: "Finland", alytus: "Lithuania" },
    ownership: { kaunas: "Soviet Union", alytus: "Lithuania" },
    stateOwners: { vyborg: "Soviet Union" },
  });
  assert.deepEqual(occupied, [
    { state: "kaunas", sovereign: "Lithuania", controller: "Soviet Union" },
    { state: "vyborg", sovereign: "Finland", controller: "Soviet Union" },
  ]);
});

test("stripes: seamless diagonal tiles in the sovereign's colour", () => {
  const mask = hatchMask(16);
  assert.equal(mask.length, 256);
  assert.equal(mask.filter(Boolean).length, 96, "3 of every 8 diagonals");
  assert.equal(mask[0], true);
  assert.equal(mask[5], false);
  const pixels = hatchPixels([200, 10, 20]);
  assert.deepEqual([...pixels.slice(0, 4)], [200, 10, 20, 235]);
  assert.deepEqual([...pixels.slice(20, 24)], [0, 0, 0, 0]);
  assert.equal(hatchPatternName("Free City of Danzig"), "worldmap-hatch-free-city-of-danzig");
  assert.deepEqual(cssColourToRgb("rgb(12, 34, 56)"), [12, 34, 56]);
  assert.deepEqual(cssColourToRgb("#0c2238"), [12, 34, 56]);
  assert.deepEqual(cssColourToRgb("hsl(0, 100%, 50%)"), [255, 0, 0]);
});

test("the occupation layer takes each occupied state's outline", () => {
  const features = occupationFeatures(
    [{ state: "kaunas", sovereign: "Lithuania", controller: "Soviet Union" }, { state: "nowhere", sovereign: "X", controller: "Y" }],
    { features: [{ properties: { id: "kaunas" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] },
  );
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].properties, { state: "kaunas", sovereign: "Lithuania", controller: "Soviet Union", pattern: "worldmap-hatch-lithuania" });
});

test("the layer is drawn over the fill, under the borders", () => {
  const read = (file) => fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), file), "utf8");
  const order = read("mapLayerOrder.js");
  const fill = order.indexOf('"worldmap-fill"');
  const hatch = order.indexOf('"worldmap-occupation"');
  const lines = order.indexOf('"worldmap-province-lines"');
  assert.ok(fill > 0 && hatch > fill && hatch < lines);
  assert.match(read("WorldMapLayer.jsx"), /<Layer id="worldmap-occupation" type="fill" paint=\{\{ "fill-pattern": \["get", "pattern"\]/);
});

test("a world-map game is told by the server's status; no server, no world map", async () => {
  resetWorldMapGameCache();
  const fetchImpl = async () => ({ ok: true, json: async () => ({ available: true, game: true }) });
  assert.equal(await isWorldMapGame({ force: true, fetchImpl }), true);
  const off = async () => ({ ok: true, json: async () => ({ available: true, game: false }) });
  assert.equal(await isWorldMapGame({ force: true, fetchImpl: off }), false);
  assert.equal(await isWorldMapGame({ force: true, fetchImpl: async () => { throw new Error("no server"); } }), false);
  resetWorldMapGameCache();
});
