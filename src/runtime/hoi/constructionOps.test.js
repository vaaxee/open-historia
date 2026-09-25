// Run: node --test src/runtime/hoi/constructionOps.test.js
//
// Ce que ces tests tiennent : le joueur lance un chantier sur un site, il apparaît
// sur la carte en chantier et en fin de file ; un type réservé par l'arbre est
// refusé ; agrandir, réordonner et annuler font ce qu'ils disent ; on ne touche
// jamais aux bâtiments d'un autre pays.

import test from "node:test";
import assert from "node:assert/strict";

import { createNation, enableHoiLayer } from "./engine.js";
import { normalizeBuilding } from "./buildings.js";
import { cancelConstruction, moveInQueue, queueNewBuilding, queueUpgrade } from "./constructionOps.js";

const world = () => {
  const base = enableHoiLayer({
    markers: [
      { id: "essen", name: "Usine d'Essen", ownerCode: "Germany", lng: 7, lat: 51.4, status: "active", building: normalizeBuilding({ type: "usine_militaire", level: 2 }) },
      { id: "lille", name: "Usine de Lille", ownerCode: "France", lng: 3, lat: 50.6, status: "active", building: normalizeBuilding({ type: "usine_militaire", level: 1 }) },
    ],
  }, { startDate: "1936-01-01", nations: { Germany: createNation({ factories: { civilian: 20 } }), France: createNation({}) } });
  base.hoi.tech = { tree: { techs: [{ id: "synth", effects: [{ type: "building", building: "raffinerie_synthetique" }] }] } };
  return base;
};

const berlin = { name: "Berlin", lng: 13.4, lat: 52.5 };

test("un chantier neuf apparaît sur la carte, en chantier, en fin de file", () => {
  const { world: next, error } = queueNewBuilding(world(), { polity: "germany", type: "raffinerie", site: berlin, id: "new-1", date: "1936-02-01" });
  assert.equal(error, null);
  const marker = next.markers.find((entry) => entry.id === "new-1");
  assert.equal(marker.name, "Raffinerie de Berlin");
  assert.equal(marker.status, "under_construction");
  assert.equal(marker.building.level, 0);
  assert.equal(marker.ownerCode, "Germany");
  assert.ok(Math.abs(marker.lng - berlin.lng) > 0.01, "décalé du site");
  assert.deepEqual(next.hoi.nations.Germany.constructionQueue, ["new-1"]);
});

test("les refus : type réservé, type inconnu, pas de site, pays inconnu", () => {
  assert.equal(queueNewBuilding(world(), { polity: "Germany", type: "raffinerie_synthetique", site: berlin, id: "x" }).error, "type-locked");
  assert.equal(queueNewBuilding(world(), { polity: "Germany", type: "complexe_industriel", site: berlin, id: "x" }).error, "unknown-type");
  assert.equal(queueNewBuilding(world(), { polity: "Germany", type: "fort", site: null, id: "x" }).error, "no-site");
  assert.equal(queueNewBuilding(world(), { polity: "Atlantis", type: "fort", site: berlin, id: "x" }).error, "unknown-nation");
});

test("agrandir un bâtiment du joueur, jamais celui d'un autre", () => {
  const { world: next } = queueUpgrade(world(), { polity: "Germany", markerId: "essen" });
  assert.equal(next.markers[0].building.construction.targetLevel, 3);
  assert.deepEqual(next.hoi.nations.Germany.constructionQueue, ["essen"]);
  assert.equal(queueUpgrade(world(), { polity: "Germany", markerId: "lille" }).error, "unknown-type");
});

test("réordonner et annuler", () => {
  let current = queueNewBuilding(world(), { polity: "Germany", type: "fort", site: berlin, id: "f1" }).world;
  current = queueUpgrade(current, { polity: "Germany", markerId: "essen" }).world;
  current = moveInQueue(current, { polity: "Germany", markerId: "essen", delta: -1 }).world;
  assert.deepEqual(current.hoi.nations.Germany.constructionQueue, ["essen", "f1"]);
  assert.equal(moveInQueue(current, { polity: "Germany", markerId: "essen", delta: -1 }).error, "unchanged");
  current = cancelConstruction(current, { polity: "Germany", markerId: "f1" }).world;
  assert.equal(current.markers.find((entry) => entry.id === "f1"), undefined, "un chantier neuf annulé disparaît");
  current = cancelConstruction(current, { polity: "Germany", markerId: "essen" }).world;
  const essen = current.markers.find((entry) => entry.id === "essen");
  assert.equal(essen.building.level, 2, "un agrandissement annulé garde le niveau");
  assert.equal(essen.building.construction, undefined);
  assert.deepEqual(current.hoi.nations.Germany.constructionQueue, []);
});
