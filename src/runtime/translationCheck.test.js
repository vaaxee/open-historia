import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { countriesNamed, misalignedEntries, misalignedReason, textLanguage } from "./translationCheck.js";
import { translationsAligned } from "./translator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, ...parts), "utf8");

// Test F's pack, as it was: one batch shifted by a string, and the player's order reworded.
const SHIFTED = {
  "Counter-intelligence uncovers a Denmark agent": "Les services de contre-espionnage soviétiques ont identifié un agent travaillant pour la Hongrie. L'agent est en détention ; la décision de son utilisation revient à l'Union soviétique.",
  "Soviet Union's security service has identified an agent working for Denmark. The agent is in custody; how to use them is Soviet Union's decision.": "Lituanie : Tentative d'annexion pacifique par l'Union soviétique",
  "Lituanie : Tentative d'annexion pacifique par l'Union soviétique": "Réaction internationale à l'escalade soviétique en Lituanie",
  "Proposer de nouveau à la Finlande de céder l'isthme de Carélie, avec Vyborg, contre d'importantes livraisons de céréales et une garantie de frontière.": "Proposer à nouveau à la Finlande de céder l'isthme de Carélie, incluant Vyborg, en échange de livraisons massives de céréales et d'une garantie de frontière sécurisée.",
};
const GOOD = {
  "Counter-intelligence uncovers a Hungary agent": "Le contre-espionnage découvre un agent hongrois",
  "[Since your last reply: 4 January 2016 → 6 February 2016]": "[Depuis votre dernière réponse : 4 janvier 2016 → 6 février 2016]",
  "Declare war": "Déclarer la guerre",
  "Finlande : Réaffirmation du refus des propositions soviétiques": "Finlande : Réaffirmation du refus des propositions soviétiques",
};

test("test F's shifted pairs and the reworded order are recognised; real translations are not", () => {
  assert.deepEqual(misalignedEntries({ ...SHIFTED, ...GOOD }, "fr").sort(), Object.keys(SHIFTED).sort());
  assert.equal(misalignedReason(Object.keys(SHIFTED)[0], Object.values(SHIFTED)[0]), "it names other countries");
  assert.equal(misalignedReason(Object.keys(SHIFTED)[3], Object.values(SHIFTED)[3]), "the source was already in that language and came back changed");
  assert.equal(misalignedReason("Budget: 12 divisions", "Budget : 10 divisions"), "the numbers differ");
});

test("the language of a text, and the countries it names in any language", () => {
  assert.equal(textLanguage("Proposer à la Lettonie un pacte de non-agression et un accord commercial."), "fr");
  assert.equal(textLanguage("The agent is in custody; how to use them is the government's decision."), "en");
  assert.equal(textLanguage("Kaunas"), "");
  assert.deepEqual([...countriesNamed("un agent hongrois pour la Hongrie et le Danemark")].sort(), ["Denmark", "Hungary"]);
  assert.deepEqual([...countriesNamed("Soviet Union's security service")], ["Soviet Union"]);
});

test("an answer one string short is never used: the translator refuses it", () => {
  assert.equal(translationsAligned(["a", "b", "c"], ["x", "y", "z"]), true);
  assert.equal(translationsAligned(["a", "b", "c"], ["x", "z"]), false);
  const source = read("translator.js");
  assert.match(source, /if \(!translationsAligned\(strings, translations\)\) \{\r?\n\s+throw new Error/);
});

test("the caches drop misaligned pairs, text already in the player's language is not sent, and the player's orders are not translated", () => {
  const source = read("translator.js");
  assert.match(source, /\.filter\(\(\[source, translated\]\) => !misalignedReason\(source, translated, language\)\)\);/, "the browser's cache, on load");
  assert.match(source, /&& !misalignedReason\(source, translated, language\)\) \{/, "the server's pack, on merge");
  assert.match(source, /if \(textLanguage\(source\) === language\) \{\r?\n\s+cache\.set\(source, source\);/);
  assert.match(source, /const translated = answered && !misalignedReason\(source, answered, language\) \? answered : "";/);
  const actions = read("..", "Game", "GameUI", "actions.jsx");
  assert.equal((actions.match(/<div data-no-translate="" style=/g) ?? []).length, 2, "an order's title and text");
  assert.match(read("..", "..", "scripts", "i18n", "purge-misaligned.mjs"), /const write = process\.argv\.includes\("--write"\);/);
});
