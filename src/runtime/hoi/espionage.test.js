// Phase 11 — l'espionnage : réseaux, missions, chances, agents capturés.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  ESPIONAGE_TUNING, advanceEspionage, aiAgentFate, applyEspionageOp, decideAgentFate, defaultEspionageOps, espionageEvent, intelReport, missionChances, networkOf,
} from "./espionage.js";
import { seedPolitics } from "./politics.js";
import { normalizeEconomyOp, applyEconomyOps } from "./economyOps.js";
import { describeEspionageLine } from "./politicsPrompt.js";
import { espionagePanelModel, applyPlayerEspionage, decidePlayerAgent } from "../../Game/GameUI/focusPoliticsModel.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", ...parts), "utf8");

const world = (hoi = {}, intelligence = { Germany: 60, Poland: 40 }) => ({
  intelligence,
  hoi: {
    nations: { Germany: { research: { done: ["radar"], partial: {} } }, Poland: { research: { done: ["radar", "codebreaking"], partial: {} } } },
    armies: { Poland: { manpower: { available: 800000 }, divisions: [{ id: "p1" }, { id: "p2" }] } },
    politics: { Germany: seedPolitics("Germany"), Poland: seedPolitics("Poland") },
    tech: { tree: { techs: [{ id: "codebreaking", days: 200 }] } },
    ...hoi,
  },
});

test("networks: built while ordered (faster with a better service), decaying otherwise; a mission needs enough of one", () => {
  let hoi = world().hoi;
  hoi = applyEspionageOp({ op: "build", polity: "Germany", target: "Poland" }, { hoi }).hoi;
  const after = advanceEspionage({ ...world(), hoi }, { fromDate: "1936-01-01", toDate: "1936-03-01" });
  assert.equal(networkOf(after.hoi, "Germany", "Poland").strength, Math.round(ESPIONAGE_TUNING.buildPerMonth * (60 / 50) * (60 / 30) * 100) / 100);
  const stopped = applyEspionageOp({ op: "stop", polity: "Germany", target: "Poland" }, { hoi: after.hoi }).hoi;
  const decayed = advanceEspionage({ ...world(), hoi: stopped }, { fromDate: "1936-03-01", toDate: "1936-04-01" });
  assert.ok(networkOf(decayed.hoi, "Germany", "Poland").strength < networkOf(after.hoi, "Germany", "Poland").strength);
  const refused = applyEspionageOp({ op: "mission", polity: "Germany", target: "Poland", kind: "tech" }, { hoi: after.hoi });
  assert.match(refused.note.text, /under the 50 a tech mission needs/);
  assert.equal(applyEspionageOp({ op: "mission", polity: "Germany", target: "Poland", kind: "intel" }, { hoi: after.hoi, date: "1936-03-01" }).note.kind, "adjusted");
});

test("chances: the network and the two services set success and capture; the draw is stable", () => {
  const strong = missionChances({ kind: "sabotage", strength: 90, ownerIntelligence: 70, targetIntelligence: 30 });
  const weak = missionChances({ kind: "sabotage", strength: 40, ownerIntelligence: 30, targetIntelligence: 80 });
  assert.ok(strong.success > weak.success && strong.capture < weak.capture);
  assert.ok(weak.success >= 0.05 && strong.success <= 0.95);
  const hoi = { ...world().hoi, networks: { Germany: { Poland: { strength: 80 } } }, spyMissions: [{ id: "m1", owner: "Germany", target: "Poland", kind: "tech", startDate: "1936-01-01", days: 60 }] };
  const a = advanceEspionage({ ...world(), hoi }, { fromDate: "1936-01-01", toDate: "1936-03-15", seed: "g" });
  const b = advanceEspionage({ ...world(), hoi }, { fromDate: "1936-01-01", toDate: "1936-03-15", seed: "g" });
  assert.deepEqual(a.results.map((r) => [r.success, r.captured]), b.results.map((r) => [r.success, r.captured]));
  const early = advanceEspionage({ ...world(), hoi }, { fromDate: "1936-01-01", toDate: "1936-02-01", seed: "g" });
  assert.equal(early.results.length, 0, "not finished yet");
  assert.equal(early.hoi.spyMissions.length, 1);
});

test("missions' effects: intel reports, a stolen technology, a party lifted, a capture that costs the network", () => {
  // Pick seeds that give each outcome, so every branch is pinned.
  const base = (kind, detail = "") => ({ ...world().hoi, networks: { Germany: { Poland: { strength: 95 } } }, spyMissions: [{ id: `m-${kind}`, owner: "Germany", target: "Poland", kind, detail, startDate: "1936-01-01", days: 30 }] });
  const find = (kind, detail, wanted) => {
    for (let i = 0; i < 200; i += 1) {
      const out = advanceEspionage({ ...world(), hoi: base(kind, detail) }, { fromDate: "1936-01-01", toDate: "1936-03-01", seed: `s${i}` });
      if (wanted(out.results[0])) return out;
    }
    throw new Error(`no seed for ${kind}`);
  };
  const intel = find("intel", "", (r) => r.success && !r.captured);
  assert.deepEqual(intel.results[0].effect.report, { divisions: 2, manpower: 800000, ideology: "authoritarian", stability: 55, warSupport: 40 });
  const tech = find("tech", "", (r) => r.success);
  assert.equal(tech.results[0].effect.techId, "codebreaking");
  assert.equal(tech.hoi.nations.Germany.research.partial.codebreaking, 60, "30% of its 200 days");
  const party = find("party", "fascist", (r) => r.success);
  assert.equal(party.hoi.politics.Poland.parties.fascist, 13);
  const caught = find("sabotage", "", (r) => r.captured);
  // Deux mois sans le bâtir (−2 par mois), puis la capture.
  assert.equal(networkOf(caught.hoi, "Germany", "Poland").strength, 95 - 2 * ESPIONAGE_TUNING.decayPerMonth - ESPIONAGE_TUNING.captureLoss);
  assert.deepEqual(caught.captured.map((agent) => [agent.owner, agent.holder, agent.status]), [["Germany", "Poland", "held"]]);
  const event = espionageEvent(caught.results[0], { language: "fr", the: (name, form) => ({ Poland: form === "de" ? "de la Pologne" : "la Pologne", Germany: "l'Allemagne" })[name] });
  assert.equal(event.title, "La Pologne arrête un agent étranger");
  assert.match(event.description, /^Les services de la Pologne démantèlent une opération de sabotage menée par l'Allemagne/);
});

test("a captured agent: exchange, public trial, turning (the owner's network lies from then on), execution", () => {
  const hoi = { ...world().hoi, networks: { Germany: { Poland: { strength: 50 } } }, capturedAgents: [{ id: "a1", owner: "Germany", holder: "Poland", mission: "intel", status: "held" }] };
  const trial = decideAgentFate(hoi, "a1", "trial").hoi;
  assert.equal(trial.politics.Poland.stability, 58);
  assert.equal(trial.politics.Germany.opinions.Poland, -20);
  assert.equal(decideAgentFate(trial, "a1", "execute").note.kind, "dropped", "decided once");
  const turned = decideAgentFate(hoi, "a1", "turn").hoi;
  assert.equal(networkOf(turned, "Germany", "Poland").compromised, true);
  const lie = intelReport(turned, "Poland", { compromised: true, seed: "x" });
  assert.notDeepEqual(lie, intelReport(turned, "Poland"), "a turned network feeds false reports");
  const exchange = decideAgentFate(hoi, "a1", "exchange").hoi;
  assert.equal(exchange.politics.Poland.opinions.Germany, 10);
  assert.equal(aiAgentFate(hoi, hoi.capturedAgents[0], { holderIntelligence: 70 }), "turn");
  assert.equal(aiAgentFate(hoi, hoi.capturedAgents[0], { atWar: () => true }), "trial");
  assert.equal(aiAgentFate({ ...hoi, politics: { Poland: { opinions: { Germany: 30 } } } }, hoi.capturedAgents[0]), "exchange");
});

test("AI countries spy by default on their enemy; the big AI may order it; the player's panel; the prompt", () => {
  const ops = defaultEspionageOps("Germany", { hoi: world().hoi, enemies: ["Poland"] });
  assert.deepEqual(ops, [{ op: "build", polity: "Germany", target: "Poland" }]);
  const strong = defaultEspionageOps("Germany", { hoi: { ...world().hoi, networks: { Germany: { Poland: { strength: 60, building: true } } } }, enemies: ["Poland"] });
  assert.deepEqual(strong, [{ op: "mission", polity: "Germany", target: "Poland", kind: "sabotage" }], "at war: sabotage");
  assert.deepEqual(defaultEspionageOps("Germany", { hoi: world().hoi, enemies: [] }), [], "no rival, no spying");
  assert.deepEqual(normalizeEconomyOp({ op: "espionnage", polity: "Germany", enemy: "Poland", mission: "party", label: "fascist" }), { op: "spy", polity: "Germany", target: "Poland", mission: "party", detail: "fascist" });
  assert.equal(applyEconomyOps({ nations: { Germany: {} } }, [{ op: "spy", polity: "Germany", enemy: "Poland", mission: "intel" }]).notes.length, 0);
  // The player.
  const w = world({ networks: { Germany: { Poland: { strength: 45, building: true } } }, capturedAgents: [{ id: "a1", owner: "Poland", holder: "Germany", mission: "intel", status: "held" }], intelReports: { Germany: [{ date: "1936-02-01", target: "Poland", divisions: 30, manpower: 1, ideology: "authoritarian", stability: 55, warSupport: 40 }] } });
  const model = espionagePanelModel(w, "Germany");
  assert.equal(model.networks[0].target, "Poland");
  assert.equal(model.networks[0].chances.intel.ready, true);
  assert.equal(model.networks[0].chances.tech.ready, false);
  assert.equal(model.held.length, 1);
  const launched = applyPlayerEspionage(w, "Germany", { op: "mission", target: "Poland", kind: "intel" }, { date: "1936-02-01" });
  assert.equal(launched.world.hoi.spyMissions.length, 1);
  assert.equal(decidePlayerAgent(w, "a1", "exchange").world.hoi.capturedAgents[0].status, "exchange");
  assert.match(describeEspionageLine(w.hoi, "Germany"), /^  Espionage — networks: Poland 45 \(building\); latest reports: Poland \(1936-02-01\): 30 divisions, authoritarian regime, stability 55%; holds: Poland's intel agent\.$/);
});

test("wired: resolved before the AI writes, applied with the turn, the orders, the panel", () => {
  const gameplay = read("Game", "AI", "gameplay.js");
  const politics = gameplay.indexOf("const enginePolitics = resolvePoliticsForJump(");
  const espionage = gameplay.indexOf("const engineEspionage = resolveEspionageForJump(bundle, { originDate, targetDate });");
  assert.ok(politics > 0 && espionage > politics);
  const apply = gameplay.indexOf("impactedWorld = applyEngineEspionage(impactedWorld, result.engineEspionage,");
  assert.ok(apply > gameplay.indexOf("impactedWorld = applyEnginePolitics(") && gameplay.indexOf("impactedWorld = advanceHoiLayer(impactedWorld, {") > apply);
  assert.match(gameplay, /if \(segmentIndex === 0\) addEngineEspionage\(candidate, context\.engineEspionage, \{ receipt: draft \}\);/);
  assert.match(gameplay, /worldWithImpacts = applySpyOpsAfterTurn\(worldWithImpacts, freshEvents,/);
  assert.match(read("Game", "AI", "gameplaySchemas.js"), /"landing", "intel", "sabotage", "tech", "party"\]/);
  assert.match(read("Game", "GameUI", "focusPolitics.jsx"), /<EspionageTab world=\{world\} country=\{country\} language=\{language\} \/>/);
});
