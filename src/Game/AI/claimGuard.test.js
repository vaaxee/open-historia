import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  assertsCapitulation,
  assertsChangeOfHands,
  detectLanguage,
  guardRefusedTerritory,
  rewriteAsAttempt,
  toldAsFailure,
} from "./claimGuard.js";

// The field report's event (1936-01-15), as the model wrote it.
const fallOfVilnius = () => ({
  date: "1936-01-15",
  title: "Lituanie : Chute de Vilnius et reddition sans conditions",
  description: "Les forces soviétiques, après une avancée rapide et décisive, prennent le contrôle de Vilnius, la capitale lituanienne. Le gouvernement lituanien capitule sans conditions.",
});

test("a change of hands and a surrender are recognised in several languages", () => {
  assert.ok(assertsChangeOfHands("Lituanie : Chute de Vilnius et reddition sans conditions"));
  assert.ok(assertsChangeOfHands("Les forces soviétiques prennent Vilnius"));
  assert.ok(assertsChangeOfHands("Soviet troops capture Vilnius"));
  assert.ok(assertsChangeOfHands("Vilnius est tombée"));
  assert.ok(assertsChangeOfHands("Deutschland erobert Memel"));
  assert.ok(assertsChangeOfHands("Caída de Kaunas"));
  assert.ok(!assertsChangeOfHands("Espagne : Tensions politiques avant les élections de février"));
  assert.ok(assertsCapitulation("Le gouvernement lituanien capitule sans conditions"));
  assert.ok(assertsCapitulation("Lithuania surrenders"));
  assert.ok(!assertsCapitulation("Soviet troops capture Vilnius"));
  assert.ok(toldAsFailure("Tentative d'annexion pacifique qui échoue"));
  assert.ok(toldAsFailure("The attempt to seize Memel fails"));
});

test("the event's language is recognised to word the engine's sentence", () => {
  const event = fallOfVilnius();
  assert.equal(detectLanguage(`${event.title} ${event.description}`), "fr");
  assert.equal(detectLanguage("The Soviet army takes the city of Vilnius and the government of Lithuania flees"), "en");
});

test("a refused capture is rewritten as a failed attempt, in French, keeping the original out of sight", () => {
  const event = { ...fallOfVilnius(), impacts: { regionTransfers: [] } };
  const refused = [{ path: "$.events[0].impacts", label: "Vilnius", ownerMismatch: { regionName: "Vilnius", actualOwner: "Poland" }, fromCode: "Lithuania" }];
  const notes = guardRefusedTerritory([{ event, impacts: event.impacts, path: "$.events[0].impacts" }], refused, {
    describe: (entry) => `${entry.ownerMismatch.regionName} belongs to ${entry.ownerMismatch.actualOwner}, not to ${entry.fromCode}`,
  });
  assert.equal(event.title, "Tentative : Lituanie : Chute de Vilnius et reddition sans conditions");
  assert.match(event.description, /n'a PAS eu lieu : le moteur l'a refusé \(Vilnius belongs to Poland, not to Lithuania\)/);
  assert.match(event.description, /aucune frontière ne bouge et aucun gouvernement ne capitule/);
  assert.doesNotMatch(event.description, /prennent le contrôle/);
  assert.equal(event.rewrittenFrom.title, "Lituanie : Chute de Vilnius et reddition sans conditions");
  assert.equal(notes.length, 1);
  assert.match(notes[0], /This did NOT happen: no border moved/);
});

test("a capitulation with no territorial operation at all is rewritten too", () => {
  const event = { ...fallOfVilnius(), impacts: {} };
  const notes = guardRefusedTerritory([{ event, impacts: event.impacts, path: "$.events[0].impacts" }], []);
  assert.match(event.title, /^Tentative : /);
  assert.match(notes[0], /announced a capitulation with no territorial operation behind it/);
});

test("nothing is rewritten when everything was applied, when the text is already a failure, or when it claims nothing", () => {
  const applied = { ...fallOfVilnius(), impacts: { regionTransfers: [{ regionId: "imp-rgb-0066DD", toCode: "Soviet Union" }] } };
  const failure = { title: "Tentative d'annexion de la Lituanie", description: "L'Union soviétique tente d'annexer la Lituanie, mais la tentative échoue.", impacts: {} };
  const quiet = { title: "Espagne : Tensions avant les élections", description: "Les partis s'affrontent.", impacts: {} };
  const containers = [applied, failure, quiet].map((event, index) => ({ event, impacts: event.impacts, path: `$.events[${index}].impacts` }));
  // Refusals only for the failure and the quiet event: the applied one had none.
  const notes = guardRefusedTerritory(containers, [{ path: "$.events[1].impacts", label: "x" }, { path: "$.events[2].impacts", label: "x" }]);
  assert.equal(notes.length, 0);
  assert.equal(applied.title, fallOfVilnius().title);
  assert.equal(failure.title, "Tentative d'annexion de la Lituanie");
  assert.equal(quiet.title, "Espagne : Tensions avant les élections");
});

test("an event enacted in part keeps its story and says which part did NOT happen", () => {
  const event = {
    title: "Les Soviétiques prennent Vilnius et Kaunas",
    description: "L'Armée rouge occupe Kaunas et avance sur Vilnius.",
    impacts: { regionControlOps: [{ op: "control", regionId: "imp-rgb-BB33CC", toCode: "Soviet Union" }] },
  };
  const notes = guardRefusedTerritory([{ event, impacts: event.impacts, path: "p" }], [{ path: "p", label: "Vilnius" }], {
    describe: () => "Vilnius belongs to Poland, not to Lithuania",
  });
  assert.equal(event.title, "Les Soviétiques prennent Vilnius et Kaunas");
  assert.match(event.description, /^L'Armée rouge occupe Kaunas et avance sur Vilnius\. Le moteur a refusé une partie de ces changements \(Vilnius belongs to Poland, not to Lithuania\) : cette partie n'a PAS eu lieu/);
  assert.match(notes[0], /enacted only in part/);
});

test("the English wording for an English event", () => {
  const event = rewriteAsAttempt({ title: "Soviet troops capture Vilnius", description: "The Red Army takes the city and the Lithuanian government flees to the west." }, { reasons: "Vilnius belongs to Poland" });
  assert.equal(event.title, "Attempted: Soviet troops capture Vilnius");
  assert.match(event.description, /did NOT happen: the engine refused it \(Vilnius belongs to Poland\)/);
});

test("the guard runs on every simulated turn after the refusals are known, never on a Game Master edit", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  const start = source.indexOf("export const validateGeneratedWorldChanges");
  const controlOps = source.indexOf("const unresolvedControlOps = await resolveRegionControlOps(", start);
  const guard = source.indexOf("guardRefusedTerritory(containers, refused", start);
  assert.ok(controlOps > start && guard > controlOps, "after both resolvers");
  assert.match(source.slice(controlOps, guard), /if \(captureGuard && Array\.isArray\(candidate\?\.events\)\)/);
  assert.match(source.slice(guard, guard + 200), /noteReceipt\(receipt, "withheld", note\)/);
});
