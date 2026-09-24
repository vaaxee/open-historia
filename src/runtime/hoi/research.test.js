// Run: node --test src/runtime/hoi/research.test.js
//
// Ce que ces tests tiennent : la recherche avance au prorata des jours, coûte plus
// cher en avance sur son époque, applique des effets bornés, remplit seule les
// emplacements d'un pays géré par le moteur mais jamais ceux du joueur, et les
// actions du panneau (lancer, arrêter, file d'attente) respectent les prérequis.

import test from "node:test";
import assert from "node:assert/strict";

import { advanceHoiLayer, advanceNation, createNation, enableHoiLayer } from "./engine.js";
import {
  RESEARCH_TUNING,
  advanceResearch,
  aheadPenalty,
  applyTechEffects,
  dequeueResearch,
  enqueueResearch,
  pickAutoTech,
  researchSlotCount,
  startResearch,
  stopResearch,
  techStatus,
} from "./research.js";

const tree = {
  techs: [
    { id: "a", name: "Tech A", branch: "industrie", year: 1936, days: 100, requires: [], effects: [{ type: "efficiency", value: 0.03 }] },
    { id: "b", name: "Tech B", branch: "blindes", year: 1936, days: 100, requires: ["a"], effects: [{ type: "cost", equipment: "chars", value: 0.2 }] },
    { id: "c", name: "Tech C", branch: "industrie", year: 1940, days: 100, requires: [], effects: [{ type: "extraction", resource: "acier", value: 0.1 }] },
    { id: "d", name: "Tech D", branch: "industrie", year: 1936, days: 100, requires: [], effects: [{ type: "extraction", resource: "chrome", value: 0.2 }] },
  ],
  equipment: {},
};

const nation = (extra = {}) => createNation({
  stocks: { acier: 100 },
  extraction: { acier: 30 },
  factories: { civilian: 12, military: 4 },
  lines: [{ id: "chars", equipment: "chars", factories: 4, efficiency: 0.5, unitCost: 8, resources: { acier: 2 } }],
  ...extra,
});

test("le nombre d'emplacements suit les usines civiles", () => {
  assert.equal(researchSlotCount({ factories: { civilian: 3 } }), 1);
  assert.equal(researchSlotCount({ factories: { civilian: 12 } }), 2);
  assert.equal(researchSlotCount({ factories: { civilian: 22 } }), 3);
  assert.equal(researchSlotCount({ factories: { civilian: 60 } }), RESEARCH_TUNING.maxSlots);
});

test("une tech en avance sur son époque coûte plus cher, jusqu'à ×3", () => {
  assert.equal(aheadPenalty({ year: 1936 }, "1936-01-01"), 0);
  assert.equal(aheadPenalty({ year: 1938 }, "1936-01-01"), 1);
  assert.equal(aheadPenalty({ year: 1950 }, "1936-01-01"), RESEARCH_TUNING.aheadPenaltyMax);
  assert.equal(aheadPenalty({ year: 1930 }, "1936-01-01"), 0, "une tech en retard ne coûte pas moins");
});

test("la recherche avance au prorata des jours et se termine", () => {
  const started = startResearch(nation(), "a", tree).nation;
  const half = advanceResearch(started, 50, { date: "1936-02-20", tree });
  assert.deepEqual(half.researched, []);
  assert.equal(half.nation.research.slots[0].progress, 50);
  const full = advanceResearch(half.nation, 50, { date: "1936-04-10", tree });
  assert.deepEqual(full.researched, ["Tech A"]);
  assert.deepEqual(full.nation.research.done, ["a"]);
  assert.equal(full.nation.bonuses.efficiencyCap, 0.03);
});

test("les effets sont bornés et une ressource absente est créée modestement", () => {
  let current = nation();
  for (let i = 0; i < 10; i += 1) current = applyTechEffects(current, tree.techs[0]);
  assert.equal(current.bonuses.efficiencyCap, RESEARCH_TUNING.efficiencyBonusMax);
  const cheaper = applyTechEffects(nation(), tree.techs[1]);
  assert.equal(cheaper.lines[0].unitCost, 6.4);
  assert.equal(cheaper.bonuses.costFactor.chars, 0.8);
  let floor = nation();
  for (let i = 0; i < 10; i += 1) floor = applyTechEffects(floor, tree.techs[1]);
  assert.equal(floor.bonuses.costFactor.chars, RESEARCH_TUNING.costFactorMin);
  assert.equal(applyTechEffects(nation(), tree.techs[2]).extraction.acier, 33);
  assert.equal(applyTechEffects(nation(), tree.techs[3]).extraction.chrome, 2);
});

test("le plafond d'efficacité gagné par les techs laisse les lignes monter plus haut", () => {
  const plain = nation();
  const boosted = { ...nation(), bonuses: { efficiencyCap: 0.09, costFactor: {} } };
  const a = advanceNation(plain, 365).nation.lines[0].efficiency;
  const b = advanceNation(boosted, 365).nation.lines[0].efficiency;
  assert.ok(b > a, `${b} > ${a}`);
  assert.ok(b <= 0.99);
});

test("un pays géré par le moteur remplit seul ses emplacements, le joueur non", () => {
  const auto = advanceResearch(nation(), 10, { date: "1936-01-10", tree, auto: true });
  assert.equal(auto.nation.research.slots.length, 2);
  const player = advanceResearch(nation(), 10, { date: "1936-01-10", tree, auto: false });
  assert.equal(player.nation.research.slots.length, 0);
});

test("le choix automatique préfère ce que le pays produit, puis l'industrie, sans tech en avance", () => {
  const withA = { ...nation(), research: { done: ["a"], slots: [], queue: [], partial: {} } };
  assert.equal(pickAutoTech(withA, tree, "1936-01-01"), "b", "le pays produit des chars");
  assert.equal(pickAutoTech(nation(), tree, "1936-01-01"), "a", "industrie de son époque avant l'industrie en avance");
});

test("la file d'attente attend les prérequis et se vide dans les emplacements libres", () => {
  let current = enqueueResearch(nation(), "b", tree).nation;
  assert.equal(techStatus(current, tree.techs[1]), "queued");
  current = startResearch(current, "a", tree).nation;
  current = advanceResearch(current, 100, { date: "1936-04-10", tree }).nation;
  assert.deepEqual(current.research.done, ["a"]);
  assert.deepEqual(current.research.slots.map((slot) => slot.techId), ["b"], "b a pris la place libérée");
  assert.deepEqual(current.research.queue, []);
});

test("lancer une tech verrouillée est refusé ; arrêter garde l'avancement", () => {
  assert.equal(startResearch(nation(), "b", tree).error, "locked");
  let current = startResearch(nation(), "a", tree).nation;
  current = advanceResearch(current, 40, { date: "1936-02-10", tree }).nation;
  current = stopResearch(current, "a").nation;
  assert.equal(current.research.partial.a, 40);
  current = startResearch(current, "a", tree).nation;
  assert.equal(current.research.slots[0].progress, 40, "reprend où elle en était");
  assert.equal(startResearch(startResearch(current, "d", tree).nation, "c", tree).error, "no-free-slot");
  assert.equal(dequeueResearch(current, "zzz").error, "not-queued");
});

test("advanceHoiLayer fait chercher tout le monde sauf le joueur, et le rapport le dit", () => {
  const world = enableHoiLayer({}, { startDate: "1936-01-01", nations: { Germany: nation(), France: nation() } });
  world.hoi.tech = { tree };
  const next = advanceHoiLayer(world, { fromDate: "1936-01-01", toDate: "1936-06-01", player: "France" });
  assert.ok(next.hoi.nations.Germany.research.done.length > 0);
  assert.deepEqual(next.hoi.nations.France.research.done, []);
  assert.ok(next.hoi.lastReport.nations.Germany.researched.length > 0);
  assert.deepEqual(next.hoi.lastReport.nations.France.researched, []);
});

test("sans arbre, la recherche est inerte", () => {
  const result = advanceResearch(nation(), 30, { date: "1936-01-31", tree: null, auto: true });
  assert.deepEqual(result.researched, []);
  assert.deepEqual(result.nation.research.slots, []);
});
