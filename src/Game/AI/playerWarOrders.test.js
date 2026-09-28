import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { declaresWar, planPlayerWars, warOrderTarget } from "./playerWarOrders.js";

const world = {
  polityOverrides: {
    Lithuania: { name: "Lithuania", aliases: [] },
    Poland: { name: "Poland", aliases: [] },
    "Soviet Union": { name: "Soviet Union", aliases: [] },
    Finland: { name: "Finland", aliases: [] },
  },
  wars: [],
};
// Game F's three orders.
const orders = () => [
  { id: "a1", status: "planned", title: "Exiger de la Lituanie qu'elle cède Vilnius à l'Union soviétique." },
  { id: "a2", status: "planned", title: "Déclarer la guerre à la Lituanie et lancer l'Armée rouge à la conquête de Kaunas." },
  { id: "a3", status: "planned", title: "Proposer à la Finlande d'échanger l'isthme de Carélie contre des céréales." },
];

test("a declaration of war is recognised in several languages, and a demand is not one", () => {
  assert.ok(declaresWar("Déclarer la guerre à la Lituanie"));
  assert.ok(declaresWar("Declare war on Lithuania"));
  assert.ok(declaresWar("Kriegserklärung an Litauen"));
  assert.ok(declaresWar("Declarar la guerra a Lituania"));
  assert.ok(!declaresWar("Exiger de la Lituanie qu'elle cède Vilnius"));
});

test("the war order's target is the polity it names", () => {
  assert.equal(warOrderTarget("Déclarer la guerre à la Lituanie et lancer l'Armée rouge à la conquête de Kaunas.", world, "Soviet Union"), "Lithuania");
  assert.equal(warOrderTarget("Déclarer la guerre à la Pologne et à la Lituanie", world, "Soviet Union"), "Poland", "several: the one named first after the declaration");
  assert.equal(warOrderTarget("Déclarer la guerre", world, "Soviet Union"), "");
});

test("the war the player ordered is started by the engine, tied to the order", () => {
  const { started, refused } = planPlayerWars({ actions: orders(), world, player: "Soviet Union", date: "1936-01-02" });
  assert.equal(refused.length, 0);
  assert.equal(started.length, 1);
  const [{ target, war, event }] = started;
  assert.equal(target, "Lithuania");
  assert.deepEqual(war, { id: "war-soviet-union-lithuania-1936-01-02", op: "start", actors: ["Soviet Union"], opponents: ["Lithuania"], eventIndexes: [], eventIds: [], note: "Soviet Union declared war on Lithuania" });
  assert.equal(event.title, "Soviet Union declares war on Lithuania");
  assert.deepEqual(event.impacts, { actionIds: ["a2"] });
  assert.equal(event.source, "engine");
});

test("no second war when the world or the answer already has it; an order naming nobody is refused aloud", () => {
  const atWar = { ...world, wars: [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }] };
  assert.equal(planPlayerWars({ actions: orders(), world: atWar, player: "Soviet Union" }).started.length, 0);
  const inAnswer = planPlayerWars({ actions: orders(), world, player: "Soviet Union", warUpdates: [{ op: "start", actors: ["Soviet Union"], opponents: ["Lithuania"] }] });
  assert.equal(inAnswer.started.length, 0);
  const vague = planPlayerWars({ actions: [{ id: "x", status: "planned", title: "Déclarer la guerre à l'Atlantide" }], world, player: "Soviet Union" });
  assert.equal(vague.started.length, 0);
  assert.match(vague.refused[0].reason, /names no polity on this map/);
  const done = planPlayerWars({ actions: [{ ...orders()[1], status: "resolved" }], world, player: "Soviet Union" });
  assert.equal(done.started.length, 0, "a resolved order is not replayed");
});

test("the skip starts the player's wars before the war rules read the answer, on its first segment", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  const add = source.indexOf("if (segmentIndex === 0) addPlayerWars(candidate, bundle,");
  const validate = source.indexOf("const worldChangeError = await validateGeneratedWorldChanges(candidate, bundle.world, {", add);
  const verdicts = source.indexOf("enforceProposalVerdicts(candidate, context.proposalVerdicts ?? []", add);
  assert.ok(add > 0 && verdicts > add && validate > verdicts, "wars, then the proposals' verdicts, then the validation that reads both");
  const helper = source.slice(source.indexOf("const addPlayerWars = "), source.indexOf("const checkClaimsAgainstHolders = "));
  assert.match(helper, /candidate\.events\.push\(\{ \.\.\.event, id: `engine-war-\$\{index \+ 1\}` \}\);/, "at the end, so cited indexes stay right");
  assert.match(helper, /noteReceipt\(receipt, "dropped", `The player's order/);
});

test("the narrator is told only territorial refusals, and no region code reaches the page", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  assert.match(source, /const NARRATION_NOISE = \/could not be placed\|was malformed/);
  assert.match(source, /\.filter\(\(text\) => text && NARRATION_REFUSAL\.test\(text\) && !NARRATION_NOISE\.test\(text\)\)/);
  assert.match(source, /for \(const event of normalizeArray\(payload\?\.events\)\) scrubRegionCodes\(event, \{ nameOf: nameOfRegion \}\);/);
  assert.match(source, /buildNarrationItems\(events, \{ nameOf: regionNameLookup\(\) \}\)/);
});
