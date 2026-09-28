import test from "node:test";
import assert from "node:assert/strict";
import {
  ARMY_TUNING,
  DIVISION_TEMPLATES,
  advanceArmy,
  divisionStrength,
  enableHoiArmies,
  normalizeArmy,
  recruitDivision,
  reinforceArmy,
  seedArmy,
  summarizeArmy,
  templatesFor,
  upkeepArmy,
} from "./armies.js";
import { HOI_EQUIPMENT, enableHoiLayerFromPresets } from "./presets.js";
import { advanceHoiLayer } from "./engine.js";
import { applyEconomyOps, normalizeEconomyOp } from "./economyOps.js";

const T36 = templatesFor("1936");
const infantry = (fill = 1, extra = {}) => ({
  id: "d1", name: "1re division", template: "infanterie",
  men: 10000 * fill, equipment: { fusils: 220 * fill, artillerie: 8 * fill }, organisation: 100, morale: 70, ...extra,
});

test("templates: every piece of equipment a template needs is made by a production line", () => {
  for (const [series, templates] of Object.entries(DIVISION_TEMPLATES)) {
    for (const [key, template] of Object.entries(templates)) {
      for (const item of Object.keys(template.equipment)) assert.ok(HOI_EQUIPMENT[item], `${series} ${key}: ${item}`);
      assert.ok(template.men > 0 && ["land", "air", "sea"].includes(template.kind), `${series} ${key}`);
    }
  }
  assert.ok(HOI_EQUIPMENT.navires && HOI_EQUIPMENT.fournitures, "ships and supplies are in the catalogue");
  assert.equal(templatesFor("nonsense"), DIVISION_TEMPLATES[1936]);
});

test("a division's strength: men and equipment against its template, the weaker counts", () => {
  assert.deepEqual(divisionStrength(infantry(), T36.infanterie), { men: 1, equipment: 1, overall: 1 });
  const thin = divisionStrength({ ...infantry(), equipment: { fusils: 110, artillerie: 8 } }, T36.infanterie);
  assert.deepEqual(thin, { men: 1, equipment: 0.75, overall: 0.75 });
  assert.equal(divisionStrength(infantry(0.5), T36.infanterie).overall, 0.5);
});

test("what the lines made goes into the stockpile, and fills the weakest division first", () => {
  const army = normalizeArmy({
    stockpile: {},
    manpower: { available: 4000, growthPerMonth: 0 },
    divisions: [infantry(0.9, { id: "strong" }), infantry(0.5, { id: "weak" })],
  });
  // Fournitures of their own (7.2): an unsupplied division is not refilled.
  const { army: after, report } = advanceArmy(army, 30, { produced: { fusils: 100, artillerie: 2, fournitures: 50 }, templates: T36 });
  assert.deepEqual(report.deposited, { fusils: 100, artillerie: 2, fournitures: 50 });
  const weak = after.divisions.find((d) => d.id === "weak");
  const strong = after.divisions.find((d) => d.id === "strong");
  assert.equal(weak.men, 9000, "4 000 men went to the weakest first");
  assert.equal(strong.men, 9000, "none left for the other");
  assert.equal(report.reinforced[0].id, "weak");
  // 110 rifles, less a month's wear, plus the 100 made this month.
  assert.equal(weak.equipment.fusils, Math.round((110 * (1 - ARMY_TUNING.upkeepPerMonth) + 100) * 100) / 100, "it took the new rifles");
  assert.equal(after.manpower.available, 0);
});

test("upkeep: a little equipment wears out each month; rest restores organisation and brings morale back", () => {
  const army = normalizeArmy({ divisions: [infantry(1, { organisation: 40, morale: 40 })] });
  const { army: after, worn } = upkeepArmy(army, 30, T36);
  assert.equal(worn.fusils, 220 * ARMY_TUNING.upkeepPerMonth);
  assert.equal(after.divisions[0].equipment.fusils, 220 * (1 - ARMY_TUNING.upkeepPerMonth));
  assert.ok(after.divisions[0].organisation > 90, "near full again after a month's rest");
  assert.equal(after.divisions[0].morale, 70);
  const half = upkeepArmy(normalizeArmy({ divisions: [infantry(0.5, { organisation: 10 })] }), 30, T36).army.divisions[0];
  assert.ok(half.organisation <= 50, "a half-strength division cannot be fully organised");
});

test("recruiting: only from the stockpile and the manpower, refused aloud otherwise", () => {
  const empty = normalizeArmy({ manpower: { available: 50000 } });
  const refused = recruitDivision(empty, { template: "infanterie" }, T36);
  assert.equal(refused.division, null);
  assert.match(refused.reason, /not enough equipment in the stockpile \(fusils 0\/110, artillerie 0\/4\)/);
  assert.match(recruitDivision(normalizeArmy({ stockpile: { fusils: 500, artillerie: 10 } }), { template: "infanterie" }, T36).reason, /not enough manpower/);
  assert.match(recruitDivision(empty, { template: "cavalerie" }, T36).reason, /is not a division template here/);
  const stocked = normalizeArmy({ stockpile: { fusils: 150, artillerie: 10 }, manpower: { available: 25000 } });
  const raised = recruitDivision(stocked, { template: "infanterie", name: "Division de Leningrad", stateId: "imp-rgb-X", date: "1936-02-01" }, T36);
  assert.equal(raised.reason, "");
  assert.deepEqual(raised.division.equipment, { fusils: 150, artillerie: 8 }, "what the stock had, up to the template");
  assert.equal(raised.division.organisation, 30, "a new division is not yet organised");
  assert.equal(raised.army.stockpile.fusils, 0);
  assert.equal(raised.army.manpower.available, 15000);
  assert.equal(raised.army.divisions.length, 1);
});

test("starting armies: the 1936 powers detailed, every other polity a few incomplete divisions", () => {
  const soviet = seedArmy("Soviet Union", { series: "1936", stateId: "moscow" });
  assert.equal(soviet.divisions.length, 90 + 4 + 6 + 6 + 4 + 3);
  assert.equal(soviet.divisions[0].stateId, "moscow");
  assert.equal(soviet.manpower.available, 1500000);
  assert.equal(soviet.stockpile.fusils, 90 * 22 + 4 * 11 + 6 * 6);
  const china = summarizeArmy(seedArmy("Kuomintang China"), T36);
  assert.equal(china.byTemplate.infanterie.strength, 0.5, "China's divisions are half-equipped");
  const bahrain = seedArmy("Bahrain");
  assert.equal(bahrain.divisions.length, 3);
  assert.equal(divisionStrength(bahrain.divisions[0], T36.infanterie).overall, 0.8);
});

test("a new HOI4 game gets its armies; one without them is left as it was", () => {
  const world = { polityOverrides: { "Soviet Union": {}, Lithuania: {} } };
  const withArmies = enableHoiLayerFromPresets(world, { startDate: "1936-01-01", capitals: { Lithuania: { state: "kaunas" } } }).world;
  assert.deepEqual(Object.keys(withArmies.hoi.armies).sort(), ["Lithuania", "Soviet Union"]);
  assert.equal(withArmies.hoi.armies.Lithuania.divisions[0].stateId, "kaunas");
  const without = enableHoiLayerFromPresets(world, { startDate: "1936-01-01", armies: false }).world;
  assert.equal(without.hoi.armies, undefined);
  const again = enableHoiArmies(withArmies.hoi);
  assert.equal(again.armies.Lithuania, withArmies.hoi.armies.Lithuania, "an army already there is kept");
});

test("the turn: production reaches the stockpile, divisions wear and refill; the report says so", () => {
  const world = enableHoiLayerFromPresets({ polityOverrides: { "Soviet Union": {} } }, { startDate: "1936-01-01" }).world;
  const before = world.hoi.armies["Soviet Union"];
  const next = advanceHoiLayer(world, { fromDate: "1936-01-01", toDate: "1936-01-31", player: "Soviet Union" });
  const report = next.hoi.lastReport.nations["Soviet Union"];
  assert.ok(report.produced.fusils > 0);
  assert.deepEqual(report.army.deposited.fusils, report.produced.fusils);
  const after = next.hoi.armies["Soviet Union"];
  assert.ok(after.manpower.available > before.manpower.available - 1, "manpower grew (nothing to refill at full strength)");
  assert.ok(after.stockpile.fusils > before.stockpile.fusils, "the month's rifles are in reserve");
  const plain = enableHoiLayerFromPresets({ polityOverrides: { "Soviet Union": {} } }, { startDate: "1936-01-01", armies: false }).world;
  assert.equal(advanceHoiLayer(plain, { fromDate: "1936-01-01", toDate: "1936-01-31" }).hoi.armies, undefined);
});

test("the AI may ask for divisions (economyOps recruit); the engine grants what the stock allows", () => {
  assert.deepEqual(normalizeEconomyOp({ op: "recrutement", polity: "Soviet Union", template: "Infanterie", count: 3 }), { op: "recruit", polity: "Soviet Union", template: "infanterie", count: 3 });
  const hoi = enableHoiLayerFromPresets({ polityOverrides: { "Soviet Union": {}, Lithuania: {} } }, { startDate: "1936-01-01" }).world.hoi;
  const soviet = hoi.armies["Soviet Union"].divisions.length;
  const granted = applyEconomyOps(hoi, [{ op: "recruit", polity: "Soviet Union", template: "infanterie", count: 9 }], { date: "1936-01-10" });
  assert.equal(granted.hoi.armies["Soviet Union"].divisions.length, soviet + 5, "at most five per request; the stock covered them");
  assert.match(granted.notes.map((note) => note.text).join(" "), /at most 5 per request/);
  const lithuania = applyEconomyOps(hoi, [{ op: "recruit", polity: "Lithuania", template: "blindes" }]);
  assert.equal(lithuania.hoi.armies.Lithuania.divisions.length, 3);
  assert.match(lithuania.notes[0].text, /could not raise 1 more blindes division\(s\): not enough equipment/);
  const none = applyEconomyOps({ nations: hoi.nations }, [{ op: "recruit", polity: "Lithuania", template: "infanterie" }]);
  assert.match(none.notes[0].text, /this game has no armies yet/);
});
