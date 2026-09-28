import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { declaresWar, insertEventAt, planPlayerWars, warOrderTarget } from "./playerWarOrders.js";
import { eventDeclaresWar, eventNarratesHardCombat, validateCanonicalWarEvents } from "./nativeWarLedger.js";

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
  assert.equal(event.warId, "war-soviet-union-lithuania-1936-01-02", "the announcement is bound to its war, or the ledger drops it");
  assert.deepEqual(event.impacts, { actionIds: ["a2"] });
  assert.equal(event.source, "engine");
});

test("in a French game the engine announces the war in French", () => {
  const { started } = planPlayerWars({ actions: orders(), world, player: "Soviet Union", date: "1936-01-09", language: "fr" });
  assert.equal(started[0].event.title, "Déclaration de guerre : Union soviétique contre Lituanie");
  assert.equal(started[0].event.description, "Sur ordre de son gouvernement, Union soviétique déclare la guerre à Lituanie. À partir d'aujourd'hui, les deux pays sont en guerre.");
  assert.ok(eventDeclaresWar(started[0].event), "the ledger reads it as a declaration");
});

test("no second war when the world or an announcing event already has it; an order naming nobody is refused aloud", () => {
  const atWar = { ...world, wars: [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }] };
  assert.equal(planPlayerWars({ actions: orders(), world: atWar, player: "Soviet Union" }).started.length, 0);
  const announced = planPlayerWars({
    actions: orders(), world, player: "Soviet Union",
    warUpdates: [{ id: "w1", op: "start", actors: ["Soviet Union"], opponents: ["Lithuania"], eventIndexes: [0] }],
    events: [{ title: "L'Union soviétique déclare la guerre à la Lituanie", description: "" }],
  });
  assert.equal(announced.started.length, 0);
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
  assert.match(helper, /candidate\.events\.push\(\{ \.\.\.event, id \}\);/, "a new war: at the end, so cited indexes stay right");
  assert.match(helper, /insertEventAt\(candidate, \{ \.\.\.event, id \}, tied\.length \? Math\.min\(\.\.\.tied\) : candidate\.events\.length, EVENT_INDEX_DECODERS\)/);
  assert.match(helper, /noteReceipt\(receipt, "dropped", `The player's order/);
});

// Test F, 8–15 January: the model started the war on its offensive towards Kaunas.
const offensive = () => ({
  events: [
    { title: "Espagne : Tensions politiques", description: "Les partis s'affrontent avant les élections." },
    {
      title: "Lituanie : Offensive soviétique vers Kaunas",
      description: "Les forces soviétiques lancent une offensive majeure vers Kaunas. Les combats se concentrent autour des régions frontalières.",
      warId: "war-soviet-union-lithuania-1936",
      combatants: ["Soviet Union", "Lithuania"],
    },
  ],
  warUpdates: [{ id: "war-soviet-union-lithuania-1936", op: "start", actors: ["Soviet Union"], opponents: ["Lithuania"], eventIndexes: [1], eventIds: [], note: "" }],
  storylineUpdates: [{ id: "s1", op: "update", eventIndexes: [0, 1] }],
});

test("a war the answer started from an offensive gets its announcement, placed first, and keeps its id", () => {
  const candidate = offensive();
  const { started } = planPlayerWars({ actions: orders(), world, player: "Soviet Union", warUpdates: candidate.warUpdates, events: candidate.events, date: "1936-01-09", language: "fr" });
  assert.equal(started.length, 1);
  assert.equal(started[0].existing.id, "war-soviet-union-lithuania-1936");
  assert.equal(started[0].event.warId, "war-soviet-union-lithuania-1936");
  const at = insertEventAt(candidate, started[0].event, 1, {
    warUpdates: (value) => value,
    storylineUpdates: (value) => value,
  });
  assert.equal(at, 1);
  assert.equal(candidate.events[1].title, "Déclaration de guerre : Union soviétique contre Lituanie");
  assert.deepEqual(candidate.warUpdates[0].eventIndexes, [2], "the offensive moved one down, and its record with it");
  assert.deepEqual(candidate.storylineUpdates[0].eventIndexes, [0, 2]);
});

test("the ledger reads a French declaration and a French offensive, and not a diplomatic one", () => {
  assert.ok(eventDeclaresWar({ title: "Déclaration de guerre : Union soviétique contre Lituanie" }));
  assert.ok(eventDeclaresWar({ title: "L'URSS déclare la guerre à la Lituanie" }));
  assert.ok(!eventDeclaresWar({ title: "Lituanie : Offensive soviétique vers Kaunas" }));
  assert.ok(eventNarratesHardCombat(offensive().events[1]));
  assert.ok(!eventNarratesHardCombat({ title: "La France lance une offensive diplomatique", description: "Paris multiplie les démarches." }));
});

test("the whole of test F's answer now passes the war ledger", () => {
  const candidate = offensive();
  const { started } = planPlayerWars({ actions: orders(), world, player: "Soviet Union", warUpdates: candidate.warUpdates, events: candidate.events, date: "1936-01-09", language: "fr" });
  const at = insertEventAt(candidate, { ...started[0].event, id: "engine-war-3" }, 1, { warUpdates: (value) => value });
  candidate.warUpdates = candidate.warUpdates.map((record) => ({ ...record, eventIndexes: [at], eventIds: ["engine-war-3"] }));
  candidate.events = candidate.events.map((event, index) => ({ id: event.id ?? `e${index}`, date: "1936-01-09", ...event }));
  assert.equal(validateCanonicalWarEvents({ events: candidate.events, updates: candidate.warUpdates, world: { wars: [] } }), "");
});

test("the narrator is told only territorial refusals, and no region code reaches the page", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  assert.match(source, /const NARRATION_NOISE = \/could not be placed\|was malformed/);
  assert.match(source, /\.filter\(\(text\) => text && NARRATION_REFUSAL\.test\(text\) && !NARRATION_NOISE\.test\(text\)\)/);
  assert.match(source, /for \(const event of normalizeArray\(payload\?\.events\)\) scrubRegionCodes\(event, \{ nameOf: nameOfRegion \}\);/);
  assert.match(source, /buildNarrationItems\(events, \{ nameOf: regionNameLookup\(\) \}\)/);
});
