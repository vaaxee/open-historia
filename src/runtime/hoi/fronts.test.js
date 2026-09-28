import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  applyFrontOp,
  applyFrontOps,
  deployFront,
  frontLine,
  frontOpsFromEconomyOp,
  frontOptions,
  getFrontDecider,
  normalizeFront,
  normalizePosture,
  setFrontDecider,
} from "./fronts.js";
import { templatesFor } from "./armies.js";
import { normalizeEconomyOp, applyEconomyOps } from "./economyOps.js";
import { applyFrontsForTurn } from "../worldmap/frontsTurn.js";
import { buildWarMap } from "../worldmap/warMap.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const T36 = templatesFor("1936");

// 1936 around Lithuania, with a Soviet-held Vilnius to give the two a border.
const info = {
  minsk: { neighbours: ["vilnius"] },
  vilnius: { neighbours: ["minsk", "kaunas", "alytus"] },
  alytus: { neighbours: ["vilnius", "kaunas"] },
  kaunas: { neighbours: ["vilnius", "alytus", "memel"] },
  memel: { neighbours: ["kaunas"] },
};
const catalog = [
  { id: "minsk", country: "Soviet Union", name: "Minsk" },
  { id: "vilnius", country: "Soviet Union", name: "Vilnius" },
  { id: "alytus", country: "Lithuania", name: "Alytus" },
  { id: "kaunas", country: "Lithuania", name: "Kaunas" },
  { id: "memel", country: "Lithuania", name: "Memel" },
];
const map = (world = {}) => buildWarMap({ world, catalog, info });
const wars = [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }];
const division = (id, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 100, stateId: "minsk", ...extra });
const armies = () => ({
  "Soviet Union": { divisions: [division("s1"), division("s2"), division("s3"), { ...division("air"), template: "chasse" }, division("cut", { encircledDays: 10 })] },
  Lithuania: { divisions: [division("l1", { stateId: "kaunas" })] },
});
const context = (extra = {}) => ({ armies: armies(), fronts: [], atWar: (a, b) => [a, b].sort().join() === "Lithuania,Soviet Union", templates: T36, date: "1936-02-01", map: map(), ...extra });

test("a front's line: the owner's states touching the enemy, and the enemy's states facing them", () => {
  const front = normalizeFront({ owner: "Soviet Union", enemy: "Lithuania" });
  assert.deepEqual(frontLine(front, map()), { own: ["vilnius"], enemy: ["kaunas", "alytus"], pairs: [["vilnius", "kaunas"], ["vilnius", "alytus"]] });
  const sector = normalizeFront({ owner: "Soviet Union", enemy: "Lithuania", sector: ["minsk"] });
  assert.deepEqual(frontLine(sector, map()).own, [], "a drawn sector away from the border has no line");
  assert.equal(normalizePosture("percer"), "breakthrough");
  assert.equal(normalizePosture("Tenir"), "hold");
});

test("opening a front: only in a declared war, and only where the two touch", () => {
  const refused = applyFrontOp({ op: "create", polity: "Soviet Union", enemy: "Lithuania" }, context({ atWar: () => false }));
  assert.match(refused.note.text, /not at war with Lithuania: declare the war before opening a front/);
  const far = applyFrontOp({ op: "create", polity: "Soviet Union", enemy: "Lithuania" }, context({ map: map({ regionOwnershipOverrides: { vilnius: "Poland" } }) }));
  assert.match(far.note.text, /holds no state in contact with Lithuania/);
  const opened = applyFrontOp({ op: "create", polity: "Soviet Union", enemy: "Lithuania", posture: "attaquer", axis: "kaunas" }, context());
  assert.equal(opened.note.kind, "adjusted");
  assert.deepEqual({ owner: opened.fronts[0].owner, enemy: opened.fronts[0].enemy, posture: opened.fronts[0].posture, axis: opened.fronts[0].axis }, { owner: "Soviet Union", enemy: "Lithuania", posture: "attack", axis: "kaunas" });
});

test("sending divisions: land divisions, free and not encircled, deployed along the line, the axis first", () => {
  const opened = applyFrontOp({ op: "create", polity: "Soviet Union", enemy: "Lithuania", axis: "kaunas" }, context());
  const sent = applyFrontOp({ op: "assign", polity: "Soviet Union", enemy: "Lithuania", count: 10 }, context({ fronts: opened.fronts }));
  assert.equal(sent.fronts[0].divisionIds.length, 3, "not the air wing, not the encircled division");
  const soviet = sent.armies["Soviet Union"].divisions;
  assert.deepEqual(soviet.filter((d) => d.frontId).map((d) => d.stateId), ["vilnius", "vilnius", "vilnius"]);
  assert.ok(!soviet.find((d) => d.id === "air").frontId);
  const none = applyFrontOp({ op: "assign", polity: "Soviet Union", enemy: "Lithuania", count: 2 }, context({ fronts: sent.fronts, armies: sent.armies }));
  assert.match(none.note.text, /no free land division/);
});

test("posture, disbanding, and orders that do not hold", () => {
  const { fronts, armies: withFront } = applyFrontOps([
    { op: "create", polity: "Soviet Union", enemy: "Lithuania" },
    { op: "assign", polity: "Soviet Union", enemy: "Lithuania", count: 2 },
    { op: "posture", polity: "Soviet Union", enemy: "Lithuania", posture: "breakthrough", axis: "alytus" },
  ], context());
  assert.equal(fronts[0].posture, "breakthrough");
  assert.equal(fronts[0].axis, "alytus");
  assert.match(applyFrontOp({ op: "posture", polity: "Soviet Union", enemy: "Lithuania", posture: "dance" }, context({ fronts })).note.text, /is not a posture/);
  assert.match(applyFrontOp({ op: "posture", polity: "Soviet Union", enemy: "Poland", posture: "hold" }, context({ fronts })).note.text, /has no front against Poland/);
  const closed = applyFrontOp({ op: "disband", polity: "Soviet Union", enemy: "Lithuania" }, context({ fronts, armies: withFront }));
  assert.equal(closed.fronts.length, 0);
  assert.ok(closed.armies["Soviet Union"].divisions.every((d) => !d.frontId), "its divisions are free again");
  assert.match(applyFrontOp({ op: "create", polity: "Atlantis", enemy: "Lithuania" }, context()).note.text, /has no army/);
});

test("the AI's single 'front' order opens, sets and fills a front, through the same rules", () => {
  const op = normalizeEconomyOp({ op: "front", polity: "Soviet Union", enemy: "Lithuania", posture: "attack", count: 2, template: "Infanterie" });
  assert.deepEqual(op, { op: "front", polity: "Soviet Union", enemy: "Lithuania", posture: "attack", count: 2, template: "infanterie" });
  assert.deepEqual(frontOpsFromEconomyOp(op, []).map((entry) => entry.op), ["create", "assign"]);
  assert.deepEqual(frontOpsFromEconomyOp(op, [{ owner: "Soviet Union", enemy: "Lithuania" }]).map((entry) => entry.op), ["posture", "assign"]);
  assert.equal(applyEconomyOps({ nations: { "Soviet Union": {} } }, [op]).notes.length, 0, "left to the turn, which knows the map and the wars");
});

test("the turn: AI orders applied, a front without a war closed, divisions redeployed on the moved line", () => {
  const world = {
    wars,
    hoi: { series: "1936", armies: armies(), fronts: [{ id: "f1", owner: "Soviet Union", enemy: "Lithuania", posture: "attack", divisionIds: ["s1"] }] },
    regionOwnershipOverrides: { alytus: "Soviet Union" }, // taken last turn: the line moved
  };
  const events = [{ title: "Lituanie : offensive", impacts: { economyOps: [{ op: "front", polity: "Lithuania", enemy: "Soviet Union", posture: "hold", count: 1 }] } }];
  const { world: next, notes } = applyFrontsForTurn(world, { events, map: map(world), date: "1936-02-08" });
  assert.equal(next.hoi.fronts.length, 2, "Lithuania opened its own front");
  const s1 = next.hoi.armies["Soviet Union"].divisions.find((d) => d.id === "s1");
  assert.ok(["vilnius", "alytus"].includes(s1.stateId), "on the new line");
  assert.equal(next.hoi.armies.Lithuania.divisions[0].frontId, next.hoi.fronts[1].id);
  assert.match(notes[0].text, /^Event "Lituanie : offensive": frontOps — Lithuania opened a front against Soviet Union/);
  const peace = applyFrontsForTurn({ ...world, wars: [] }, { map: map(world) });
  assert.equal(peace.world.hoi.fronts.length, 0);
  assert.match(peace.notes[0].text, /closed: the two are no longer at war/);
  assert.ok(!peace.world.hoi.armies["Soviet Union"].divisions.find((d) => d.id === "s1").frontId);
});

test("a local decider (Jev) can later pick among orders the engine has already validated", () => {
  const ctx = { ...context(), enemiesOf: () => ["Lithuania"] };
  const options = frontOptions("Soviet Union", ctx);
  assert.deepEqual(options, [{ op: "create", polity: "Soviet Union", enemy: "Lithuania", posture: "hold" }]);
  const opened = applyFrontOp(options[0], ctx);
  const next = frontOptions("Soviet Union", { ...ctx, fronts: opened.fronts });
  assert.deepEqual(next.map((entry) => `${entry.op}${entry.posture ? `:${entry.posture}` : ""}`), ["assign", "posture:attack", "posture:breakthrough"]);
  for (const option of next) assert.notEqual(applyFrontOp(option, { ...ctx, fronts: opened.fronts }).note.kind, "dropped", "every option holds");
  assert.equal(getFrontDecider(), null);
  setFrontDecider((polity, choices) => choices.slice(0, 1));
  assert.equal(typeof getFrontDecider(), "function");
  setFrontDecider(null);
});

test("wired: the schema offers 'front', and the turn applies the fronts after the engine's step", () => {
  const schemas = fs.readFileSync(path.join(here, "..", "..", "Game", "AI", "gameplaySchemas.js"), "utf8");
  assert.match(schemas, /enum: \["modifier", "stock", "line", "research", "damage", "recruit", "front"\]/);
  const gameplay = fs.readFileSync(path.join(here, "..", "..", "Game", "AI", "gameplay.js"), "utf8");
  const engine = gameplay.indexOf("supplyFor: await supplyForTurn(impactedWorld),");
  const fronts = gameplay.indexOf("impactedWorld = await applyFrontsAfterTurn(impactedWorld, freshEvents, { date: nextGame.gameDate, receipt });");
  assert.ok(engine > 0 && fronts > engine);
});

test("deploying spreads a front's divisions over its states", () => {
  const line = { own: ["a", "b"], enemy: ["x"], pairs: [["a", "x"], ["b", "x"]] };
  const army = { divisions: [division("d1"), division("d2"), division("d3")] };
  const out = deployFront(army, { id: "f", axis: "", divisionIds: ["d1", "d2", "d3"] }, line);
  assert.deepEqual(out.divisions.map((d) => d.stateId), ["a", "b", "a"]);
});
