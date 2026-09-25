// Run: node --test server/hoiTerrain.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { classifyTerrain, provinceSlots } from "./hoiTerrain.js";

test("avec l'altitude : montagnes et collines viennent du relief", () => {
  assert.equal(classifyTerrain({ lng: 7, lat: 46, elevation: { mean: 2200, relief: 600, max: 4000 } }), "montagne");
  assert.equal(classifyTerrain({ lng: 3, lat: 45, elevation: { mean: 700, relief: 150, max: 1500 } }), "colline");
  assert.equal(classifyTerrain({ lng: 2, lat: 49, elevation: { mean: 120, relief: 30, max: 200 } }), "plaine");
  assert.equal(classifyTerrain({ lng: 4.5, lat: 52, elevation: { mean: 2, relief: 3, max: 10 }, coastal: true }), "marais");
});

test("sans altitude : les grandes chaînes, les déserts, la jungle, la taïga", () => {
  assert.equal(classifyTerrain({ lng: 8, lat: 46.5 }), "montagne", "Alpes");
  assert.equal(classifyTerrain({ lng: 10, lat: 25 }), "desert", "Sahara");
  assert.equal(classifyTerrain({ lng: 20, lat: 0 }), "jungle");
  assert.equal(classifyTerrain({ lng: 40, lat: 58 }), "foret");
  assert.equal(classifyTerrain({ lng: 2, lat: 48 }), "plaine");
});

test("urbain : une grande ville dense l'emporte", () => {
  assert.equal(classifyTerrain({ lng: 2.35, lat: 48.86, population: 5000000, areaKm2: 5000 }), "urbain");
  assert.equal(classifyTerrain({ lng: 2.35, lat: 48.86, population: 1600000, areaKm2: 40000 }), "plaine", "trop diluée");
});

test("les emplacements suivent le terrain, +1 pour une ville", () => {
  assert.equal(provinceSlots("urbain"), 5);
  assert.equal(provinceSlots("plaine", 300000), 4);
  assert.equal(provinceSlots("montagne"), 1);
  assert.equal(provinceSlots("inconnu"), 3);
});
