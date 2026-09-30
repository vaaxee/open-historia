// Test G — le relevé des temps d'un tour, et sa route au serveur.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { activeTurnProfile, finishTurnProfile, lapClock, recordStep, startTurnProfile, summarizeSteps, timeStep } from "./turnProfile.js";
import { appendTurnProfile, readTurnProfiles } from "../../server/turnProfileLog.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", ...parts), "utf8");

test("a turn's steps: laps, timed calls, a summary by step, and nothing recorded outside a turn", async () => {
  recordStep("outside", 5);
  assert.equal(activeTurnProfile(), null);
  startTurnProfile({ mode: "jump", days: 7 });
  const lap = lapClock();
  lap("jev (local decider)", { decisions: 3 });
  await timeStep("AI call: jumpForward", async () => "answer", (answer) => ({ answer }));
  recordStep("AI call: jumpForward", 1200, { attempt: 2 });
  recordStep("checks: jumpForward", 30);
  const sent = [];
  const entry = finishTurnProfile({ outcome: "ai" }, { fetchImpl: async (address, init) => { sent.push([address, JSON.parse(init.body)]); return { ok: true }; } });
  assert.equal(activeTurnProfile(), null);
  assert.deepEqual(entry.steps.map((step) => step.step), ["jev (local decider)", "AI call: jumpForward", "AI call: jumpForward", "checks: jumpForward"]);
  assert.equal(entry.steps[0].decisions, 3);
  assert.equal(entry.steps[1].answer, "answer");
  assert.deepEqual(entry.summary[0], { step: "AI call: jumpForward", count: 2, ms: entry.steps[1].ms + 1200 });
  assert.equal(entry.outcome, "ai");
  assert.equal(sent[0][0], "/api/debug/turn-profile");
  assert.equal(sent[0][1].mode, "jump");
  assert.deepEqual(summarizeSteps([{ step: "a", ms: 1 }, { step: "b", ms: 5 }, { step: "a", ms: 2 }]), [{ step: "b", count: 1, ms: 5 }, { step: "a", count: 2, ms: 3 }]);
});

test("the server keeps the profiles in a JSON-lines file, halved past its size limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-profile-"));
  const file = path.join(dir, "logs", "turn-profile.jsonl");
  for (let i = 0; i < 6; i += 1) appendTurnProfile({ kind: "turn", i, pad: "x".repeat(100) }, { file, maxBytes: 600 });
  const kept = readTurnProfiles({ file, limit: 50 });
  assert.ok(kept.length < 6 && kept.at(-1).i === 5, "the newest stay");
  assert.ok(kept.every((entry) => entry.receivedAt));
  assert.deepEqual(readTurnProfiles({ file: path.join(dir, "none.jsonl") }), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("wired: the turn's steps, every AI call and its checks, Jev's tokens, translations, the route", () => {
  const gameplay = read("src", "Game", "AI", "gameplay.js");
  for (const step of ["reading the game", "jev (local decider)", "combat (engine)", "politics (engine)", "espionage (engine)", "prompt building", "segments (whole answer phase)", "turn review", "unit director", "territory director and region control", "applying the result (world, fronts, board, write)"]) {
    assert.ok(gameplay.includes(`lap("${step}"`), step);
  }
  assert.match(gameplay, /recordStep\(`AI call: \$\{taskKey\}`, checksStarted - callStarted,/);
  assert.match(gameplay, /recordStep\(`checks: \$\{taskKey\}`, Date\.now\(\) - checksStarted, \{ attempt: outputAttempt, ok: false,/);
  assert.match(gameplay, /finishTurnProfile\(\{ outcome: profileOutcome/);
  assert.match(read("src", "runtime", "hoi", "localDecider.js"), /promptTokens: verdict\.promptTokens, cachedTokens:/);
  assert.match(read("src", "runtime", "translator.js"), /recordTranslation\(\{ ms: Date\.now\(\) - batchStarted/);
  assert.match(read("server", "server.js"), /registerTurnProfileRoutes\(app, jsonParser\);/);
});
