import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { declaresWar, insertEventAt, planPlayerWars, warOrderTarget } from "./playerWarOrders.js";
import { decodeWarUpdates, eventDeclaresWar, eventNarratesHardCombat, reconcileCombatWarState, validateCanonicalWarEvents } from "./nativeWarLedger.js";

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
  // Test G avec Jev : avec leurs articles.
  assert.equal(started[0].event.title, "Déclaration de guerre : l'Union soviétique contre la Lituanie");
  assert.equal(started[0].event.description, "Sur ordre de son gouvernement, l'Union soviétique déclare la guerre à la Lituanie. À partir d'aujourd'hui, les deux pays sont en guerre.");
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
  // Test F, 22–29 January: the declaration dated the 23rd came last, after the 28th.
  assert.match(helper, /const dated = candidate\.events\.findIndex\(\(entry\) => normalizeString\(entry\?\.date\) >= normalizeString\(event\.date\)\);/, "a new war: at its date, ahead of that day's events");
  assert.match(helper, /insertEventAt\(candidate, \{ \.\.\.event, id \}, dated < 0 \? candidate\.events\.length : dated, EVENT_INDEX_DECODERS\)/, "and every record citing events by number moves along");
  assert.match(helper, /insertEventAt\(candidate, \{ \.\.\.event, id \}, tied\.length \? Math\.min\(\.\.\.tied\) : candidate\.events\.length, EVENT_INDEX_DECODERS\)/);
  assert.match(helper, /announcer\.warId = war\.id;/, "an answer's own declaration carries the war, with no second announcement");
  assert.match(helper, /noteReceipt\(receipt, "dropped", `The player's order/);
});

test("the engine's declaration goes in at its date and the answer's records follow it", () => {
  const candidate = {
    events: [
      { date: "1936-01-23", title: "Lituanie : Échec de la mobilisation soviétique à Kaunas" },
      { date: "1936-01-28", title: "Italie : Proposition de médiation" },
    ],
    storylineUpdates: [{ id: "s1", eventIndexes: [0, 1] }],
  };
  const at = insertEventAt(candidate, { date: "1936-01-23", title: "Déclaration de guerre : Union soviétique contre Lituanie" }, 0, { storylineUpdates: (value) => value });
  assert.equal(at, 0);
  assert.deepEqual(candidate.events.map((event) => event.date), ["1936-01-23", "1936-01-23", "1936-01-28"]);
  assert.deepEqual(candidate.storylineUpdates[0].eventIndexes, [1, 2]);
});

// Test F, 22–29 January: "Lituanie : Déclaration de guerre soviétique et avancée…"
// had no war record, the engine added its own announcement beside it, and the
// ledger made a second war out of the first.
test("an answer that tells the declaration without a war record carries the player's war itself", () => {
  const events = [
    { title: "Lituanie : Déclaration de guerre soviétique et avancée vers Kaunas", description: "L'Union soviétique déclare la guerre à la Lituanie." },
    { title: "Italie : Proposition de médiation", description: "" },
  ];
  const { started } = planPlayerWars({ actions: orders(), world, player: "Soviet Union", events, date: "1936-01-23", language: "fr" });
  assert.equal(started.length, 1);
  assert.equal(started[0].announcer, 0);
  assert.equal(started[0].event, null, "no engine announcement beside the answer's own");
  const other = planPlayerWars({ actions: orders(), world, player: "Soviet Union", events: [events[1]], date: "1936-01-23" });
  assert.equal(other.started[0].announcer, undefined);
  assert.ok(other.started[0].event, "none in the answer: the engine announces it");
});

test("a combat event naming a war the ledger does not know joins the one war between its sides", () => {
  const candidate = {
    events: [
      { id: "e0", date: "1936-01-23", title: "Déclaration de guerre : Union soviétique contre Lituanie", warId: "war-a" },
      {
        id: "e1", date: "1936-01-23", title: "Lituanie : bataille de Kaunas",
        description: "Les combats font rage autour de Kaunas.", warId: "war-soviet-union-lithuania-1936-01-16",
        combatants: ["Soviet Union", "Lithuania"],
      },
    ],
    warUpdates: [{ id: "war-a", op: "start", actors: ["Soviet Union"], opponents: ["Lithuania"], eventIndexes: [0], eventIds: ["e0"] }],
  };
  const repair = reconcileCombatWarState(candidate, { world: { wars: [] } });
  assert.equal(repair.started, 0, "no second war");
  assert.equal(candidate.events[1].warId, "war-a");
  assert.equal(decodeWarUpdates(candidate.warUpdates).length, 1);
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
  assert.equal(candidate.events[1].title, "Déclaration de guerre : l'Union soviétique contre la Lituanie");
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
  assert.match(source, /buildNarrationItems\(events, \{ nameOf: regionNameLookup\(\), wars \}\)/);
});

// Test F, 15–22 January: the answer's own war read "URSS" against "Lituanie"; the
// engine did not see it, started a second one, and the ledger dropped both.
test("the answer's war is recognised whatever language names its sides", () => {
  const warUpdates = [{ id: "war-urss-lituanie", op: "start", actors: ["URSS"], opponents: ["Lituanie"], eventIndexes: [0] }];
  const unannounced = planPlayerWars({ actions: orders(), world, player: "Soviet Union", warUpdates, events: [{ title: "Avancée soviétique vers Kaunas", description: "" }], date: "1936-01-16", language: "fr" });
  assert.equal(unannounced.started.length, 1);
  assert.equal(unannounced.started[0].existing.id, "war-urss-lituanie", "the answer's war, not a second one");
  assert.deepEqual([unannounced.started[0].war.actors, unannounced.started[0].war.opponents], [["Soviet Union"], ["Lithuania"]], "named as the map spells them");
  const announcedByAnswer = planPlayerWars({ actions: orders(), world, player: "Soviet Union", warUpdates, events: [{ title: "L'URSS déclare la guerre à la Lituanie", description: "" }] });
  assert.equal(announcedByAnswer.started.length, 0);
  assert.deepEqual(announcedByAnswer.announced.map((entry) => entry.id), ["war-urss-lituanie"], "kept, and protected as the player's");
});

test("a war the player declared survives the ledger's salvage, and conquests stand only on kept wars", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  const ledger = source.slice(source.indexOf("const validateSegmentLedgers = "), source.indexOf("// One segment's storyline records, after its ledgers."));
  assert.match(ledger, /if \(playerWarIds\.has\(normalizeString\(update\?\.id\)\)\) return;/, "never an orphan of another event's combat");
  assert.match(ledger, /if \(!warError && !strict\) restorePlayerWars\(candidate, \{ world, receipt \}\);/, "put back after the salvage");
  const restore = source.slice(source.indexOf("const restorePlayerWars = "), source.indexOf("const addPlayerWars = "));
  assert.match(restore, /if \(error && error\.includes\(`\$\{record\.id\} \(start\)`\)\) \{/, "undone only if the player's war itself is refused");
  assert.match(restore, /return \{ \.\.\.entry, warId: record\.id \};/, "the fighting between the two is bound to it");
  const segment = source.indexOf("const ledgerError = validateSegmentLedgers(candidate, { world: ledgerWorld, strict, segmentIndex, receipt: draft });");
  const recheck = source.indexOf("for (const note of recheckControlAgainstLedger(candidate, ledgerWorld)) noteReceipt(draft, \"dropped\", note);", segment);
  assert.ok(segment > 0 && recheck > segment, "control operations are checked again once the ledger has spoken");
  assert.match(source, /enforceWarRules\(containers, candidate, world, \{ \.\.\.warRules, isCoastal: await coastLookup\(world\) \}\)/);
});
