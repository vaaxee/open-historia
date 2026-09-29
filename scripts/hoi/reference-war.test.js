// La simulation de référence URSS–Pologne (test G avec Jev : Rovno, Białołęka et
// Varsovie en une semaine de janvier). Sur les vraies données de la carte : elle
// tourne quand elles sont là (server/data, ou OH_DATA_DIR), sinon elle est sautée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const DATA = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
const available = fs.existsSync(path.join(DATA, "worldmap", "v1", "supply-hoi4-states-copy-copy-2.json"))
  && fs.existsSync(path.join(DATA, "scenarios", "hoi4-states-copy-copy-2", "provinces.v1.json"));

test("USSR–Poland in winter: 1 to 2 states a week, Warsaw holds its first battle", { skip: !available && "no world-map data here (set OH_DATA_DIR)" }, async () => {
  const { runReferenceWar } = await import("./reference-war.mjs");
  const { weeks } = runReferenceWar({ weeks: 6, start: "1936-01-01" });
  for (const week of weeks) {
    assert.equal(week.weather, "winter");
    assert.ok(week.captured.length >= 1 && week.captured.length <= 2, `week ${week.week}: ${week.captured.join(", ")}`);
  }
  assert.ok(!weeks[0].captured.includes("Warsaw"), "not in the first week");
  const firstFight = weeks.findIndex((week) => week.battles.some((battle) => battle.startsWith("Warsaw")));
  assert.ok(firstFight >= 0 && !weeks[firstFight].captured.includes("Warsaw"), "a defended capital holds its first battle");
});
