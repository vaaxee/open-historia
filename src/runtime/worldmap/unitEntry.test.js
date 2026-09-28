import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { checkUnitEntry, passageGranted, touchesSea, unitEntrySentence } from "./unitEntry.js";
import { describeWarRules } from "./warRules.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));

// 1936 around Lithuania: the Soviet Union touches Latvia and Poland, not Lithuania.
const holders = {
  kaunas: "Lithuania", vilnius: "Poland", minsk: "Soviet Union", latgale: "Latvia",
  memel: "Lithuania", konigsberg: "Germany", leningrad: "Soviet Union", tallinn: "Estonia",
};
const neighbours = {
  kaunas: ["vilnius", "memel", "latgale", "konigsberg"],
  vilnius: ["kaunas", "minsk", "latgale"],
  memel: ["kaunas", "konigsberg"],
  tallinn: ["leningrad"],
};
const coast = new Set(["memel", "konigsberg", "leningrad", "tallinn"]);
const map = (extra = {}) => ({
  controllerOf: (id) => ({ ...holders, ...extra })[id] ?? "",
  neighboursOf: (id) => neighbours[id] ?? [],
  nameOf: (id) => id[0].toUpperCase() + id.slice(1),
  isCoastal: (id) => coast.has(id),
});

test("test F: a Soviet division cannot be raised next to Kaunas, the Soviet Union has no border with Lithuania", () => {
  const reason = checkUnitEntry({ owner: "Soviet Union", regionId: "kaunas", map: map() });
  assert.match(reason, /Soviet Union's unit cannot be raised in Kaunas, held by Lithuania: no state Soviet Union or its allies hold borders it/);
  assert.match(checkUnitEntry({ owner: "Soviet Union", regionId: "kaunas", from: { regionId: "minsk" }, map: map() }), /cannot move into Kaunas/);
});

test("a unit may enter from next door, on its own side's ground, or with a right of passage", () => {
  assert.equal(checkUnitEntry({ owner: "Soviet Union", regionId: "vilnius", map: map() }), "", "Vilnius borders Minsk");
  assert.equal(checkUnitEntry({ owner: "Lithuania", regionId: "kaunas", map: map() }), "", "at home");
  assert.equal(checkUnitEntry({ owner: "Soviet Union", regionId: "kaunas", map: map({ vilnius: "Soviet Union" }) }), "", "once Vilnius is held");
  const wars = [{ id: "w", status: "active", sideA: ["Soviet Union", "Poland"], sideB: ["Lithuania"] }];
  assert.equal(checkUnitEntry({ owner: "Soviet Union", regionId: "kaunas", wars, map: map() }), "", "Poland, a co-belligerent, borders it");
  const world = { agreements: [{ type: "military_access", status: "active", parties: ["Latvia", "Soviet Union"] }] };
  assert.equal(checkUnitEntry({ owner: "Soviet Union", regionId: "latgale", world, map: map() }), "");
  assert.ok(passageGranted({}, "a1~start~military_access~Lithuania,Soviet Union~~", "Soviet Union", "Lithuania"), "started in the same answer");
  assert.ok(!passageGranted({ agreements: [{ type: "trade_economic", status: "active", parties: ["Lithuania", "Soviet Union"] }] }, [], "Soviet Union", "Lithuania"));
});

test("by sea: a landing from the sea, or from one of its own coasts to another coast", () => {
  assert.equal(checkUnitEntry({ owner: "Soviet Union", regionId: "memel", from: { atSea: true }, map: map() }), "");
  assert.equal(checkUnitEntry({ owner: "Soviet Union", regionId: "memel", from: { regionId: "leningrad" }, map: map() }), "");
  assert.match(checkUnitEntry({ owner: "Soviet Union", regionId: "memel", from: { regionId: "minsk" }, map: map() }), /cannot be reached by sea/, "Minsk has no coast");
  assert.match(checkUnitEntry({ owner: "Soviet Union", regionId: "memel", map: map() }), /cannot be raised in/, "a unit is not raised abroad by sea");
});

test("a coast is where the land just outside the outline belongs to no region", () => {
  const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  assert.equal(touchesSea(square, () => true), false, "land all round");
  assert.equal(touchesSea(square, ([lng]) => lng < 1.05), true, "sea to the east");
  assert.equal(touchesSea(null, () => false), false);
});

test("the refusal is told in the story's language", () => {
  assert.equal(
    unitEntrySentence({ name: "2ème Division Blindée Soviétique", place: "Kaunas", holder: "Lituanie", raised: true }, "fr"),
    "« 2ème Division Blindée Soviétique » n'a pas pu être levée à Kaunas (Lituanie) : aucune frontière commune, aucun droit de passage, aucun accès par la mer. Elle n'a pas été créée.",
  );
  assert.match(unitEntrySentence({ name: "1st Army", place: "Memel", holder: "Lithuania" }, "en"), /could not enter Memel \(Lithuania\).*It stays where it was\./);
});

test("the AI is told the rule, and the turn applies it after placement, on the world map only", () => {
  assert.match(describeWarRules({}), /Units follow the same neighbourhood/);
  const source = fs.readFileSync(path.join(here, "..", "..", "Game", "AI", "gameplay.js"), "utf8");
  const placement = source.indexOf("const placement = resolvedRegionIdsOnly ? null : await resolvePlacements(containers, world, { receipt });");
  const enforce = source.indexOf("const unitRefused = enforceUnitEntry(containers, candidate, world, placement);");
  assert.ok(placement > 0 && enforce > placement);
  assert.match(source.slice(placement, enforce), /if \(warRules && captureGuard && placement && Array\.isArray\(candidate\?\.events\)\)/);
  assert.match(source.slice(enforce, enforce + 1400), /event\.description = `\$\{normalizeString\(event\.description\)\} \$\{unitEntrySentence\(\{ \.\.\.entry, holder \}, language\)\}`/);
  assert.match(source, /if \(entry\.family === "unit"\) unitRegions\.set\(target, gazetteer\.regionAt/);
});
