// Phase 7.9 — Jev, le décideur local : le format de sa fiche, la lecture de ses
// logprobs, les options légales du moteur, la mémoire des pays, le budget.
// Un faux serveur renvoie des logprobs connus ; un vrai test tourne si
// llama-server répond sur 127.0.0.1:8081 (npm run jev).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createJevClient, readJevScore, renderJevPrompt, softmax } from "./jev.js";
import { LOCAL_DECIDER_TUNING, countryPriority, decisionQuestions, decisionSheet, runLocalDecisions, updateDecisionMemory } from "./localDecider.js";
import { getFrontDecider, setFrontDecider } from "./fronts.js";
import { templatesFor } from "./armies.js";
import { normalizeEconomyOp, applyEconomyOps } from "./economyOps.js";
import { applyFrontsForTurn } from "../worldmap/frontsTurn.js";
import { buildWarMap } from "../worldmap/warMap.js";
import { findJevModel, jevServerCommand, JEV_SERVER_ARGS } from "../../../scripts/jev/start-server.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const T36 = templatesFor("1936");

// Un faux llama-server : le score de chaque option est connu d'avance.
const fakeServer = (scores, { calls = [] } = {}) => async (target, options = {}) => {
  if (String(target).endsWith("/health")) return { ok: true, json: async () => ({ status: "ok" }) };
  const body = JSON.parse(options.body);
  calls.push(body);
  const option = body.prompt.split("\n").at(-1).replace(/ ->$/, "");
  const score = scores[option] ?? 0;
  return {
    ok: true,
    json: async () => ({
      completion_probabilities: [{ token: " yes", logprob: -0.5, top_logprobs: [{ token: " yes", logprob: -1 + score / 2 }, { token: " no", logprob: -1 - score / 2 }, { token: " maybe", logprob: -6 }] }],
      timings: { prompt_n: 5, cache_n: 100 },
    }),
  };
};

// ——— Le format de la fiche ———

test("the prompt follows Jev's card: State, Question [choice], Options, Judge each option, cut after the option's arrow", () => {
  const prompt = renderJevPrompt({ state: "The film was excellent.", question: "What is the sentiment of this review?", options: ["negative", "positive"], upto: 1 });
  assert.equal(prompt, "State:\nThe film was excellent.\n\nQuestion [choice]: What is the sentiment of this review?\nOptions:\n- negative\n- positive\nJudge each option:\nnegative ->\npositive ->");
  assert.ok(renderJevPrompt({ state: "s", question: "q", options: ["a", "b"], upto: 0 }).endsWith("Judge each option:\na ->"));
});

test("the score is logprob(yes) − logprob(no); a word missing from the top is the lowest seen, minus one", () => {
  assert.equal(readJevScore({ completion_probabilities: [{ top_logprobs: [{ token: " yes", logprob: -0.2 }, { token: " no", logprob: -1.7 }] }] }), 1.5);
  assert.equal(readJevScore({ completion_probabilities: [{ top_logprobs: [{ token: " yes", logprob: -0.1 }, { token: " the", logprob: -3 }] }] }), -0.1 - (-4));
  assert.ok(Number.isNaN(readJevScore({})));
  // The card's own example: negative −1.31, positive 2.64 → positive ≈ 0.989.
  const [, positive] = softmax([-1.31, 2.64]);
  assert.ok(Math.abs(positive - 0.989) < 0.001);
});

test("the client: one request per option, cache_prompt on, n_probs, the best option by score", async () => {
  const calls = [];
  const client = createJevClient({ fetchImpl: fakeServer({ "Hold the line": -1, "Attack toward Kaunas": 2.5, "Break through toward Kaunas": 0.4 }, { calls }) });
  assert.equal(await client.health(), true);
  const result = await client.score({ state: "You are the Soviet Union.", question: "What now?", options: ["Hold the line", "Attack toward Kaunas", "Break through toward Kaunas"] });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.cache_prompt === true && call.n_predict === 1 && call.n_probs === 50 && call.temperature === 0));
  assert.deepEqual(result.scores, [-1, 2.5, 0.4]);
  assert.equal(result.best, 1);
  assert.equal(result.cachedTokens, 300);
  const down = createJevClient({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(await down.health(), false, "no server: the rules decide");
});

// ——— Les options légales ———

const info = {
  riga: { neighbours: ["vilnius"], coastal: true },
  vilnius: { neighbours: ["riga", "kaunas", "alytus"] },
  kaunas: { neighbours: ["vilnius", "memel", "alytus"] },
  alytus: { neighbours: ["vilnius", "kaunas"] },
  memel: { neighbours: ["kaunas"], coastal: true },
};
const catalog = [
  { id: "riga", country: "Soviet Union", name: "Riga" },
  { id: "vilnius", country: "Soviet Union", name: "Vilnius" },
  { id: "kaunas", country: "Lithuania", name: "Kaunas" },
  { id: "alytus", country: "Lithuania", name: "Alytus" },
  { id: "memel", country: "Lithuania", name: "Memel" },
];
const seas = { zones: { 20001: { center: [20, 56], coastalStates: ["memel", "riga"] } }, stateSeas: { memel: [20001], riga: [20001] } };
const wars = [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Lithuania"] }];
const unit = (id, template, stateId, extra = {}) => ({ id, template, men: 10000, equipment: {}, organisation: 100, morale: 70, experience: 0, supply: 1, stateId, ...extra });
const world = () => ({
  wars,
  hoi: {
    series: "1936",
    armies: {
      "Soviet Union": {
        stockpile: { fusils: 1000, artillerie: 100 }, manpower: { available: 500000 },
        divisions: [unit("s0", "infanterie", "vilnius", { frontId: "f" }), unit("s1", "infanterie", "vilnius"), unit("s2", "infanterie", "riga"), unit("c1", "chasse", "vilnius"), unit("n1", "flotte", "riga")],
      },
      Lithuania: { stockpile: {}, manpower: { available: 0 }, divisions: [unit("l0", "infanterie", "kaunas"), unit("l1", "infanterie", "kaunas")] },
      Sweden: { stockpile: { fusils: 1000, artillerie: 100 }, manpower: { available: 100000 }, divisions: [] },
    },
    fronts: [{ id: "f", owner: "Soviet Union", enemy: "Lithuania", posture: "hold", divisionIds: ["s0"] }],
  },
});
const map = (w) => buildWarMap({ world: w, catalog, info });
const warOf = (a, b) => [a, b].sort().join() === "Lithuania,Soviet Union";
const enemiesOf = (polity) => (polity === "Soviet Union" ? ["Lithuania"] : polity === "Lithuania" ? ["Soviet Union"] : []);
const context = (w) => ({ armies: w.hoi.armies, fronts: w.hoi.fronts, templates: T36, map: map(w), seas, enemiesOf, atWar: warOf, date: "1936-06-01" });

test("the engine's legal options: posture and axis per front, free divisions, air and sea, recruitment", () => {
  const w = world();
  const questions = decisionQuestions("Soviet Union", context(w));
  assert.deepEqual(questions.map((q) => q.id), ["front-f", "reserve", "air-sea", "recruit"]);
  const [front, reserve, airSea, recruit] = questions;
  assert.deepEqual(front.options.map((o) => o.text), [
    "Hold the line against Lithuania",
    "Attack toward Alytus (0 enemy divisions there)",
    "Attack toward Kaunas (2 enemy divisions there)",
    "Break through toward Alytus (0 enemy divisions there)",
    "Break through toward Kaunas (2 enemy divisions there)",
  ], "the least defended axes first");
  assert.deepEqual(front.options[1].orders, [{ kind: "front", op: { op: "posture", polity: "Soviet Union", frontId: "f", posture: "attack", axis: "alytus" } }]);
  assert.equal(reserve.options[1].text, "Send 2 to the front against Lithuania");
  assert.ok(airSea.options.some((o) => o.text === "Send 1 fighter wings over the front against Lithuania"));
  assert.ok(airSea.options.some((o) => o.text === "Blockade the enemy coast off Memel with 1 fleets"));
  const landing = airSea.options.find((o) => o.text.startsWith("Land 3 divisions at Memel"));
  assert.deepEqual(landing.orders.map((o) => o.op.op), ["assign", "land"]);
  assert.ok(recruit.options.some((o) => o.text === "Raise one division d'infanterie"));
  assert.ok(airSea.options.length <= LOCAL_DECIDER_TUNING.maxOptions && front.options.length <= LOCAL_DECIDER_TUNING.maxOptions);
  assert.deepEqual(decisionQuestions("Lithuania", context(w)).map((q) => q.id), [], "no front of its own yet, nothing free, nothing to recruit");
  assert.deepEqual(decisionQuestions("Sweden", context(w)).map((q) => q.id), ["recruit"], "at peace: only recruitment");
});

test("the sheet: programme, allies, grudges and recent decisions at its head (cached), the turn's state after", () => {
  const w = world();
  const sheet = decisionSheet("Soviet Union", {
    memory: { programme: "Recover the Baltic coast", decisions: [{ date: "1936-05-01", choice: "Attack toward Alytus", result: "took 1 state(s)" }] },
    allies: ["Mongolia"], grudges: ["Lithuania"], date: "1936-06-01", army: w.hoi.armies["Soviet Union"], fronts: w.hoi.fronts, templates: T36,
  });
  assert.equal(sheet.split("\n").slice(0, 6).join("\n"), [
    "You are Soviet Union.",
    "Programme: Recover the Baltic coast.",
    "Allies: Mongolia.",
    "Grudges: Lithuania.",
    "Recent decisions:",
    "- 1936-05-01: Attack toward Alytus (took 1 state(s))",
  ].join("\n"));
  assert.match(sheet, /\nDate: 1936-06-01\.\nForces: 3 division d'infanterie, 1 escadre de chasse, 1 flotte; manpower 500,000\.\nFront against Lithuania: hold, 1 divisions\./);
});

test("a turn of decisions: countries at war first, the best option applied, at most 20, through setFrontDecider", async () => {
  const w = world();
  const client = createJevClient({ fetchImpl: fakeServer({ "Attack toward Alytus (0 enemy divisions there)": 3, "Send 2 to the front against Lithuania": 2, "Raise one division d'infanterie": 1 }) });
  setFrontDecider((polity, { sheet, question, options }) => client.score({ state: sheet, question, options }));
  const result = await runLocalDecisions(w, { decide: getFrontDecider(), map: map(w), seas, date: "1936-06-01", player: "", enemiesOf, atWar: warOf });
  setFrontDecider(null);
  assert.deepEqual(result.decisions.map((d) => [d.polity, d.questionId, d.choice]), [
    ["Soviet Union", "front-f", "Attack toward Alytus (0 enemy divisions there)"],
    ["Soviet Union", "reserve", "Send 2 to the front against Lithuania"],
    ["Soviet Union", "air-sea", "Keep them at home"],
    ["Soviet Union", "recruit", "Raise one division d'infanterie"],
    ["Sweden", "recruit", "Raise one division d'infanterie"],
  ]);
  assert.deepEqual(result.orders[0], { kind: "front", op: { op: "posture", polity: "Soviet Union", frontId: "f", posture: "attack", axis: "alytus" } });
  // The orders go through the same rules as everyone's.
  const { world: next } = applyFrontsForTurn(w, { map: map(w), seas, orders: result.orders, player: "" });
  const front = next.hoi.fronts.find((entry) => entry.id === "f");
  assert.deepEqual([front.posture, front.axis], ["attack", "alytus"]);
  assert.equal(front.divisionIds.length, 3, "the reserve went to the front");
  // The budget: the most important first.
  const one = await runLocalDecisions(w, { decide: async () => ({ best: 0, scores: [0] }), map: map(w), seas, enemiesOf, atWar: warOf, budget: 1 });
  assert.deepEqual(one.decisions.map((d) => d.questionId), ["front-f"]);
  assert.equal(one.queued, 5);
  // The player's country is never decided for.
  const player = await runLocalDecisions(w, { decide: async () => ({ best: 0 }), map: map(w), seas, enemiesOf, atWar: warOf, player: "Soviet Union" });
  assert.deepEqual(player.decisions.map((d) => d.polity), ["Sweden"]);
  // A decider that fails stops the turn; the engine's rules take the rest.
  const failed = await runLocalDecisions(w, { decide: async () => { throw new Error("Jev answered 503"); }, map: map(w), seas, enemiesOf, atWar: warOf });
  assert.deepEqual([failed.decisions.length, failed.stopped], [0, "Jev answered 503"]);
  assert.equal(countryPriority("Sweden", { enemies: [] }), 1);
  assert.equal(countryPriority("Soviet Union", { enemies: ["Lithuania"], fronts: w.hoi.fronts }), 2);
  assert.equal(countryPriority("Soviet Union", { enemies: ["Lithuania"], fronts: [{ ...w.hoi.fronts[0], posture: "attack" }] }), 3);
});

test("the memory: 10 decisions at most, their results from the turn's battles, the programme set by the big AI", () => {
  const decisions = Array.from({ length: 12 }, (_, i) => ({ polity: "Soviet Union", questionId: "front-f", choice: `choice ${i}`, date: "1936-06-01" }));
  const battles = [
    { attacker: "Soviet Union", defender: "Lithuania", result: "captured" },
    { attacker: "Soviet Union", defender: "Lithuania", result: "repelled" },
  ];
  const programmes = [normalizeEconomyOp({ op: "programme", polity: "Soviet Union", label: "Take back the Baltic coast." })];
  const memory = updateDecisionMemory({}, { decisions, battles, programmes, date: "1936-06-08" });
  const soviet = memory["Soviet Union"];
  assert.equal(soviet.decisions.length, 10);
  assert.equal(soviet.decisions.at(-1).choice, "choice 11");
  assert.equal(soviet.decisions.at(-1).result, "took 1 state(s), 1 attack(s) repelled");
  assert.equal(soviet.programme, "Take back the Baltic coast.");
  const later = updateDecisionMemory(memory, { decisions: [{ polity: "Soviet Union", questionId: "recruit", choice: "Raise one", date: "1936-06-08" }], battles: [] });
  assert.equal(later["Soviet Union"].decisions.at(-1).result, "no battle");
  assert.equal(later["Soviet Union"].decisions.at(-2).result, "took 1 state(s), 1 attack(s) repelled", "an old result stays");
  assert.equal(applyEconomyOps({ nations: { "Soviet Union": {} } }, programmes).notes.length, 0, "not an economy operation");
});

test("wired: the setting (off by default), the relay, the launch script, the turn", () => {
  const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", "..", ...parts), "utf8");
  assert.match(read("src", "runtime", "mapSettings.js"), /localDecider: "ai_local_decider_jev",/);
  assert.match(read("src", "Game", "GameUI", "settings.jsx"), /<Toggle label="Local decider \(Jev\)" enabled=\{mapSettings\.localDecider\}/);
  const gameplay = read("src", "Game", "AI", "gameplay.js");
  assert.match(gameplay, /if \(!getMapSetting\(MAP_SETTING_KEYS\.localDecider\)\) \{ setFrontDecider\(null\); return null; \}/);
  const decide = gameplay.indexOf("const localDecisions = await runLocalDeciderForJump(bundle, { date: originDate });");
  const combat = gameplay.indexOf("const engineCombat = await resolveCombatForJump(bundle, { originDate, days: dateStep, orders: localDecisions?.orders });");
  assert.ok(decide > 0 && combat > decide, "the decisions first, then the battles with them");
  assert.match(gameplay, /worldWithImpacts = applyLocalDecisionsAfterTurn\(worldWithImpacts, freshEvents, result\.localDecisions, \{ date: nextGame\.gameDate, receipt \}\);/);
  assert.match(read("server", "server.js"), /registerJevRoutes\(app, jsonParser\);/);
  assert.match(read("server", "jevProxy.js"), /process\.env\.OH_JEV_URL \|\| "http:\/\/127\.0\.0\.1:8081"/);
  assert.match(read("package.json"), /"jev": "node scripts\/jev\/start-server\.mjs",/);
  assert.match(read(".gitignore"), /\/tools\/llama\/bin\//);
  assert.deepEqual(JEV_SERVER_ARGS, ["-b", "64", "-ub", "64", "--checkpoint-min-step", "0", "-c", "8192"]);
  const { args } = jevServerCommand({ llamaDir: "x", model: "m.gguf" });
  assert.deepEqual(args.slice(0, 6), ["-m", "m.gguf", "--host", "127.0.0.1", "--port", "8081"]);
  assert.equal(findJevModel(path.join(here, "does-not-exist")), "");
});

// ——— Le vrai serveur, s'il tourne ———

const realServer = async () => {
  try {
    const response = await fetch("http://127.0.0.1:8081/health", { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
};

test("the real Jev (llama-server on 8081): the card's example, and a military decision", { timeout: 120000 }, async (t) => {
  if (!(await realServer())) { t.skip("llama-server is not running on 127.0.0.1:8081 (npm run jev)"); return; }
  const client = createJevClient({ url: "http://127.0.0.1:8081/completion", healthUrl: "http://127.0.0.1:8081/health" });
  const review = await client.score({ state: "The film was excellent.", question: "What is the sentiment of this review?", options: ["negative", "positive"] });
  assert.equal(review.best, 1, "positive");
  assert.ok(review.probs[1] > 0.9);
  const w = world();
  const result = await runLocalDecisions(w, {
    decide: (polity, { sheet, question, options }) => client.score({ state: sheet, question, options }),
    map: map(w), seas, date: "1936-06-01", enemiesOf, atWar: warOf,
  });
  assert.equal(result.decisions.length, 5);
  t.diagnostic(`real Jev: ${result.decisions.length} decisions in ${result.ms} ms — ${result.decisions.map((d) => `${d.questionId}: ${d.choice} (${d.ms} ms)`).join("; ")}`);
});
