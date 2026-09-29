// Phase 10 — la qualité de l'IA : moins de répétitions, un programme par
// puissance, des scènes interactives qui finissent, Jev qui recrute quand il le faut.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { isNearRepeat, jaccard, screenRepeats, wordsOf } from "./eventDedup.js";
import { INTERACTIVE_MAX_BEATS, beatsLeft, closingDirective, mustResolve } from "./interactiveLimit.js";
import { POWER_PROGRAMMES_1936, seedPolitics } from "./hoi/politics.js";
import { buildPoliticsPromptBlock, programmeOf } from "./hoi/politicsPrompt.js";
import { OUTNUMBERED_RATIO, decisionQuestions, decisionSheet, forceBalance } from "./hoi/localDecider.js";
import { templatesFor } from "./hoi/armies.js";
import { jevChoiceText } from "../Game/GameUI/frontsPanelText.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", ...parts), "utf8");

test("near-repeats: the same news in other words is dropped when it changes nothing; twins in one turn merge", () => {
  assert.ok(jaccard(wordsOf("La France appelle à la modération"), wordsOf("La France appelle de nouveau à la modération")) >= 0.6);
  const prior = [
    { date: "1936-01-06", title: "Réaction internationale et appels à la modération", description: "La France et le Royaume-Uni appellent à la modération dans le conflit.", source: "ai" },
    { date: "1935-06-01", title: "Appels à la modération internationale", description: "Vieux.", source: "ai" },
    { date: "1936-01-11", title: "Bataille de Rovno : prise", description: "Le moteur.", source: "engine" },
  ];
  const generated = [
    { date: "1936-01-12", title: "Appels internationaux à la modération", description: "La France et le Royaume-Uni appellent de nouveau à la modération dans le conflit.", source: "ai", impacts: {} },
    { date: "1936-01-12", title: "Appels internationaux à la modération", description: "Même chose, avec un effet.", source: "ai", impacts: { economyOps: [{ op: "stock" }] } },
    { date: "1936-01-13", title: "Mobilisation polonaise", description: "La Pologne mobilise ses réserves.", source: "ai", impacts: { unitOps: [{ op: "spawn" }] } },
    { date: "1936-01-13", title: "Mobilisation polonaise accrue", description: "La Pologne mobilise encore ses réserves.", source: "ai", impacts: { unitOps: [{ op: "move" }] } },
    { date: "1936-01-14", title: "Bataille de Rovno : prise", description: "Le moteur.", source: "engine" },
  ];
  const { kept, dropped, merged } = screenRepeats(prior, generated);
  assert.equal(dropped.length, 1, "the restatement with no effect");
  assert.equal(dropped[0].like.title, "Réaction internationale et appels à la modération");
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].into.impacts.unitOps.map((op) => op.op), ["spawn", "move"], "the twin's effects join the first");
  assert.deepEqual(kept.map((event) => event.title), ["Appels internationaux à la modération", "Mobilisation polonaise", "Bataille de Rovno : prise"], "an event with an effect is kept; engine events are never touched");
  assert.equal(isNearRepeat({ title: "Grève à Paris" }, { title: "Traité de Londres" }), false);
  const gameplay = read("Game", "AI", "gameplay.js");
  assert.match(gameplay, /const repeats = screenRepeats\(priorEvents, exactDeduped\);/);
  assert.match(gameplay, /const dedupedEvents = repeats\.kept;/);
});

test("an interactive scene ends: warned before its last exchange, resolved at it whatever the AI says", () => {
  assert.equal(INTERACTIVE_MAX_BEATS, 6);
  const history = (n) => Array.from({ length: n }, (_, i) => ({ choice: `c${i}`, summary: "s" }));
  assert.equal(beatsLeft(history(0)), 5);
  assert.equal(closingDirective(history(2)), "");
  assert.match(closingDirective(history(4)), /One exchange remains/);
  assert.match(closingDirective(history(5)), /LAST exchange/);
  assert.equal(mustResolve(history(4)), false);
  assert.equal(mustResolve(history(5)), true);
  const gameplay = read("Game", "AI", "gameplay.js");
  assert.match(gameplay, /interactiveChoice: `\$\{choiceText\}\$\{closingDirective\(interactive\.history\)\}`,/);
  assert.match(gameplay, /if \(!payload\?\.resolved && !mustResolve\(interactive\.history\)\) \{/);
});

test("every power of 1936 has its own programme, which the big AI reads and must serve, and Jev's sheet carries", () => {
  for (const power of ["Germany", "Soviet Union", "France", "United Kingdom", "United States", "Italy", "Imperialist Japan", "Kuomintang China", "Poland"]) {
    assert.ok(POWER_PROGRAMMES_1936[power].length > 40, power);
  }
  const hoi = { politics: { Germany: seedPolitics("Germany") }, jevMemory: {} };
  assert.match(programmeOf(hoi, "Germany"), /^Tear up Versailles/);
  assert.equal(programmeOf({ ...hoi, jevMemory: { Germany: { programme: "Make peace with Poland" } } }, "Germany"), "Make peace with Poland", "the AI's own programme wins");
  const block = buildPoliticsPromptBlock({ hoi: { ...hoi, nations: { Germany: {} } } }, "Germany", { forTurn: true });
  assert.match(block, /\n  Programme: Tear up Versailles/);
  assert.match(block, /Each AI power pursues its Programme above/);
  assert.match(decisionSheet("France", {}), /\nProgramme: Keep Germany contained without fighting alone/);
});

test("Jev is told when its divisions are too weak: the recruitment question comes first, with the odds, raising first", () => {
  const templates = templatesFor("1936");
  const division = (id) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 100, stateId: "x" });
  const armies = {
    Poland: { stockpile: { fusils: 2000, artillerie: 100 }, manpower: { available: 500000 }, divisions: [division("p1"), division("p2")] },
    "Soviet Union": { divisions: [division("s1"), division("s2"), division("s3"), division("s4"), division("s5")] },
  };
  assert.deepEqual(forceBalance("Poland", ["Soviet Union"], armies, templates), { own: 2, enemy: 5, ratio: 0.4 });
  assert.ok(0.4 < OUTNUMBERED_RATIO);
  const [recruit] = decisionQuestions("Poland", { armies, fronts: [], templates, enemiesOf: () => ["Soviet Union"] }).filter((q) => q.id === "recruit");
  assert.equal(recruit.importance, 3);
  assert.match(recruit.question, /Poland's army is too weak: 2 full divisions against 5 for its enemies \(0\.4 to 1\)/);
  assert.equal(recruit.options[0].text, "Raise three division d'infanteries");
  assert.equal(recruit.options[0].orders[0].op.count, 3);
  assert.equal(recruit.options.at(-1).text, "Recruit nothing and keep the stockpile", "keeping comes last");
  assert.equal(jevChoiceText("Raise three division d'infanteries", "fr"), "Lever trois divisions d'infanterie");
  // At peace, or strong enough: as before.
  const calm = decisionQuestions("Poland", { armies, fronts: [], templates, enemiesOf: () => [] }).find((q) => q.id === "recruit");
  assert.equal(calm.options[0].text, "Recruit nothing and keep the stockpile");
});
