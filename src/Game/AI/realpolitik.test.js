// Run: node --test src/Game/AI/realpolitik.test.js
//
// What these hold: the block carries all seven rules, names the leader and the
// date it speaks from, describes the channel by who is listening, never itself
// uses the assistant phrasing it forbids, and is appended exactly once.

import test from "node:test";
import assert from "node:assert/strict";

import { REALPOLITIK_MARKER, buildRealpolitikBlock, withRealpolitik } from "./realpolitik.js";

const block = buildRealpolitikBlock({ speaker: "French Republic", dateReadable: "12 March 1936", participants: ["Germany", "French Republic"] });

test("the block opens with its marker and speaks for the leader at the game's date", () => {
  assert.ok(block.startsWith(REALPOLITIK_MARKER));
  assert.match(block, /French Republic/);
  assert.match(block, /12 March 1936/);
});

test("all seven rules are present, in order", () => {
  const numbers = [...block.matchAll(/^(\d)\. /gm)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7]);
});

test("each rule says what it is for", () => {
  assert.match(block, /interest.*risks.*cost.*denied.*doctrine/s, "rule 1: the criteria");
  assert.match(block, /Modern morality is not a criterion/, "rule 1: not modern morality");
  assert.match(block, /Assassination, coups, sabotage, false-flag operations and espionage/, "rule 2: the instruments");
  assert.match(block, /Never condemn them in moral terms and never dismiss them as fantasy/, "rule 2: no condemnation");
  for (const move of ["evade", "stall", "conditions", "counter-offer", "intelligence services", "agree in secret", "refuse", "leak"]) {
    assert.ok(block.includes(move), `rule 3: ${move}`);
  }
  assert.match(block, /official channel a diplomat stays guarded and allusive/, "rule 4");
  assert.match(block, /informal sounding-out is not an act of war/, "rule 5");
  assert.match(block, /No moral lectures, no modern vocabulary, no assistant phrasing/, "rule 6");
  assert.match(block, /settled by the game's turns, not by your reply/, "rule 7");
});

test("the channel follows who is in the thread", () => {
  assert.match(block, /correspondence between two governments/);
  const group = buildRealpolitikBlock({ speaker: "Italy", participants: ["Italy", "Germany", "Japan"] });
  assert.match(group, /multilateral exchange: Italy, Germany, Japan all read every word/);
});

test("the block never uses the phrasing it forbids", () => {
  const withoutRule6 = block.split("\n").filter((line) => !line.startsWith("6. ")).join("\n");
  for (const phrase of [/as an ai/i, /I'm sorry/i, /unethical/i, /immoral/i, /I cannot help/i]) {
    assert.doesNotMatch(withoutRule6, phrase);
  }
});

test("missing context still gives a usable block", () => {
  const bare = buildRealpolitikBlock();
  assert.match(bare, /your government/);
  assert.match(bare, /present date of the game/);
});

test("the block is appended once, and not at all if the prompt already carries it", () => {
  const once = withRealpolitik("Leader prompt.", { speaker: "Italy" });
  assert.ok(once.startsWith("Leader prompt.\n\n[Realpolitik]"));
  assert.equal(withRealpolitik(once, { speaker: "Italy" }), once);
  assert.equal((once.match(/\[Realpolitik\]/g) || []).length, 1);
});
