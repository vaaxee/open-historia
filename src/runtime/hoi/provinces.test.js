// Run: node --test src/runtime/hoi/provinces.test.js
//
// Ce que ces tests tiennent : on retrouve la province d'un point ; son
// propriétaire suit celui de sa région, changements de la partie compris ; les
// usines prennent un emplacement par niveau, un chantier compte déjà ; une
// province pleine ou sans côte refuse le chantier concerné (joueur), et un
// bâtiment déjà en trop reste.

import test from "node:test";
import assert from "node:assert/strict";

import { createNation, enableHoiLayer } from "./engine.js";
import { normalizeBuilding } from "./buildings.js";
import { queueNewBuilding, queueUpgrade } from "./constructionOps.js";
import {
  buildProvinceIndex,
  buildingSlotCost,
  ownedProvinces,
  provinceAt,
  provinceOwnerKey,
  provinceSiteError,
  provinceUsage,
} from "./provinces.js";

const square = (x, y, size = 2) => ({
  type: "Polygon",
  coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
});
const province = (id, regionId, owner, geometry, extra = {}) => ({
  type: "Feature",
  geometry,
  properties: { id, regionId, owner, name: id, slots: 2, coastal: false, terrain: "plaine", anchor: [0, 0], population: 0, ...extra },
});

const collection = {
  type: "FeatureCollection",
  features: [
    province("nord#1", "nord", "France", square(0, 48), { population: 500000, coastal: true }),
    province("nord#2", "nord", "France", square(2, 48)),
    province("rhin#1", "rhin", "Germany", square(4, 48)),
  ],
};
const index = buildProvinceIndex(collection);

const world = (markers = [], overrides = {}) => enableHoiLayer({ markers, regionOwnershipOverrides: overrides }, {
  startDate: "1936-01-01",
  nations: { France: createNation({ factories: { civilian: 20 } }), Germany: createNation({}) },
});

test("la province d'un point, et rien en mer", () => {
  assert.equal(provinceAt(index, [1, 49]).id, "nord#1");
  assert.equal(provinceAt(index, [3, 49]).id, "nord#2");
  assert.equal(provinceAt(index, [10, 10]), null);
  assert.equal(provinceAt(null, [1, 49]), null);
});

test("le propriétaire suit la région, y compris après un transfert", () => {
  const w = world();
  assert.equal(provinceOwnerKey(index.byId.get("nord#2"), w), "France");
  const moved = world([], { nord: "Germany" });
  assert.equal(provinceOwnerKey(index.byId.get("nord#2"), moved), "Germany");
  assert.deepEqual(ownedProvinces(index, moved, "Germany").map((entry) => entry.id).sort(), ["nord#1", "nord#2", "rhin#1"]);
  assert.deepEqual(ownedProvinces(index, w, "France").map((entry) => entry.id), ["nord#1", "nord#2"], "par nom");
});

test("emplacements : un par niveau d'usine, un chantier compte, un fort rien", () => {
  assert.equal(buildingSlotCost(normalizeBuilding({ type: "usine_civile", level: 2 })), 2);
  assert.equal(buildingSlotCost({ type: "usine_militaire", level: 1, construction: { targetLevel: 2 } }), 2);
  assert.equal(buildingSlotCost(normalizeBuilding({ type: "fort", level: 3 })), 0);
  assert.equal(buildingSlotCost({ type: "complexe_industriel", level: 1 }), 1);
  const markers = [
    { id: "a", lng: 1, lat: 49, building: normalizeBuilding({ type: "usine_civile", level: 2 }) },
    { id: "b", lng: 1.5, lat: 49.5, building: normalizeBuilding({ type: "fort", level: 1 }) },
    { id: "c", lng: 50, lat: 50, provinceId: "nord#2", building: normalizeBuilding({ type: "mine", level: 1 }) },
  ];
  const { used, provinceOf } = provinceUsage(index, markers);
  assert.equal(used.get("nord#1"), 2);
  assert.equal(used.get("nord#2"), 1, "la province portée par le bâtiment prime");
  assert.equal(provinceOf.get("b"), "nord#1");
});

test("une province pleine refuse une usine, pas un fort ; un port veut une côte", () => {
  const full = { ...index.byId.get("nord#2").properties, used: 2 };
  assert.equal(provinceSiteError(full, "usine_civile", 2), "no-slot");
  assert.equal(provinceSiteError(full, "fort", 2), null);
  assert.equal(provinceSiteError(full, "port", 0), "not-coastal");
  assert.equal(provinceSiteError(index.byId.get("nord#1").properties, "port", 0), null);
  assert.equal(provinceSiteError(null, "usine_civile", 99), null, "sans provinces, pas de limite");
});

test("le chantier du joueur : refusé si plein, et porte sa province sinon", () => {
  const site = { name: "Lille", lng: 3, lat: 49 };
  const refused = queueNewBuilding(world(), {
    polity: "France", type: "usine_civile", site, id: "x", province: { id: "nord#2", slots: 2, coastal: false, used: 2 },
  });
  assert.equal(refused.error, "no-slot");
  const port = queueNewBuilding(world(), {
    polity: "France", type: "port", site, id: "x", province: { id: "nord#2", slots: 2, coastal: false, used: 0 },
  });
  assert.equal(port.error, "not-coastal");
  const { world: next, error } = queueNewBuilding(world(), {
    polity: "France", type: "usine_civile", site, id: "x", province: { id: "nord#2", slots: 2, coastal: false, used: 1 },
  });
  assert.equal(error, null);
  assert.equal(next.markers.find((marker) => marker.id === "x").provinceId, "nord#2");
});

test("agrandir une usine prend un emplacement ; ce qui dépasse déjà reste", () => {
  const over = { id: "u", name: "Usine", ownerCode: "France", lng: 3, lat: 49, status: "active", building: normalizeBuilding({ type: "usine_civile", level: 3 }) };
  const w = world([over]);
  const blocked = queueUpgrade(w, { polity: "France", markerId: "u", province: { id: "nord#2", slots: 2, used: 3 } });
  assert.equal(blocked.error, "no-slot");
  assert.equal(blocked.world.markers.length, 1, "le bâtiment en trop n'est pas retiré");
  assert.equal(queueUpgrade(w, { polity: "France", markerId: "u", province: { id: "nord#2", slots: 5, used: 3 } }).error, null);
  assert.equal(queueUpgrade(w, { polity: "France", markerId: "u" }).error, null, "sans province, comme avant");
});
