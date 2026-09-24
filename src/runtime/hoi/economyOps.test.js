// Run: node --test src/runtime/hoi/economyOps.test.js
//
// Runs without node_modules.
//
// Ce que ces tests tiennent : une opération valide change world.hoi, une valeur
// absurde est ramenée dans ses bornes et le reçu le dit, un pays inconnu est
// refusé, une même source ne s'additionne pas, et rien n'est jamais créé à partir
// de rien (stock négatif, usines inexistantes, modificateur permanent).

import test from "node:test";
import assert from "node:assert/strict";

import { HOI_TUNING, advanceHoiLayer, advanceNation, createNation } from "./engine.js";
import { ECONOMY_OP_LIMITS, applyEconomyOps, applyEconomyOpsFromEvents, normalizeEconomyOp } from "./economyOps.js";

const hoi = () => ({
  version: 1,
  lastDate: "1936-01-01",
  lastReport: null,
  nations: {
    Germany: createNation({
      stocks: { acier: 200, chrome: 10 },
      extraction: { acier: 72 },
      factories: { civilian: 30, military: 14 },
      lines: [
        { id: "fusils", equipment: "fusils", factories: 6, efficiency: 0.5, unitCost: 0.5, resources: { acier: 1 } },
        { id: "chars", equipment: "chars", factories: 2, efficiency: 0.4, unitCost: 8, resources: { acier: 2, chrome: 1 } },
      ],
    }),
    France: createNation({ stocks: { acier: 100 }, factories: { civilian: 28, military: 11 } }),
  },
});

const kinds = (notes) => notes.map((note) => note.kind);

test("la forme est normalisée, et une entrée incomplète est rejetée", () => {
  assert.deepEqual(
    normalizeEconomyOp({ op: "Strike", country: "Germany", value: "-0.2", label: "Grève de la Ruhr" }),
    { op: "modifier", polity: "Germany", value: -0.2, label: "Grève de la Ruhr" },
  );
  assert.deepEqual(
    normalizeEconomyOp({ op: "stock", polity: "France", resource: "Pétrole", amount: 10 }),
    { op: "stock", polity: "France", resource: "petrole", amount: 10 },
  );
  assert.equal(normalizeEconomyOp({ op: "stock", polity: "France", resource: "acier", amount: 0 }), null);
  assert.equal(normalizeEconomyOp({ op: "modifier", value: 0.1 }), null, "pas de pays");
  assert.equal(normalizeEconomyOp({ op: "teleport", polity: "France" }), null, "opération inconnue");
  assert.equal(normalizeEconomyOp({ op: "line", polity: "France", factories: 3 }), null, "ni ligne ni équipement");
});

test("une grève devient un modificateur daté, qui réduit la production puis expire", () => {
  const result = applyEconomyOps(hoi(), [{ op: "modifier", polity: "germany", value: -0.2, days: 10, label: "Grève" }], { date: "1936-01-05" });
  assert.equal(result.applied, 1);
  const [modifier] = result.hoi.nations.Germany.modifiers;
  assert.equal(modifier.value, -0.2);
  assert.equal(modifier.untilDate, "1936-01-15");
  const striking = advanceNation(result.hoi.nations.Germany, 5, { date: "1936-01-10" }).report.produced.fusils;
  const normal = advanceNation(hoi().nations.Germany, 5, { date: "1936-01-10" }).report.produced.fusils;
  assert.ok(striking < normal);
});

test("un modificateur absurde est borné, et le reçu le dit", () => {
  const result = applyEconomyOps(hoi(), [{ op: "modifier", polity: "France", value: 5, days: 9999, label: "Miracle" }], { date: "1936-01-01" });
  const [modifier] = result.hoi.nations.France.modifiers;
  assert.equal(modifier.value, HOI_TUNING.modifierMax);
  assert.equal(modifier.untilDate, "1936-12-31", "365 jours au plus");
  assert.deepEqual(kinds(result.notes), ["adjusted", "adjusted"]);
});

test("la même source ne s'additionne pas : elle se remplace", () => {
  const op = { op: "modifier", polity: "Germany", value: -0.1, label: "Grève de la Ruhr" };
  const once = applyEconomyOps(hoi(), [op], { date: "1936-01-01" }).hoi;
  const twice = applyEconomyOps(once, [{ ...op, value: -0.3 }], { date: "1936-02-01" }).hoi;
  assert.equal(twice.nations.Germany.modifiers.length, 1);
  assert.equal(twice.nations.Germany.modifiers[0].value, -0.3);
});

test("le nombre de modificateurs par nation est plafonné", () => {
  const ops = Array.from({ length: ECONOMY_OP_LIMITS.maxModifiersPerNation + 2 }, (_, i) => (
    { op: "modifier", polity: "France", value: 0.01, label: `Contrat ${i}` }
  ));
  const result = applyEconomyOps(hoi(), ops, { date: "1936-01-01" });
  assert.equal(result.hoi.nations.France.modifiers.length, ECONOMY_OP_LIMITS.maxModifiersPerNation);
  assert.equal(kinds(result.notes).filter((kind) => kind === "dropped").length, 2);
});

test("sans date valide, un modificateur est refusé plutôt que rendu permanent", () => {
  const result = applyEconomyOps(hoi(), [{ op: "modifier", polity: "France", value: 0.1 }], { date: null });
  assert.equal(result.hoi.nations.France.modifiers.length, 0);
  assert.deepEqual(kinds(result.notes), ["dropped"]);
});

test("un pays inconnu est refusé, les autres opérations passent", () => {
  const result = applyEconomyOps(hoi(), [
    { op: "stock", polity: "Atlantis", resource: "acier", amount: 10 },
    { op: "stock", polity: "France", resource: "acier", amount: 10 },
  ], { date: "1936-01-01", title: "Contrats" });
  assert.equal(result.applied, 1);
  assert.equal(result.hoi.nations.France.stocks.acier, 110);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0].text, /^Event "Contrats": economyOps — "Atlantis"/);
});

test("un mouvement de stock est borné et ne passe jamais sous zéro", () => {
  const seized = applyEconomyOps(hoi(), [{ op: "stock", polity: "Germany", resource: "chrome", amount: -1000 }], { date: "1936-01-01" });
  assert.equal(seized.hoi.nations.Germany.stocks.chrome, 5, "au plus max(25 % de 10, 0, plancher 5)");
  const gift = applyEconomyOps(hoi(), [{ op: "stock", polity: "Germany", resource: "acier", amount: 1000 }], { date: "1936-01-01" });
  assert.equal(gift.hoi.nations.Germany.stocks.acier, 272, "au plus un mois d'extraction (72)");
  const nothing = applyEconomyOps(hoi(), [{ op: "stock", polity: "France", resource: "petrole", amount: -10 }], { date: "1936-01-01" });
  assert.equal(nothing.applied, 0);
  assert.deepEqual(kinds(nothing.notes), ["dropped"]);
});

test("réaffecter des usines est borné par les usines militaires libres", () => {
  const result = applyEconomyOps(hoi(), [{ op: "line", polity: "Germany", equipment: "chars", factories: 50 }], { date: "1936-01-01" });
  const chars = result.hoi.nations.Germany.lines.find((line) => line.id === "chars");
  assert.equal(chars.factories, 8, "14 militaires - 6 sur les fusils");
  assert.ok(chars.efficiency < 0.4, "les usines ajoutées font baisser l'efficacité");
  assert.deepEqual(kinds(result.notes), ["adjusted"]);
});

test("une nouvelle ligne n'est possible que pour un équipement du catalogue", () => {
  const planes = applyEconomyOps(hoi(), [{ op: "line", polity: "France", equipment: "chasseurs", factories: 3 }], { date: "1936-01-01" });
  const line = planes.hoi.nations.France.lines.find((entry) => entry.equipment === "chasseurs");
  assert.equal(line.factories, 3);
  assert.equal(line.efficiency, HOI_TUNING.efficiencyFloor);
  const rockets = applyEconomyOps(hoi(), [{ op: "line", polity: "France", equipment: "fusées", factories: 3 }], { date: "1936-01-01" });
  assert.equal(rockets.applied, 0);
  assert.match(rockets.notes[0].text, /is unknown; available: fusils/);
});

test("sans couche HOI4, les opérations sont ignorées et le reçu le dit", () => {
  const result = applyEconomyOps(undefined, [{ op: "stock", polity: "France", resource: "acier", amount: 5 }]);
  assert.equal(result.hoi, undefined);
  assert.deepEqual(kinds(result.notes), ["dropped"]);
  assert.deepEqual(applyEconomyOps(undefined, []).notes, [], "rien à dire quand il n'y a rien");
});

test("les opérations d'un tour s'appliquent événement par événement, datées de l'événement", () => {
  const events = [
    { title: "Grève", date: "1936-01-10", impacts: { economyOps: [{ op: "modifier", polity: "Germany", value: -0.1, days: 5 }] } },
    { title: "Rien", date: "1936-01-12", impacts: {} },
    { title: "Don", date: "pas une date", impacts: { economyOps: [{ op: "stock", polity: "France", resource: "acier", amount: 5 }] } },
  ];
  const result = applyEconomyOpsFromEvents(hoi(), events, { date: "1936-01-01" });
  assert.equal(result.applied, 2);
  assert.equal(result.hoi.nations.Germany.modifiers[0].untilDate, "1936-01-15");
  assert.equal(result.hoi.nations.France.stocks.acier, 105);
});

test("pas de double comptage : le même tour rejoué depuis le même état donne le même résultat", () => {
  const base = hoi();
  const events = [{ title: "Don", date: "1936-01-10", impacts: { economyOps: [{ op: "stock", polity: "France", resource: "acier", amount: 5 }] } }];
  const once = advanceHoiLayer({ hoi: applyEconomyOpsFromEvents(base, events).hoi }, { fromDate: "1936-01-01", toDate: "1936-02-01" });
  const again = advanceHoiLayer({ hoi: applyEconomyOpsFromEvents(base, events).hoi }, { fromDate: "1936-01-01", toDate: "1936-02-01" });
  assert.deepEqual(once, again);
  assert.equal(base.nations.France.stocks.acier, 100, "l'état de départ n'est pas modifié");
});
