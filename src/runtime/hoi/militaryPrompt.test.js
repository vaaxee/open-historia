import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { buildMilitaryPromptBlock, describeArmyLine, describeFronts } from "./militaryPrompt.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", ...parts), "utf8");
const inf = (id, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 80, stateId: "x", ...extra });
const world = {
  wars: [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }],
  hoi: {
    series: "1936",
    armies: {
      "Soviet Union": { stockpile: { fusils: 500, fournitures: 120 }, manpower: { available: 1500000 }, divisions: [inf("s1"), inf("s2", { encircledDays: 5 }), inf("s3", { supply: 0.3 })] },
      Lithuania: { manpower: { available: 60000 }, divisions: [inf("l1", { men: 5000 })] },
      Bahrain: { divisions: [inf("b1")] },
    },
    fronts: [{ id: "f", owner: "Soviet Union", enemy: "Lithuania", posture: "breakthrough", axis: "kaunas", divisionIds: ["s1"] }],
    lastBattles: [{ date: "1936-01-10", stateName: "Kaunas", attacker: "Soviet Union", defender: "Lithuania", posture: "breakthrough", garrison: false, terrain: "plaine", factors: { terrain: 1, dice: 1.05 }, power: { attack: 6, defense: 1.2 }, result: "captured", losses: { attacker: 600, defender: 1400 }, retreatTo: "Alytus" }],
  },
};

test("an army in a line: divisions by template and strength, organisation, manpower, reserve, supply", () => {
  assert.equal(
    describeArmyLine(world.hoi, "Soviet Union"),
    "- Soviet Union: 3 infanterie (100%), organisation 80; manpower 1,500,000; reserve fusils 500, fournitures 120; supply: 1 division(s) encircled, 1 poorly supplied.",
  );
  assert.equal(describeArmyLine(world.hoi, "Lithuania"), "- Lithuania: 1 infanterie (50%), organisation 80; manpower 60,000.");
  assert.equal(describeFronts(world.hoi, { nameOf: (id) => (id === "kaunas" ? "Kaunas" : id) }), "- Soviet Union against Lithuania: breakthrough, axis Kaunas, 1 division(s).");
});

test("the turn's block: every army at war first, the fronts, last turn's battles, this period's engine battles and how the AI fights", () => {
  const block = buildMilitaryPromptBlock(world, "Soviet Union", { others: 2, forTurn: true, battles: world.hoi.lastBattles });
  const lines = block.split("\n");
  assert.equal(lines[0], "[ARMIES — computed by the engine]");
  assert.match(lines[1], /^- Soviet Union:/);
  assert.match(lines[2], /^- Lithuania:/, "the enemy at war comes before Bahrain");
  assert.match(block, /Battles of the last turn:\n- 1936-01-10 Kaunas: Soviet Union \(breakthrough\) against Lithuania/);
  assert.match(block, /Battles of THIS period, already decided by the engine/);
  assert.match(block, /economyOps front \(polity, enemy at war, posture hold\/attack\/breakthrough, count of divisions to send\)/);
  assert.equal(buildMilitaryPromptBlock({}, "Soviet Union"), "", "no armies, no block");
});

test("a foreign leader sees its own forces and its own fronts, never another army's detail", () => {
  const block = buildMilitaryPromptBlock(world, "Lithuania", { others: 0 });
  assert.match(block, /^\[ARMIES — computed by the engine\]\n- Lithuania:/);
  assert.doesNotMatch(block, /- Soviet Union: \d/);
  assert.match(block, /Soviet Union against Lithuania/, "the front it faces");
  assert.doesNotMatch(block, /economyOps/, "no instructions to a leader");
});

test("wired: the turn, the advisor and the leaders get the block; the engine's battles are resolved before the AI writes", () => {
  const gameplay = read("Game", "AI", "gameplay.js");
  const combat = gameplay.indexOf("const engineCombat = await resolveCombatForJump(bundle, { originDate, days: dateStep, orders: localDecisions?.orders });");
  const variables = gameplay.indexOf("const variables = await buildTemplateVariables({ ...bundle, ...(proposals.actions ? { actions: proposals.actions } : {}), engineCombat, enginePolitics }, {");
  assert.ok(combat > 0 && variables > combat, "resolved first, then handed to the prompt");
  assert.match(gameplay, /if \(segmentIndex === 0\) addEngineBattles\(candidate, context\.engineCombat, \{ world: bundle\.world, receipt: draft \}\);/);
  assert.match(gameplay, /engineCombat: context\.engineCombat \?\? null,/);
  assert.match(gameplay, /const armies = releaseLandingDivisions\(combat \? applyCombatOutcome\(impactedWorld\.hoi\.armies, combat\.outcome\) : impactedWorld\.hoi\.armies\);/);
  assert.match(gameplay, /const military = normalizeString\(variables\.militarySummary\);\r?\n\s+if \(military\) systemPrompt = `\$\{systemPrompt\}\\n\\n\$\{military\}`;/);
  assert.match(gameplay, /warRule: `the front between \$\{attacker\} and \$\{defender\} is fought by the engine: only its battles take states`/);
  assert.match(read("Game", "AI", "promptContext.js"), /result\.militarySummary = buildMilitaryPromptBlock\(bundle\.world, normalizeString\(bundle\.game\?\.country\), \{/);
  assert.match(read("Game", "AI", "contextDiagnostics.js"), /"economySummary",\r?\n\s+"militarySummary",/);
  const main = read("Game", "AI", "main.jsx");
  assert.match(main, /buildMilitaryPromptBlock\(worldData, gameData\?\.country, \{ others: 6 \}\),/, "the advisor");
  assert.match(main, /buildEconomyPromptBlock\(worldData, gameData\?\.country, \{ others: 4 \}\),/, "and the production");
  // Phase 8 : un dirigeant lit aussi sa politique.
  assert.match(main, /const forces = \[buildMilitaryPromptBlock\(worldData, speaker, \{ others: 0 \}\), buildPoliticsPromptBlock\(worldData, speaker, \{ others: 0 \}\)\]/, "a leader");
});
