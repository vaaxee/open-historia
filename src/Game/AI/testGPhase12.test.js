// Test G après les phases 8 à 12 : la déclaration de guerre racontée, les
// revendications sur sa propre terre, le français (focus, noms de pays), « d'une
// tâche » et la tâche de départ nommée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { applyNarration, buildNarrationItems, refusalsStillStanding } from "./validatedNarration.js";
import { isOwnClaim } from "./claimHolderCheck.js";
import { FRENCH_SCENARIO_ROWS, frenchPolityName, frenchPolityWithArticle } from "../../runtime/polityExonyms.js";
import { describeBusy, frenchDe, frontsPanelWords } from "../GameUI/frontsPanelText.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", ...parts), "utf8");

const declaration = () => ({
  date: "1936-01-02",
  title: "L'Union soviétique déclare la guerre à la Pologne sans soutien international",
  description: "Staline annonce que l'Union soviétique déclare la guerre à la Pologne.",
  warId: "soviet-polish-war-1936",
  impacts: {},
});
const wars = [{ id: "soviet-polish-war-1936", op: "start", actors: ["Soviet Union"], opponents: ["Poland"], eventIndexes: [0] }];

test("the player's restored war: told to the narrator, its old refusal withdrawn, its declaration kept", () => {
  const [item] = buildNarrationItems([declaration()], { wars });
  assert.deepEqual(item.appliedChanges, ["Soviet Union and Poland are at war from this event on (the war is declared and applied)"]);
  const refusals = [
    "War ledger: 1 war record(s) were dropped (soviet-polish-war-1936) and 1 event(s) lost their war binding",
    "Event \"X\": a transfer of Lwów was refused",
  ];
  assert.deepEqual(refusalsStillStanding(refusals, wars), [refusals[1]]);
  // Game G, 1–8 January: the narrator turned the declaration into claims.
  const events = [declaration()];
  const claims = { events: [{ index: 0, title: "L'Union soviétique revendique des territoires polonais sans succès immédiat", description: "Le gouvernement soviétique revendique Kharkiv." }] };
  assert.equal(applyNarration(events, claims, { wars }), 0);
  assert.match(events[0].title, /déclare la guerre/);
  // A rewrite that still declares the war is taken.
  const kept = { events: [{ index: 0, title: "L'Union soviétique déclare la guerre à la Pologne", description: "Moscou déclare la guerre à la Pologne ; aucun combat encore." }] };
  assert.equal(applyNarration(events, kept, { wars }), 1);
  // Without a standing war, a declaration may still be told as a threat.
  const lone = [{ ...declaration(), warId: "" }];
  assert.equal(applyNarration(lone, claims, { wars: [] }), 1);
});

test("a country's claim on its own region is removed before the story is written", () => {
  assert.equal(isOwnClaim({ holder: "Soviet Union", claimant: "Soviet Union" }), true);
  assert.equal(isOwnClaim({ holder: "Poland", claimant: "Soviet Union" }), false);
  assert.equal(isOwnClaim({ holder: "", claimant: "Soviet Union" }), false, "an unknown holder is left to the other checks");
  const gameplay = read("AI", "gameplay.js");
  const drop = gameplay.indexOf("for (const own of dropOwnClaims(containers, world)) {");
  assert.ok(drop > 0 && drop < gameplay.indexOf("const claimProblems = checkClaimsAgainstHolders(containers, world);"));
  assert.match(gameplay, /const standing = refusalsStillStanding\(refusals, wars\);/);
  assert.match(gameplay, /applyNarration\(events, response\?\.payload, \{ wars \}\)/);
});

test("French: every scenario country has its French name and article; the focus button is protected", () => {
  for (const [english, french] of FRENCH_SCENARIO_ROWS) assert.equal(frenchPolityName(english), french);
  assert.equal(frenchPolityName("Guangdong Clique"), "Clique du Guangdong");
  assert.equal(frenchPolityName("Dominion of Canada"), "Canada");
  assert.equal(frenchPolityName("Belgian Congo"), "Congo belge");
  assert.equal(frenchPolityWithArticle("Guangdong Clique", "de"), "de la Clique du Guangdong");
  assert.equal(frenchPolityWithArticle("Belgian Congo", "à"), "au Congo belge");
  assert.equal(frenchPolityWithArticle("Ecuador", "de"), "de l'Équateur");
  assert.equal(frenchPolityWithArticle("Cuba", "à"), "à Cuba");
  assert.equal(frenchPolityName("Germany"), "Allemagne", "the older rows still hold");
  assert.match(read("GameUI", "focusPolitics.jsx"), /<button type="button" data-no-translate="" title=\{title\} aria-label=\{title\}/);
  assert.match(read("GameUI", "focusPolitics.jsx"), /focus: "Focus national"/);
  assert.match(read("GameUI", "MilitaryStats.jsx"), /"Focus national" : "National focus"/);
});

test("« d'une tâche », and the task that held the game at its start has a name", () => {
  assert.equal(frenchDe("une tâche en arrière-plan"), "d'une tâche en arrière-plan");
  assert.equal(frenchDe("l'avance du temps"), "de l'avance du temps");
  assert.equal(frenchDe("le tour retenu"), "du tour retenu");
  assert.equal(frenchDe("la console MJ"), "de la console MJ");
  assert.equal(frontsPanelWords("fr").waiting(describeBusy(["task"], "fr")), "En attente de la fin d'une tâche en arrière-plan ; votre ordre sera appliqué ensuite.");
  assert.equal(describeBusy(["maybeGeneratePregameHistory"], "fr"), "l'histoire d'avant la partie");
  assert.equal(describeBusy(["maybeGeneratePregameHistory"], "en"), "the history before the game starts");
  // Every function that takes the simulation lock has a name in both languages.
  const gameplay = read("AI", "gameplay.js").split(/\r?\n/);
  const holders = new Set();
  let current = "";
  for (const line of gameplay) {
    const declared = line.match(/^(?:export )?const (\w+) = async/);
    if (declared) current = declared[1];
    if (/^\s+beginSimulation\(\);/.test(line)) holders.add(current);
  }
  assert.ok(holders.size >= 10);
  for (const name of holders) {
    assert.notEqual(describeBusy([name], "fr"), "une tâche en arrière-plan", name);
    assert.notEqual(describeBusy([name], "en"), "a background task", name);
  }
});
