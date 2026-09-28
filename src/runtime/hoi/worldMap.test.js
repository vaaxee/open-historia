import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { enableHoiLayerFromPresets, listWorldPolities } from "./presets.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));

// The world map's 1936 polities are named as the map spells them, and a new game
// on it carries them in polityOverrides (seedGameWorldMap), not ownerCodes.
const worldMapWorld = () => ({
  polityOverrides: Object.fromEntries([
    "Soviet Union", "Germany", "France", "United Kingdom", "United States", "Italy",
    "Imperialist Japan", "Kuomintang China", "Lithuania", "Free City of Danzig",
    "Tangier International Zone", "Bahrain",
  ].map((name) => [name, { name }])),
});

test("phase 7.0: the HOI4 economy starts on the world map, the eight powers detailed and every other polity on the small base", () => {
  const world = worldMapWorld();
  assert.equal(listWorldPolities(world).length, 12);
  const out = enableHoiLayerFromPresets(world, { startDate: "1936-01-01" });
  assert.equal(out.series, "1936");
  assert.deepEqual(out.detailed.sort(), ["France", "Germany", "Imperialist Japan", "Italy", "Kuomintang China", "Soviet Union", "United Kingdom", "United States"]);
  assert.equal(out.neutral, 4);
  const soviet = out.world.hoi.nations["Soviet Union"];
  assert.deepEqual(soviet.factories, { civilian: 34, military: 32 });
  assert.deepEqual(soviet.lines.map((line) => line.equipment), ["fusils", "artillerie", "chars", "chasseurs"]);
  assert.deepEqual(out.world.hoi.nations.Bahrain.factories, { civilian: 3, military: 1 });
  assert.equal(out.world.hoi.lastDate, "1936-01-01");
});

test("the economy is switched on at creation only when asked; an existing game keeps its own", () => {
  const library = fs.readFileSync(path.join(here, "..", "..", "Game", "GameUI", "libraryBar.jsx"), "utf8");
  assert.match(library, /return enableHoiLayerFromPresets\(world, \{ startDate: game\.startDate \|\| game\.gameDate \}\)\.world;/);
  assert.match(library, /if \(hoiLayer\) \{\r?\n\s+await saveGame\(details\.game\.id, \{ world: await enableHoiLayerOnGame\(details\.game\.id\) \}\);/);
});
