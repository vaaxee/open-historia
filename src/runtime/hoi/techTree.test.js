// Run: node --test src/runtime/hoi/techTree.test.js
//
// Ce que ces tests tiennent : un arbre venu de l'IA est ramené dans ses bornes
// (identifiants, branches, années, coûts, effets, ressources, prérequis, boucles),
// les arbres de secours passent la même validation sans correction, l'installation
// donne les techs antérieures à la date, et un équipement de l'arbre n'est
// disponible qu'après sa tech.

import test from "node:test";
import assert from "node:assert/strict";

import { createNation } from "./engine.js";
import { applyEconomyOps } from "./economyOps.js";
import { HOI_FALLBACK_TECH_TREES } from "./techTreePresets.js";
import { enableHoiLayerFromPresets } from "./presets.js";
import {
  TECH_TREE_LIMITS,
  collectHoiResources,
  fallbackTechTree,
  installTechTree,
  isEquipmentUnlocked,
  isUsableTechTree,
  normalizeTechTree,
} from "./techTree.js";

const resources1936 = ["acier", "aluminium", "caoutchouc", "chrome", "petrole", "tungstene"];

test("les arbres de secours passent la validation sans aucune correction", () => {
  for (const [series, startYear, resources] of [["1936", 1936, resources1936], ["1912", 1911, ["acier", "charbon", "petrole", "caoutchouc"]]]) {
    const { tree, notes } = normalizeTechTree(HOI_FALLBACK_TECH_TREES[series], { startYear, resources });
    assert.deepEqual(notes, [], `${series} : ${notes.join(" / ")}`);
    assert.equal(tree.techs.length, HOI_FALLBACK_TECH_TREES[series].techs.length);
    assert.ok(isUsableTechTree(tree));
  }
});

test("une réponse absurde de l'IA est ramenée dans ses bornes", () => {
  const { tree, notes } = normalizeTechTree({
    techs: [
      { id: "Réacteur à fusion", name: "Fusion", branch: "science-fiction", year: 2150, days: 99999, effects: [
        { type: "efficiency", value: 3 },
        { type: "extraction", resource: "uranium", value: 0.5 },
        { type: "teleport" },
      ] },
      { id: "chars2", name: "Chars", branch: "armor", year: 1938, days: 1, requires: ["inconnue"], effects: [
        { type: "unlock", equipment: "Chars Moyens", unitCost: 900, resources: [{ resource: "acier", amount: 50 }, { resource: "mithril", amount: 1 }] },
        { type: "cost", equipment: "licornes", value: 0.5 },
      ] },
      { id: "chars2", name: "Doublon" },
      { name: "" },
    ],
  }, { startYear: 1936, resources: resources1936 });
  const [fusion, chars] = tree.techs;
  assert.equal(fusion.id, "reacteur_a_fusion");
  assert.equal(fusion.branch, "industrie");
  assert.equal(fusion.year, 1936 + TECH_TREE_LIMITS.yearsAfter);
  assert.equal(fusion.days, TECH_TREE_LIMITS.maxDays);
  assert.deepEqual(fusion.effects, [{ type: "efficiency", value: TECH_TREE_LIMITS.efficiency[1] }]);
  assert.equal(chars.branch, "blindes");
  assert.equal(chars.days, TECH_TREE_LIMITS.minDays);
  assert.deepEqual(chars.requires, []);
  assert.deepEqual(chars.effects, [{
    type: "unlock", equipment: "chars_moyens", label: "chars moyens", unitCost: 60, resources: { acier: 5 },
  }]);
  assert.deepEqual(Object.keys(tree.equipment), ["chars_moyens"]);
  assert.equal(tree.techs.length, 2);
  assert.ok(notes.length >= 6, notes.join(" / "));
});

test("les boucles de prérequis sont écartées, avec ce qui en dépend", () => {
  const { tree, notes } = normalizeTechTree({
    techs: [
      { id: "x", name: "X", branch: "industrie", year: 1936, requires: ["y"] },
      { id: "y", name: "Y", branch: "industrie", year: 1936, requires: ["x"] },
      { id: "z", name: "Z", branch: "industrie", year: 1936, requires: ["x"] },
      { id: "w", name: "W", branch: "industrie", year: 1936, requires: ["z"] },
      { id: "ok", name: "OK", branch: "industrie", year: 1936 },
    ],
  }, { startYear: 1936 });
  assert.deepEqual(tree.techs.map((tech) => tech.id), ["ok"]);
  assert.ok(notes.some((note) => /loop/.test(note)));
});

test("un équipement ne se débloque qu'une fois, et pas un équipement de base", () => {
  const { tree } = normalizeTechTree({
    techs: [
      { id: "a", name: "A", branch: "blindes", year: 1936, effects: [{ type: "unlock", equipment: "super", unitCost: 5, resources: { acier: 1 } }] },
      { id: "b", name: "B", branch: "blindes", year: 1936, effects: [{ type: "unlock", equipment: "super", unitCost: 5, resources: { acier: 1 } }] },
      { id: "c", name: "C", branch: "blindes", year: 1936, effects: [{ type: "unlock", equipment: "chars", unitCost: 5, resources: { acier: 1 } }] },
    ],
  }, { startYear: 1936 });
  assert.equal(tree.equipment.super.techId, "a");
  assert.deepEqual(tree.techs[1].effects, []);
  assert.deepEqual(tree.techs[2].effects, []);
});

test("l'installation donne les techs antérieures : à jour pour un pays détaillé, en retard pour les autres", () => {
  const { world } = enableHoiLayerFromPresets({ ownerCodes: ["Germany", "Luxembourg"] }, { startDate: "1938-06-01", seriesId: "1936" });
  const tree = fallbackTechTree("1936", { startYear: 1938, resources: collectHoiResources(world.hoi) });
  const hoi = installTechTree(world.hoi, tree, { date: "1938-06-01" });
  const germany = new Set(hoi.nations.Germany.research.done);
  const luxembourg = new Set(hoi.nations.Luxembourg.research.done);
  assert.ok(germany.has("char_leger_2"), "1936 est acquis");
  assert.ok(germany.has("antiaerien"), "1937 aussi");
  assert.ok(!germany.has("char_moyen"), "1938 est l'année en cours : à rechercher");
  assert.ok(germany.has("rationalisation"));
  assert.ok(!germany.has("chasseur_avance"), "1940 est dans le futur");
  assert.ok(luxembourg.size < germany.size);
  assert.equal(hoi.tech.installedAt, "1938-06-01");
  assert.equal(hoi.nations.Germany.bonuses.efficiencyCap, 0, "les techs d'avant la partie n'ont pas d'effet chiffré");
});

test("un équipement de l'arbre n'est disponible, pour l'IA comme pour le joueur, qu'après sa tech", () => {
  const { world } = enableHoiLayerFromPresets({ ownerCodes: ["Germany"] }, { startDate: "1936-01-01" });
  const tree = fallbackTechTree("1936", { startYear: 1936, resources: collectHoiResources(world.hoi) });
  const hoi = installTechTree(world.hoi, tree, { date: "1936-01-01" });
  const op = [{ op: "line", polity: "Germany", equipment: "chars_moyens", factories: 2 }];
  const refused = applyEconomyOps(hoi, op, { date: "1936-01-01" });
  assert.equal(refused.applied, 0);
  assert.match(refused.notes[0].text, /not unlocked yet/);
  const researched = { ...hoi, nations: { Germany: { ...hoi.nations.Germany, research: { ...hoi.nations.Germany.research, done: [...hoi.nations.Germany.research.done, "char_moyen"] } } } };
  assert.ok(isEquipmentUnlocked(researched, researched.nations.Germany, "chars_moyens"));
  // Toutes les usines militaires allemandes sont prises : on en libère deux d'abord.
  const accepted = applyEconomyOps(researched, [{ op: "line", polity: "Germany", equipment: "fusils", factories: 4 }, ...op], { date: "1936-01-01" });
  const line = accepted.hoi.nations.Germany.lines.find((entry) => entry.equipment === "chars_moyens");
  assert.equal(line.unitCost, 12);
  assert.equal(line.factories, 2);
});

test("une opération research avance une tech sans jamais l'offrir", () => {
  const tree = normalizeTechTree({ techs: [{ id: "radar", name: "Radar", branch: "aviation", year: 1936, days: 100 }] }, { startYear: 1936 }).tree;
  const hoi = { nations: { Germany: createNation({ factories: { civilian: 30 } }) }, tech: { tree } };
  const once = applyEconomyOps(hoi, [{ op: "research", polity: "Germany", techId: "radar", value: 0.2 }], { date: "1936-01-01" });
  assert.equal(once.hoi.nations.Germany.research.partial.radar, 20);
  let current = once.hoi;
  for (let i = 0; i < 10; i += 1) current = applyEconomyOps(current, [{ op: "research", polity: "Germany", techId: "radar", value: 5 }], { date: "1936-01-01" }).hoi;
  assert.equal(current.nations.Germany.research.partial.radar, 99, "au plus coût − 1 jour");
  assert.deepEqual(current.nations.Germany.research.done, []);
  const unknown = applyEconomyOps(hoi, [{ op: "research", polity: "Germany", techId: "teleporteur" }], { date: "1936-01-01" });
  assert.match(unknown.notes[0].text, /not in this campaign's tech tree/);
});
