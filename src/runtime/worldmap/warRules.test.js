import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  CAPITULATION_SHARE,
  atWar,
  capitulationEvent,
  capitulationRecord,
  checkControlOperation,
  checkLegalTransfer,
  coBelligerents,
  describeWarRules,
  findCapitulations,
  frontKey,
  occupationAllowance,
  treatyBetween,
  warsFor,
} from "./warRules.js";

// A small 1936 Baltic: Lithuania holds Kaunas (capital), Klaipėda, Alytus; Poland
// holds Vilnius; the Soviet Union holds Minsk, which borders Vilnius and Alytus.
const STATES = {
  minsk: { name: "Minsk", owner: "Soviet Union", neighbours: ["vilnius", "alytus"] },
  vilnius: { name: "Vilnius", owner: "Poland", neighbours: ["minsk", "kaunas", "alytus"] },
  alytus: { name: "Alytus", owner: "Lithuania", neighbours: ["minsk", "vilnius", "kaunas"] },
  kaunas: { name: "Kaunas", owner: "Lithuania", neighbours: ["alytus", "vilnius", "klaipeda"] },
  klaipeda: { name: "Klaipėda", owner: "Lithuania", neighbours: ["kaunas"] },
};
const makeMap = (controllers = {}, sovereigns = {}, units = {}) => ({
  states: () => Object.keys(STATES),
  controllerOf: (id) => controllers[id] ?? STATES[id]?.owner ?? "",
  sovereignOf: (id) => sovereigns[id] ?? controllers[id] ?? STATES[id]?.owner ?? "",
  neighboursOf: (id) => STATES[id]?.neighbours ?? [],
  unitOwnersIn: (id) => units[id] ?? [],
  nameOf: (id) => STATES[id]?.name ?? id,
});
const war = { wars: [{ id: "w1", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }] };

test("wars: the world's, plus those the answer starts or joins", () => {
  const wars = warsFor({}, "w2~start~Soviet Union~Lithuania~1~invasion");
  assert.ok(atWar(wars, "Soviet Union", "Lithuania"));
  assert.ok(!atWar(wars, "Soviet Union", "Poland"));
  const joined = warsFor(war, [{ id: "w1", op: "join-a", actors: ["Mongolia"] }]);
  assert.deepEqual([...coBelligerents(joined, "Soviet Union")].sort(), ["mongolia", "sovietunion"]);
});

test("rule 1: no state is taken by force without a declared war", () => {
  const reason = checkControlOperation({ op: { op: "control", regionId: "alytus", toCode: "Soviet Union" }, wars: [], map: makeMap(), taken: new Map(), allowance: 3 });
  assert.match(reason, /Soviet Union is not at war with Lithuania: declare the war first/);
});

test("rule 2: occupation moves state by state — a neighbour or troops next to it", () => {
  const wars = warsFor(war);
  const ok = checkControlOperation({ op: { op: "control", regionId: "alytus", toCode: "Soviet Union" }, wars, map: makeMap(), taken: new Map(), allowance: 3 });
  assert.equal(ok, "", "Alytus borders Soviet Minsk");
  const far = checkControlOperation({ op: { op: "control", regionId: "klaipeda", toCode: "Soviet Union" }, wars, map: makeMap(), taken: new Map(), allowance: 3 });
  assert.match(far, /Klaipėda does not border any state Soviet Union or its allies hold/);
  const landing = checkControlOperation({ op: { op: "control", regionId: "klaipeda", toCode: "Soviet Union" }, wars, map: makeMap({}, {}, { klaipeda: ["Soviet Union"] }), taken: new Map(), allowance: 3 });
  assert.equal(landing, "", "a unit standing in it is enough");
  const chained = checkControlOperation({ op: { op: "control", regionId: "kaunas", toCode: "Soviet Union" }, wars, map: makeMap({ alytus: "Soviet Union" }), taken: new Map(), allowance: 3 });
  assert.equal(chained, "", "Kaunas borders Alytus once Alytus is held");
});

test("rule 2: a front takes at most its allowance in a period", () => {
  assert.equal(occupationAllowance(7), 3);
  assert.equal(occupationAllowance(30), 13);
  assert.equal(occupationAllowance(1), 1);
  const taken = new Map([[frontKey("Soviet Union", "Lithuania"), 3]]);
  const reason = checkControlOperation({ op: { op: "control", regionId: "alytus", toCode: "Soviet Union" }, wars: warsFor(war), map: makeMap(), taken, allowance: 3 });
  assert.match(reason, /has already moved 3 states this period/);
});

test("rule 4: sovereignty only by treaty, by the player's own order, or after a capitulation", () => {
  const map = makeMap({ alytus: "Soviet Union" }, { alytus: "Lithuania" });
  const transfer = { regionId: "alytus", fromCode: "Lithuania", toCode: "Soviet Union" };
  assert.match(checkLegalTransfer({ transfer, world: {}, agreementUpdates: [], map }), /Lithuania has not agreed to give up Alytus \(no treaty between Lithuania and Soviet Union\) and has not capitulated/);
  assert.equal(checkLegalTransfer({ transfer, world: {}, agreementUpdates: "t1~start~peace_settlement~Lithuania,Soviet Union~Treaty~Alytus ceded", map }), "");
  assert.ok(treatyBetween({ agreements: [{ status: "active", type: "other", parties: ["Soviet Union", "Lithuania"] }] }, [], "Lithuania", "Soviet Union"));
  assert.ok(!treatyBetween({ agreements: [{ status: "active", type: "trade_economic", parties: ["Soviet Union", "Lithuania"] }] }, [], "Lithuania", "Soviet Union"), "a trade deal cedes nothing");
  const capitulated = { capitulations: [{ polity: "Lithuania", victors: ["Soviet Union"] }] };
  assert.equal(checkLegalTransfer({ transfer, world: capitulated, agreementUpdates: [], map }), "", "held by the winner after the capitulation");
  assert.match(checkLegalTransfer({ transfer: { ...transfer, regionId: "klaipeda" }, world: capitulated, agreementUpdates: [], map }), /Klaipėda is not held by the winning side/);
  const own = { regionId: "minsk", fromCode: "Soviet Union", toCode: "Lithuania" };
  assert.equal(checkLegalTransfer({ transfer: own, world: {}, agreementUpdates: [], map, playerPolity: "Soviet Union", playerOrdered: true }), "", "the player gives up its own land");
});

test("rule 3: the engine capitulates a polity whose capital is taken and a third of its states lost", () => {
  const capitals = { Lithuania: { city: "Kaunas", state: "kaunas" } };
  const onlyAlytus = makeMap({ alytus: "Soviet Union" }, { alytus: "Lithuania" });
  assert.equal(findCapitulations({ world: war, capitals, map: onlyAlytus }).length, 0, "the capital still stands");
  const kaunasTaken = makeMap({ kaunas: "Soviet Union" }, { kaunas: "Lithuania" });
  assert.ok(1 / 3 >= CAPITULATION_SHARE);
  const [capitulation] = findCapitulations({ world: war, capitals, map: kaunasTaken });
  assert.equal(capitulation.polity, "Lithuania");
  assert.equal(capitulation.capital, "Kaunas");
  assert.equal(capitulation.capitalHolder, "Soviet Union");
  assert.deepEqual([capitulation.occupied, capitulation.total], [1, 3]);
  assert.deepEqual(capitulation.victors, ["Soviet Union"]);
  assert.deepEqual(capitulation.warIds, ["w1"]);
  const already = { ...war, capitulations: [{ polity: "Lithuania", victors: ["Soviet Union"] }] };
  assert.equal(findCapitulations({ world: already, capitals, map: kaunasTaken }).length, 0, "once only");
  const peace = { wars: [{ ...war.wars[0], status: "ended" }] };
  assert.equal(findCapitulations({ world: peace, capitals, map: kaunasTaken }).length, 0, "only a polity at war");
});

test("the capitulation's event, record and war updates", () => {
  const capitulation = { polity: "Lithuania", capital: "Kaunas", capitalHolder: "Soviet Union", occupied: 1, total: 3, victors: ["Soviet Union"], occupiers: ["Soviet Union"], warIds: ["w1"] };
  const fr = capitulationEvent(capitulation, { date: "1936-02-01", language: "fr", id: "e1" });
  assert.equal(fr.title, "Lithuania capitule");
  assert.match(fr.description, /^Kaunas aux mains de Soviet Union et 1 de ses 3 états occupés, le gouvernement de Lithuania capitule/);
  assert.equal(fr.source, "engine");
  const { record, warUpdates } = capitulationRecord(capitulation, { date: "1936-02-01", eventId: "e1" });
  assert.deepEqual(record, { polity: "Lithuania", date: "1936-02-01", victors: ["Soviet Union"], occupiers: ["Soviet Union"], capital: "Kaunas", warIds: ["w1"], eventId: "e1" });
  assert.deepEqual(warUpdates, [{ id: "w1", op: "leave", actors: ["Lithuania"], opponents: [], eventIndexes: [], eventIds: ["e1"], note: "Lithuania capitulated" }]);
});

test("the rules the model reads, with the capitulations on record", () => {
  const text = describeWarRules({ capitulations: [{ polity: "Lithuania", date: "1936-02-01", victors: ["Soviet Union"] }] });
  assert.match(text, /only in a DECLARED, active war/);
  assert.match(text, /Capitulation is declared by the ENGINE, never by the story/);
  assert.match(text, /Lithuania capitulated on 1936-02-01 to Soviet Union/);
});

test("wired: war rules in validation, capitulation after the ledgers, rules in the prompt", () => {
  const read = (...parts) => fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..", ...parts), "utf8");
  const gameplay = read("Game", "AI", "gameplay.js");
  assert.match(gameplay, /warRules: \(await isWorldMapGame\(\)\) \? \{ playerPolity: normalizeString\(bundle\.game\.country\), spanDays \} : null,/);
  const ledgers = gameplay.indexOf("worldWithImpacts = diplomaticMerge.world;");
  const capitulation = gameplay.indexOf("const capitulated = applyEngineCapitulations(worldWithImpacts, {", ledgers);
  const storylines = gameplay.indexOf("const storylineMerge = applyWorldStorylineUpdates({", ledgers);
  assert.ok(ledgers > 0 && capitulation > ledgers && capitulation < storylines);
  assert.match(gameplay, /const pair = frontKey\(op\.toCode, map\.controllerOf\(id\)\);/, "the answer's takings are counted under the rule's own key");
  const prompt = read("Game", "AI", "promptContext.js");
  assert.match(prompt, /const warRulesText = \(await isWorldMapGame\(\)\.catch\(\(\) => false\)\) \? describeWarRules\(world\) : "";/);
});
