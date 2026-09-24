// Run: node --test src/runtime/hoi/engine.test.js
//
// Runs without node_modules: engine.js only imports gameDates.js.
//
// Ce que ces tests tiennent : la couche est inerte sur une partie normale,
// la production dépend des jours écoulés (tours de durée variable), une pénurie
// réduit la production au lieu de créer des ressources, et un modificateur
// (grève, bonus IA) reste borné quoi qu'on lui demande.

import test from "node:test";
import assert from "node:assert/strict";

import {
  HOI_TUNING,
  advanceHoiLayer,
  advanceNation,
  buildEconomyPromptBlock,
  createNation,
  enableHoiLayer,
  normalizeModifier,
} from "./engine.js";

const france = () => createNation({
  stocks: { acier: 100, petrole: 50 },
  extraction: { acier: 30 },
  factories: { civilian: 28, military: 4 },
  lines: [{ id: "fusils", equipment: "fusils", factories: 4, efficiency: 0.5, unitCost: 0.5, resources: { acier: 2 } }],
});

test("une partie sans world.hoi n'est pas touchée", () => {
  const world = { units: [], markers: [] };
  assert.equal(advanceHoiLayer(world, { fromDate: "1936-01-01", toDate: "1936-02-01" }), world);
});

test("aucun jour écoulé : rien ne bouge", () => {
  const world = enableHoiLayer({}, { startDate: "1936-01-01", nations: { France: france() } });
  assert.equal(advanceHoiLayer(world, { fromDate: "1936-01-01", toDate: "1936-01-01" }), world);
});

test("la production suit la durée du saut", () => {
  const week = advanceNation(france(), 7).report.produced.fusils ?? 0;
  const month = advanceNation(france(), 30).report.produced.fusils ?? 0;
  assert.ok(week > 0, "une semaine produit déjà quelque chose");
  assert.ok(month > week * 3, "un mois produit nettement plus qu'une semaine");
});

test("l'extraction s'ajoute au prorata des jours", () => {
  const { nation } = advanceNation(createNation({ stocks: { acier: 0 }, extraction: { acier: 30 } }), 15);
  assert.equal(nation.stocks.acier, 15);
});

test("une pénurie réduit la production sans créer de ressources", () => {
  const starved = createNation({
    stocks: { acier: 1 },
    factories: { military: 4 },
    lines: [{ equipment: "chars", factories: 4, efficiency: 0.9, unitCost: 1, resources: { acier: 10 } }],
  });
  const fed = createNation({ ...starved, stocks: { acier: 1000 } });
  const a = advanceNation(starved, 30);
  const b = advanceNation(fed, 30);
  assert.ok(a.report.shortages.acier > 0, "la pénurie est signalée");
  assert.ok((a.report.produced.chars ?? 0) < (b.report.produced.chars ?? 0));
  assert.ok(a.nation.stocks.acier >= 0, "le stock ne passe jamais en négatif");
});

test("un modificateur est borné, même si l'IA demande l'absurde", () => {
  assert.equal(normalizeModifier({ value: 5 }).value, HOI_TUNING.modifierMax);
  assert.equal(normalizeModifier({ value: -5 }).value, HOI_TUNING.modifierMin);
  assert.equal(normalizeModifier({ value: 0 }), null);
});

test("une grève réduit la production puis expire", () => {
  const base = france();
  const strike = { ...base, modifiers: [{ id: "greve", value: -0.1, untilDate: "1936-01-20" }] };
  const withStrike = advanceNation(strike, 10, { date: "1936-01-10" });
  const without = advanceNation(base, 10, { date: "1936-01-10" });
  assert.ok((withStrike.report.produced.fusils ?? 0) <= (without.report.produced.fusils ?? 0));
  const after = advanceNation(withStrike.nation, 1, { date: "1936-02-01" });
  assert.equal(after.nation.modifiers.length, 0, "la grève a expiré");
});

test("le saut complet met à jour la date et le rapport", () => {
  const world = enableHoiLayer({ units: [] }, { startDate: "1936-01-01", nations: { France: france() } });
  const next = advanceHoiLayer(world, { fromDate: "1936-01-01", toDate: "1936-04-01" });
  assert.equal(next.hoi.lastDate, "1936-04-01");
  assert.equal(next.hoi.lastReport.days, 91);
  assert.ok(next.hoi.nations.France.lines[0].produced > 0);
  assert.deepEqual(next.units, [], "le reste du monde est conservé");
  assert.notEqual(next, world, "le monde d'origine n'est pas modifié");
  assert.equal(world.hoi.lastDate, "1936-01-01");
});

test("le bloc de prompt résume stocks, production et pénuries", () => {
  const world = enableHoiLayer({}, { startDate: "1936-01-01", nations: { France: france() } });
  const next = advanceHoiLayer(world, { fromDate: "1936-01-01", toDate: "1936-02-01" });
  const text = buildEconomyPromptBlock(next, "France");
  assert.match(text, /\[ÉCONOMIE — France\]/);
  assert.match(text, /fusils/);
  assert.equal(buildEconomyPromptBlock(next, "Inconnu"), "");
});
