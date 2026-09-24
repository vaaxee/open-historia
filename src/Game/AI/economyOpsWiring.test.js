// Run: node --test src/Game/AI/economyOpsWiring.test.js
//
// La couche HOI4 traverse plusieurs modules du tour. Ces tests tiennent les
// jointures : l'outil d'une partie ordinaire est exactement celui d'avant, une
// réponse qui porte economyOps est acceptée, l'événement stocké les garde, le
// reçu les compte, et world.hoi survit à la normalisation du monde.

import test from "node:test";
import assert from "node:assert/strict";

import { GAMEPLAY_TOOLS, normalizeGameplayPayload, validateGameplayPayload, withoutEconomyOps } from "./gameplaySchemas.js";
import { normalizeEventEntry, normalizeWorldState } from "../../runtime/gameState.js";
import { createApplicationReceipt, tallyAppliedEvents } from "../../runtime/applicationReceipt.js";
import { enableHoiLayer, createNation } from "../../runtime/hoi/engine.js";

const findImpacts = (schema, out = []) => {
  if (Array.isArray(schema)) {
    schema.forEach((entry) => findImpacts(entry, out));
    return out;
  }
  if (!schema || typeof schema !== "object") return out;
  if (schema.properties?.unitOps) out.push(schema.properties);
  Object.values(schema).forEach((entry) => findImpacts(entry, out));
  return out;
};

const strike = { op: "modifier", polity: "Germany", value: -0.2, days: 30, label: "Grève de la Ruhr" };

const jumpPayload = (impacts) => ({
  events: [{
    date: "1936-01-10",
    title: "Grève dans la Ruhr",
    description: "Les mineurs de la Ruhr cessent le travail.",
    importance: "major",
    impacts,
  }],
  stopDate: "1936-02-01",
  summary: "Un mois agité.",
  diplomaticOutreach: [],
  storylineUpdates: "",
  warUpdates: "",
  relationUpdates: "",
  agreementUpdates: "",
});

test("une partie ordinaire reçoit l'outil de saut sans economyOps", () => {
  const offered = findImpacts(GAMEPLAY_TOOLS.jumpForward.schema);
  assert.ok(offered.length && offered.every((impacts) => impacts.economyOps), "le schéma complet le propose");
  const stripped = findImpacts(withoutEconomyOps(GAMEPLAY_TOOLS.jumpForward).schema);
  assert.ok(stripped.length && stripped.every((impacts) => !impacts.economyOps), "retiré partout");
  assert.ok(
    findImpacts(GAMEPLAY_TOOLS.jumpForward.schema).every((impacts) => impacts.economyOps),
    "l'outil d'origine n'est pas modifié",
  );
});

test("une réponse de saut qui porte economyOps est valide, alias compris", () => {
  const verdict = validateGameplayPayload("jumpForward", jumpPayload({ economyOps: [strike] }));
  assert.equal(verdict.valid, true, verdict.error);
  const aliased = normalizeGameplayPayload("jumpForward", jumpPayload({ economy: [strike] }));
  assert.deepEqual(aliased.events[0].impacts.economyOps, [strike]);
});

test("l'événement stocké garde ses economyOps normalisées", () => {
  const event = normalizeEventEntry({
    date: "1936-01-10",
    title: "Grève",
    description: "Grève dans la Ruhr.",
    impacts: { economyOps: [strike, { op: "teleport", polity: "Germany" }] },
  });
  assert.deepEqual(event.impacts.economyOps, [strike], "l'entrée invalide est écartée");
  assert.deepEqual(normalizeEventEntry({ title: "Rien", description: "." }).impacts.economyOps, []);
});

test("le reçu compte les opérations économiques", () => {
  const receipt = createApplicationReceipt();
  tallyAppliedEvents(receipt, [{ impacts: { economyOps: [strike, strike] } }]);
  assert.equal(receipt.applied.economyOps, 2);
});

test("world.hoi survit à la normalisation du monde", () => {
  const world = enableHoiLayer({}, { startDate: "1936-01-01", nations: { Germany: createNation({ stocks: { acier: 5 } }) }, series: "1936" });
  const normalized = normalizeWorldState(world);
  assert.deepEqual(normalized.hoi, world.hoi);
});
