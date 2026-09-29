// Test G avec Mistral (1er–15 janvier 1936) : deux tours en mode secours. Les
// deux réponses réelles (fixtures/) : la liste `events` mal fermée ; un ordre du
// joueur annulé par l'IA ; l'histoire d'avant-partie qui échouait sur « League
// of Nations » ; les astérisques du markdown dans le texte traduit.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { salvageBySchema } from "./schemaSalvage.js";
import { liftEventLedgers, liftMisplacedFields, misplacedFieldsHint } from "./misplacedFields.js";
import { ordersReversedBy, removeEventAt } from "./playerWarOrders.js";
import { decodeWarUpdates } from "./nativeWarLedger.js";
import { describePrunedActors, pruneUnknownActors } from "./pregameActors.js";
import { stripAddedMarkdown } from "../../runtime/translator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const fixture = (date) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", `mistral-unclosed-events-${date}.json`), "utf8"));
const read = (...parts) => fs.readFileSync(path.join(here, "..", ...parts), "utf8");
const order = { id: "action-0-mun26e14-jav7szc", kind: "action", status: "planned", title: "Déclarer la guerre à la Pologne.", text: "Déclarer la guerre à la Pologne." };

test("the two real answers: the fields written inside `events` go back to the object, and the turn validates", () => {
  const first = fixture("1936-01-08");
  assert.equal(validateGameplayPayload("jumpForward", first).error, "$.stopDate is required.", "the real fault");
  const repaired = normalizeGameplayPayload("jumpForward", first);
  assert.equal(repaired.events.length, 2);
  assert.equal(repaired.stopDate, "1936-01-08");
  assert.equal(repaired.clearActions, true);
  assert.match(repaired.summary, /^La semaine a été marquée/);
  assert.deepEqual(validateGameplayPayload("jumpForward", repaired), { valid: true, error: "" });
  // The player's war, written inside the event, reaches the ledger.
  assert.deepEqual(decodeWarUpdates(repaired.warUpdates).map((war) => [war.id, war.op, war.actors, war.opponents]), [["war-soviet-poland-1936", "start", ["Soviet Union"], ["Poland"]]]);
  assert.equal(repaired.events[0].warUpdates, undefined);

  const second = normalizeGameplayPayload("jumpForward", fixture("1936-01-15"));
  assert.equal(second.stopDate, "1936-01-15");
  const salvaged = salvageBySchema(structuredClone(second), (candidate) => validateGameplayPayload("jumpForward", candidate));
  assert.equal(salvaged.valid, true);
  assert.deepEqual(salvaged.removed.map((entry) => entry.path), ["$.events[1].impacts.tags"]);
});

test("the repair touches nothing else, and the retry names the exact fault", () => {
  const clean = { events: [{ title: "a" }], stopDate: "1936-01-08" };
  assert.deepEqual(liftMisplacedFields(clean), { value: clean, lifted: [] });
  const odd = { events: [{ title: "a" }, "stopDate: "] };
  assert.deepEqual(liftMisplacedFields(odd).lifted, [], "an unpaired tail is left for the retry");
  assert.match(misplacedFieldsHint(odd), /"stopDate" were written as strings INSIDE "events".*Close "events" with "\]" after its last event object/);
  assert.deepEqual(liftMisplacedFields({ events: [{}, "stopDate: ", "x"], stopDate: "1936-02-01" }).value.stopDate, "1936-02-01", "an existing field wins");
  assert.deepEqual(liftEventLedgers({ events: [{ title: "a", relationUpdates: "A~B~-10" }], relationUpdates: "C~D~5" }).value.relationUpdates, "C~D~5\nA~B~-10");
  const gameplay = read("AI", "gameplay.js");
  assert.match(gameplay, /failed validation: \$\{validation\.error\} \$\{misplacedFieldsHint\(parsed\)\}/);
  // No fallback before a second request, even with the skip's budget spent.
  assert.match(gameplay, /const mustRetry = outputAttempt === 2 && !salvageCandidate && \["jumpForward", "autoJumpForward"\]\.includes\(taskKey\);/);
  assert.match(gameplay, /if \(budget && !budget\.take\(.*\) && !mustRetry\) \{/);
});

test("the AI never undoes a player's order: the real cancellation is caught, the real declaration is not", () => {
  const [cancel, italy] = normalizeGameplayPayload("jumpForward", fixture("1936-01-15")).events;
  assert.deepEqual(ordersReversedBy(cancel, [order]), ["Déclarer la guerre à la Pologne."]);
  assert.deepEqual(ordersReversedBy(italy, [order]), []);
  const [declaration] = normalizeGameplayPayload("jumpForward", fixture("1936-01-08")).events;
  assert.deepEqual(ordersReversedBy(declaration, [order]), [], "carrying the order out is not undoing it");
  assert.deepEqual(ordersReversedBy(cancel, [{ ...order, status: "resolved" }]), [], "only orders still planned");
  // Without actionIds, cancelling the declared war is still caught.
  assert.deepEqual(ordersReversedBy({ title: "Moscou retire sa déclaration de guerre", description: "" }, [order]), [order.title]);
  assert.deepEqual(ordersReversedBy({ title: "La Pologne refuse l'ultimatum", description: "", impacts: { actionIds: [order.id] } }, [order]), [], "the enemy refusing is a consequence");
  // Removed with the records that point at events by number.
  const candidate = { events: [{ title: "a" }, { title: "b" }, { title: "c" }], warUpdates: [{ id: "w1", op: "start", actors: ["A"], opponents: ["B"], eventIndexes: [1] }, { id: "w2", op: "start", actors: ["C"], opponents: ["D"], eventIndexes: [2] }] };
  removeEventAt(candidate, 1, { warUpdates: decodeWarUpdates });
  assert.deepEqual(candidate.events.map((event) => event.title), ["a", "c"]);
  assert.deepEqual(candidate.warUpdates.map((war) => [war.id, war.eventIndexes]), [["w2", [1]]]);
  const gameplay = read("AI", "gameplay.js");
  assert.match(gameplay, /cancels, refuses or reverses the player's order/);
  assert.match(gameplay, /removeEventAt\(candidate, index, EVENT_INDEX_DECODERS\);/);
});

test("pregame history: an actor that is not a country is left out, not the whole generation", () => {
  const known = new Set(["France", "United Kingdom", "Italy", "Ethiopia", "Germany"]);
  const { ledgers, notes } = pruneUnknownActors({
    agreementUpdates: [{ id: "league", parties: ["League of Nations", "France", "United Kingdom"] }, { id: "sanctions", parties: ["League of Nations", "Italy"] }],
    warUpdates: [{ id: "abyssinia", op: "start", actors: ["Italy"], opponents: ["Ethiopia", "League of Nations"] }],
    relationUpdates: [{ a: "League of Nations", b: "Germany" }, { a: "France", b: "Germany" }],
    storylineUpdates: [{ id: "s", participants: ["Italy", "League of Nations"] }],
  }, (name) => known.has(name));
  assert.deepEqual(ledgers.agreementUpdates.map((record) => [record.id, record.parties]), [["league", ["France", "United Kingdom"]]]);
  assert.deepEqual(ledgers.warUpdates[0].opponents, ["Ethiopia"]);
  assert.deepEqual(ledgers.relationUpdates, [{ a: "France", b: "Germany" }]);
  assert.deepEqual(ledgers.storylineUpdates[0].participants, ["Italy"]);
  assert.equal(notes.length, 5);
  assert.match(describePrunedActors(notes[1]), /"League of Nations" is not a country on this map and was left out; the record, left without enough countries, was dropped\./);
  const gameplay = read("AI", "gameplay.js");
  const prune = gameplay.indexOf("prunePregameActors(candidate, { world, canonicalPolities });");
  assert.ok(prune > 0 && prune < gameplay.indexOf("const polityError = validatePregamePolityVocabulary(candidate, { world, canonicalPolities });"));
});

test("the translator's added markdown is removed; the source's own is kept", () => {
  assert.equal(stripAddedMarkdown("Soviet Union: order not yet carried out", "**Union soviétique** : ordre *pas encore* exécuté"), "Union soviétique : ordre pas encore exécuté");
  assert.equal(stripAddedMarkdown("plain", "__souligné__ et 2 * 3 = 6"), "souligné et 2 * 3 = 6");
  assert.equal(stripAddedMarkdown("**bold** source", "**gras** traduit"), "**gras** traduit");
  assert.match(read("..", "runtime", "translator.js"), /stripAddedMarkdown\(source, result\.translations\[index\]\)/);
});
