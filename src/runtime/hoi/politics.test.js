// Phase 8 — focus nationaux et politique intérieure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  POLITICS_TUNING, advancePolitics, applyPoliticsEffects, canDeclareWar, enableHoiPolitics, ideologyFromGovernment,
  normalizePolitics, politicsEvent, seedPolitics, shiftPopularity, stabilityProductionModifier, warSupportManpowerFactor,
} from "./politics.js";
import {
  advanceFocuses, applyFocusEffects, availableFocuses, customFocus, focusStatus, focusTreeFor, parseFocusEffects, programmeFor, startFocus,
} from "./focus.js";
import { FOCUS_TREES, GENERIC_FOCUS_TREE } from "./focusTrees.js";
import { buildPoliticsPromptBlock } from "./politicsPrompt.js";
import { decisionQuestions, decisionSheet } from "./localDecider.js";
import { growManpower, normalizeArmy, templatesFor } from "./armies.js";
import { normalizeEconomyOp, applyEconomyOps } from "./economyOps.js";
import { planPlayerWars } from "../../Game/AI/playerWarOrders.js";
import { applyPlayerFocus, focusEffectText, focusPanelModel, politicsPanelModel } from "../../Game/GameUI/focusPoliticsModel.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", ...parts), "utf8");

// ——— La politique ———

test("politics: presets for the powers of 1936, the rest read from their sheet; parties always sum to 100", () => {
  const germany = seedPolitics("Germany");
  assert.equal(germany.ideology, "fascist");
  assert.equal(germany.elections, null, "no elections in a dictatorship");
  const france = seedPolitics("France");
  assert.deepEqual([france.ideology, france.elections.next], ["democratic", "1936-04-26"]);
  assert.equal(ideologyFromGovernment("Parliamentary republic"), "democratic");
  assert.equal(ideologyFromGovernment("Military dictatorship"), "authoritarian");
  assert.equal(ideologyFromGovernment("Socialist republic, one-party"), "communist");
  const sweden = seedPolitics("Sweden", { government: "Constitutional monarchy, parliamentary democracy", date: "1936-01-01" });
  assert.equal(sweden.ideology, "democratic");
  assert.equal(sweden.elections.next, "1938-06-01");
  for (const politics of [germany, france, sweden, normalizePolitics({ parties: { fascist: 3, democratic: 1 } })]) {
    assert.ok(Math.abs(Object.values(politics.parties).reduce((a, b) => a + b, 0) - 100) < 0.5);
  }
  const hoi = enableHoiPolitics({ nations: { Germany: {}, Sweden: {} } }, { countryStats: { Sweden: { government: "democracy" } }, date: "1936-01-01" });
  assert.deepEqual(Object.keys(hoi.politics), ["Germany", "Sweden"]);
  const shifted = shiftPopularity({ democratic: 60, communist: 20, fascist: 10, authoritarian: 10 }, "fascist", 10);
  assert.equal(shifted.fascist, 20);
  assert.ok(Math.abs(Object.values(shifted).reduce((a, b) => a + b, 0) - 100) < 0.5);
});

test("politics over a turn: war wears stability; the aggressor loses war support, the attacked gains it; peace drifts back", () => {
  const month = { fromDate: "1936-01-01", toDate: "1936-01-31" };
  const base = { ideology: "communist", stability: 60, warSupport: 40 };
  const aggressor = advancePolitics(base, { ...month, war: { atWar: true, aggressor: true } }).politics;
  const defender = advancePolitics(base, { ...month, war: { atWar: true, aggressor: false } }).politics;
  assert.equal(aggressor.stability, 58.5);
  assert.equal(aggressor.warSupport, 38);
  assert.equal(defender.warSupport, 43);
  const peace = advancePolitics({ ...base, stability: 80, warSupport: 10 }, month).politics;
  assert.equal(peace.stability, 79.5);
  assert.equal(peace.warSupport, 10.5);
});

test("elections at their date: the most popular movement governs; a coup when a regime is unstable and an opposition strong", () => {
  const france = seedPolitics("France");
  const spring = advancePolitics(france, { fromDate: "1936-04-01", toDate: "1936-05-01" });
  assert.equal(spring.changes[0].kind, "election");
  assert.equal(spring.changes[0].date, "1936-04-26");
  assert.equal(spring.politics.ideology, "democratic");
  assert.equal(spring.politics.elections.next, "1940-04-26");
  assert.deepEqual(advancePolitics(france, { fromDate: "1936-01-01", toDate: "1936-02-01" }).changes, [], "not yet");
  const shaken = { ideology: "authoritarian", stability: 20, warSupport: 30, parties: { authoritarian: 35, fascist: 45, democratic: 15, communist: 5 } };
  const coup = advancePolitics(shaken, { fromDate: "1936-01-01", toDate: "1936-01-15" });
  assert.equal(coup.changes[0].kind, "coup");
  assert.equal(coup.politics.ideology, "fascist");
  assert.equal(coup.politics.stability, 45);
  const event = politicsEvent("Romania", coup.changes[0], { language: "fr", nameOf: () => "Roumanie", the: (name, form) => (form === "de" ? "de la Roumanie" : "la Roumanie") });
  assert.equal(event.title, "Coup d'État : Roumanie");
  assert.match(event.description, /^Le gouvernement autoritaire de la Roumanie est renversé : le courant fasciste \(\d+(\.\d)? %\) prend le pouvoir par la force\.$/);
  assert.equal(event.source, "engine");
});

test("politics weighs on the game: production by stability, recruitment by war support, the right to declare a war", () => {
  assert.equal(stabilityProductionModifier(100), 0.2);
  assert.equal(stabilityProductionModifier(0), -0.2);
  assert.equal(warSupportManpowerFactor(0), 0.5);
  assert.equal(warSupportManpowerFactor(100), 1.5);
  const hoi = applyPoliticsEffects({
    politics: { France: { ideology: "democratic", stability: 30, warSupport: 15 } },
    nations: { France: { modifiers: [{ id: "politics-stability", target: "production", value: 0.1 }, { id: "strike", target: "production", value: -0.1 }] } },
    armies: { France: { manpower: { available: 1000, growthPerMonth: 3000 }, divisions: [] } },
  });
  assert.deepEqual(hoi.nations.France.modifiers.map((m) => [m.id, m.value]), [["strike", -0.1], ["politics-stability", -0.08]], "replaced, not stacked");
  assert.equal(hoi.armies.France.manpower.growthFactor, 0.65);
  const grown = growManpower(normalizeArmy(hoi.armies.France), 30);
  assert.equal(grown.manpower.available, 1000 + Math.round(3000 * 0.65));
  assert.deepEqual(canDeclareWar(hoi, "France"), { ok: false, reason: `France's war support is 15%, under the ${POLITICS_TUNING.minWarSupportToDeclare}% needed to declare a war of aggression` });
  assert.equal(canDeclareWar(hoi, "France", { defending: true }).ok, true, "it can always defend itself");
  assert.equal(canDeclareWar(hoi, "Germany").ok, true, "a country without politics is not held back");
  const { refused, started } = planPlayerWars({
    actions: [{ id: "a", status: "planned", title: "Déclarer la guerre à l'Allemagne." }],
    world: { polityOverrides: { France: { name: "France" }, Germany: { name: "Germany" } }, wars: [] },
    player: "France", canDeclare: (polity) => canDeclareWar(hoi, polity),
  });
  assert.equal(started.length, 0);
  assert.match(refused[0].reason, /war support is 15%/);
});

// ——— Les focus ———

test("focus trees: one for each power of 1936 and Poland, the generic one for the rest; every link points at a focus", () => {
  assert.deepEqual(Object.keys(FOCUS_TREES).sort(), ["France", "Germany", "Imperialist Japan", "Italy", "Kuomintang China", "Poland", "Soviet Union", "United Kingdom", "United States"]);
  assert.deepEqual(focusTreeFor("Sweden").map((focus) => focus.id), GENERIC_FOCUS_TREE.map((focus) => focus.id), "a country without a tree has the generic one");
  for (const tree of [...Object.values(FOCUS_TREES), GENERIC_FOCUS_TREE]) {
    const ids = new Set(tree.map((focus) => focus.id));
    assert.equal(ids.size, tree.length, "unique ids");
    for (const focus of tree) {
      for (const id of [...focus.requires, ...focus.requiresAny, ...focus.excludes]) assert.ok(ids.has(id), `${focus.id} → ${id}`);
      assert.ok(focus.name.fr && focus.name.en && focus.days > 0 && focus.effects.length);
    }
    const cells = new Set(tree.map((focus) => `${focus.x},${focus.y}`));
    assert.equal(cells.size, tree.length, "no two focuses on one cell");
  }
});

test("a focus: prerequisites, exclusions, starting it, finishing it, the next one picked for an AI country", () => {
  let state = {};
  assert.equal(focusStatus(FOCUS_TREES.Germany.find((f) => f.id === "ger-four-year-plan"), state), "locked");
  assert.deepEqual(availableFocuses("Germany", state).map((f) => f.id), ["ger-rearmament"]);
  state = startFocus("Germany", state, "ger-rearmament", { date: "1936-01-01" }).state;
  assert.deepEqual(state.current, { id: "ger-rearmament", startDate: "1936-01-01", days: 70 });
  assert.equal(startFocus("Germany", state, "ger-axis").note.kind, "dropped", "one at a time");
  const early = advanceFocuses({ nations: { Germany: {} }, focus: { Germany: state } }, { toDate: "1936-02-01" });
  assert.equal(early.completed.length, 0);
  const done = advanceFocuses({ nations: { Germany: {} }, focus: { Germany: state } }, { toDate: "1936-03-15", choose: () => "ger-axis" });
  assert.deepEqual(done.completed.map(({ polity, focus, date }) => [polity, focus.id, date]), [["Germany", "ger-rearmament", "1936-03-11"]]);
  assert.equal(done.focus.Germany.current.id, "ger-axis", "the decider's pick");
  const auto = advanceFocuses({ nations: { Germany: {} }, focus: { Germany: state } }, { toDate: "1936-03-15" });
  assert.equal(auto.focus.Germany.current.id, "ger-four-year-plan", "else the tree's order");
  const player = advanceFocuses({ nations: { Germany: {} }, focus: { Germany: state } }, { toDate: "1936-03-15", player: "Germany" });
  assert.equal(player.focus.Germany.current, null, "the player picks their own");
  // Exclusions.
  const danzig = { completed: ["ger-rearmament", "ger-rhineland", "ger-anschluss", "ger-danzig"] };
  assert.equal(focusStatus(FOCUS_TREES.Germany.find((f) => f.id === "ger-poland-pact"), danzig), "excluded");
});

test("a focus's effects, applied by the engine: factories, production, research, divisions, politics, opinions, claims", () => {
  const world = {
    hoi: {
      series: "1936",
      nations: { Germany: { factories: { civilian: 10, military: 5 }, modifiers: [], stocks: {}, research: { slots: [{ techId: "t", progress: 10 }] } } },
      armies: { Germany: { stockpile: {}, manpower: { available: 0, growthPerMonth: 0 }, divisions: [] } },
      politics: { Germany: seedPolitics("Germany") },
    },
    regionClaimants: {},
  };
  const focus = {
    id: "test", name: { en: "Test", fr: "Test" }, effects: [
      { type: "factories", civilian: 2, military: 1 }, { type: "production", value: 0.1, days: 30 }, { type: "research", value: 0.15 },
      { type: "divisions", template: "chasse", count: 2 }, { type: "stock", resource: "acier", amount: 100 }, { type: "stability", delta: 10 },
      { type: "ideology", ideology: "democratic", delta: 5 }, { type: "opinion", target: "Poland", delta: -30 }, { type: "claim", states: ["Gdańsk", "Atlantis"] },
    ],
  };
  const { world: next, notes } = applyFocusEffects(world, "Germany", focus, { date: "1936-03-11", resolveState: (name) => (name === "Gdańsk" ? "imp-gdansk" : "") });
  const nation = next.hoi.nations.Germany;
  assert.deepEqual(nation.factories, { civilian: 12, military: 6 });
  assert.deepEqual(nation.modifiers[0], { id: "focus-test", target: "production", value: 0.1, untilDate: "1936-04-10", label: "Test" });
  assert.equal(nation.research.slots[0].progress, 25, "15 more days of work");
  assert.equal(nation.stocks.acier, 100);
  const wings = next.hoi.armies.Germany.divisions;
  assert.equal(wings.length, 2);
  assert.ok(wings.every((d) => d.template === "chasse" && d.equipment.chasseurs === 22), "raised equipped");
  assert.equal(next.hoi.armies.Germany.manpower.available, 0, "the men came with them");
  assert.equal(next.hoi.politics.Germany.stability, 85);
  assert.equal(next.hoi.politics.Germany.parties.democratic, 10);
  assert.equal(next.hoi.politics.Germany.opinions.Poland, -30);
  assert.deepEqual(next.regionClaimants["imp-gdansk"], ["Germany"]);
  assert.match(notes[0].text, /no state "Atlantis"/);
});

test("a custom focus the AI proposes: effects parsed and bounded, the rest refused", () => {
  const parsed = parseFocusEffects("civil+5; stability+40; divisions:infanterie*9; claim:Gdańsk/Vilnius; opinion:Poland-20; nonsense");
  assert.deepEqual(parsed.effects, [
    { type: "factories", civilian: 3 },
    { type: "stability", delta: 15 },
    { type: "divisions", template: "infanterie", count: 3 },
    { type: "claim", states: ["Gdańsk", "Vilnius"] },
  ]);
  assert.deepEqual(parsed.dropped, ["nonsense", "opinion"], "four effects at most");
  const made = customFocus("Poland", { label: "Pacte balkanique", days: 400, effects: "stability+5" }, {});
  assert.equal(made.focus.id, "custom-poland-pacte-balkanique");
  assert.equal(made.focus.days, 140);
  assert.equal(customFocus("Poland", { label: "Rien", effects: "fly to the moon" }).focus, null);
  assert.deepEqual(normalizeEconomyOp({ op: "focus", polity: "Poland", label: "Pacte balkanique", effects: "stability+5", days: 60 }),
    { op: "focus", polity: "Poland", label: "Pacte balkanique", effects: "stability+5", days: 60 });
  assert.equal(applyEconomyOps({ nations: { Poland: {} } }, [{ op: "focus", polity: "Poland", focusId: "pol-cop" }]).notes.length, 0, "applied by the turn, not the economy");
});

// ——— Programme, Jev, prompts, panneaux ———

test("the programme comes from the regime and the focus, feeds Jev's sheet, and Jev may pick the next focus", () => {
  const hoi = {
    nations: { Germany: {} }, politics: { Germany: seedPolitics("Germany") },
    focus: { Germany: { current: { id: "ger-luftwaffe", startDate: "1936-03-11", days: 70 }, completed: ["ger-rearmament"] } },
  };
  assert.equal(programmeFor("Germany", hoi), 'fascist government; working on "Luftwaffe"; has done "Rearmament"');
  const sheet = decisionSheet("Germany", { memory: { programme: "Break Poland", policy: programmeFor("Germany", hoi), decisions: [] } });
  assert.match(sheet, /\nProgramme: Break Poland\.\nPolicy: fascist government; working on "Luftwaffe"/);
  const questions = decisionQuestions("Germany", { armies: { Germany: { divisions: [], stockpile: {}, manpower: {} } }, fronts: [], templates: templatesFor("1936"), focus: { Germany: { completed: [] } }, politics: hoi.politics, enemiesOf: () => [] });
  assert.equal(questions.find((q) => q.id === "focus"), undefined, "one focus only available: nothing to decide");
  const later = decisionQuestions("Germany", { armies: { Germany: { divisions: [], stockpile: {}, manpower: {} } }, fronts: [], templates: templatesFor("1936"), focus: { Germany: { completed: ["ger-rearmament"] } }, politics: hoi.politics, enemiesOf: () => [] });
  const focusQ = later.find((q) => q.id === "focus");
  assert.deepEqual(focusQ.options.map((o) => o.orders[0].op.focusId), ["ger-four-year-plan", "ger-rhineland", "ger-luftwaffe", "ger-axis"]);
});

test("the AIs read the politics: the block, what the engine decided this period, the rules", () => {
  const world = { hoi: {
    nations: { France: {}, Germany: {} }, armies: {},
    politics: { France: seedPolitics("France"), Germany: seedPolitics("Germany") },
    focus: { Germany: { current: { id: "ger-rearmament", startDate: "1936-01-01", days: 70 } } },
  } };
  const block = buildPoliticsPromptBlock(world, "France", { others: 3, forTurn: true, enginePolitics: { changes: [{ polity: "France", date: "1936-04-26", kind: "election", from: "democratic", to: "democratic", share: 60 }], completed: [] } });
  assert.match(block, /^\[POLITICS — computed by the engine\]\n- France: democratic government \(democratic 60%/);
  assert.match(block, /next election 1936-04-26; no focus under way\./);
  assert.match(block, /- Germany: fascist government .*national focus "Rearmament" since 1936-01-01/);
  assert.match(block, /- 1936-04-26 France: election — democratic → democratic \(60%\)\./);
  assert.match(block, /cannot start a war of aggression/);
});

test("the Focus and Politics panels: the tree with its states, the player's pick, the figures and what they do", () => {
  const world = { hoi: { nations: { Poland: {} }, lastDate: "1936-01-01" }, countryStats: {} };
  const model = focusPanelModel(world, "Poland", { language: "fr", date: "1936-01-01" });
  assert.equal(model.nodes.find((n) => n.id === "pol-cop").name, "Région industrielle centrale");
  assert.equal(model.nodes.find((n) => n.id === "pol-cop").status, "available");
  assert.equal(model.nodes.find((n) => n.id === "pol-cop-2").status, "locked");
  assert.ok(model.links.some(([from, to]) => from === "pol-cop" && to === "pol-cop-2"));
  assert.ok(model.exclusive.some(([a, b]) => [a, b].sort().join() === "pol-democracy,pol-sanation"));
  const picked = applyPlayerFocus(world, "Poland", "pol-cop", { date: "1936-01-01" });
  assert.equal(picked.world.hoi.focus.Poland.current.id, "pol-cop");
  const after = focusPanelModel(picked.world, "Poland", { language: "fr", date: "1936-02-01" });
  assert.deepEqual([after.current.id, after.remaining], ["pol-cop", 39]);
  const politics = politicsPanelModel(picked.world, "Poland", { language: "fr" });
  assert.equal(politics.ideologyName, "autoritaire");
  assert.equal(politics.parties[0].ruling, true);
  assert.equal(politics.canDeclareWar, true);
  assert.equal(focusEffectText({ type: "factories", civilian: 1, military: 1 }, "fr"), "+1 usine(s) civile(s), +1 usine(s) militaire(s)");
});

test("wired: the turn resolves politics before the AI writes, applies it before the economy, the dock and the prompts", () => {
  const gameplay = read("Game", "AI", "gameplay.js");
  const combat = gameplay.indexOf("const engineCombat = await resolveCombatForJump(");
  const politics = gameplay.indexOf("const enginePolitics = resolvePoliticsForJump(bundle, { originDate, targetDate, orders: localDecisions?.orders });");
  assert.ok(combat > 0 && politics > combat);
  const apply = gameplay.indexOf("impactedWorld = applyEnginePolitics(impactedWorld, result.enginePolitics, { date: nextGame.gameDate });");
  const economy = gameplay.indexOf("impactedWorld = advanceHoiLayer(impactedWorld, {");
  assert.ok(apply > 0 && economy > apply, "the politics modifier counts for this turn's production");
  assert.match(gameplay, /if \(segmentIndex === 0\) enforceWarSupport\(candidate, bundle, \{ receipt: draft \}\);/);
  assert.match(gameplay, /if \(segmentIndex === 0\) addEnginePolitics\(candidate, context\.enginePolitics,/);
  assert.match(gameplay, /worldWithImpacts = applyFocusOpsAfterTurn\(worldWithImpacts, freshEvents,/);
  assert.match(read("Game", "AI", "promptContext.js"), /const politics = buildPoliticsPromptBlock\(bundle\.world, normalizeString\(bundle\.game\?\.country\), \{/);
  assert.match(read("Game", "AI", "main.jsx"), /buildPoliticsPromptBlock\(worldData, gameData\?\.country, \{ others: 6 \}\),/, "the advisor");
  const dock = read("Game", "GameUI", "chat.jsx");
  assert.match(dock, /<FocusDock hovered=\{hoveredFocus\}/);
  assert.match(dock, /<PoliticsDock hovered=\{hoveredPolitics\}/);
  assert.match(dock, /dockWidthFor\(\(hasProduction \? 4 : 0\) \+ \(hasArmies \? 1 : 0\)\)/);
  assert.match(read("Game", "GameUI", "search.jsx"), /besideDockLeftFor\(\(hasProduction \? 4 : 0\) \+ \(hasArmies \? 1 : 0\)\)/);
  assert.match(read("Game", "GameUI", "MilitaryStats.jsx"), /<div style=\{heading\}>Politics<\/div>/);
});
