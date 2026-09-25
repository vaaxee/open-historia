// Run: node --test server/hoiProvinceGen.test.js
//
// Ce que ces tests tiennent : une région est couverte exactement par ses
// provinces (ni trou ni chevauchement), leurs tailles sont comparables, le
// découpage est déterministe, plus fin avec des villes, les villes donnent leur
// nom, les régions d'eau n'ont pas de provinces et rendent côtières celles qui les
// touchent, et les voisinages traversent les frontières de régions.

import test from "node:test";
import assert from "node:assert/strict";
import turfArea from "@turf/area";

import { PROVINCE_TUNING, generateProvinces, provinceCountFor, splitRegion } from "./hoiProvinceGen.js";

// Un carré aux bords découpés en 10 : les vraies cartes ont des centaines de
// sommets par frontière, et la côte se reconnaît aux sommets partagés.
const square = (x0, y0, size) => {
  const corners = [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]];
  const ring = [];
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = corners[i]; const [bx, by] = corners[i + 1];
    for (let k = 0; k < 10; k += 1) ring.push([ax + ((bx - ax) * k) / 10, ay + ((by - ay) * k) / 10]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
};
const area = (geometry) => turfArea({ type: "Feature", geometry, properties: {} }) / 1e6;
const feature = (id, geometry, props = {}) => ({ type: "Feature", properties: { id, name: id, ...props }, geometry });

test("le nombre de provinces suit la surface, plus fin avec des villes, borné", () => {
  assert.equal(provinceCountFor(50000, 1000000), Math.round((50000 * (1 + 0.6 * Math.log10(6))) / 10000));
  assert.equal(provinceCountFor(100000, 0), 5, "sans ville : deux fois plus grossier");
  assert.equal(provinceCountFor(500, 0), 1);
  assert.equal(provinceCountFor(1e7, 1e7), PROVINCE_TUNING.maxPerRegion);
});

test("une région est couverte exactement par des provinces de tailles comparables", () => {
  const region = square(10, 45, 3); // ≈ 70 000 km²
  const parts = splitRegion(region, [{ name: "Ville", coordinates: [11, 46], population: 500000 }]);
  assert.ok(parts.length >= 5, `${parts.length} provinces`);
  const total = parts.reduce((sum, part) => sum + area(part.geometry), 0);
  assert.ok(Math.abs(total - area(region)) / area(region) < 0.001, "ni trou ni chevauchement");
  const sizes = parts.map((part) => area(part.geometry));
  assert.ok(Math.max(...sizes) / Math.min(...sizes) < 3, "tailles comparables");
  assert.equal(parts[0].cityName, "Ville", "la ville est une graine et donne son nom");
});

test("le découpage est déterministe", () => {
  const region = square(0, 0, 2);
  assert.deepEqual(splitRegion(region), splitRegion(region));
});

test("carte entière : l'eau n'a pas de provinces, les côtes et les voisinages sont reconnus", () => {
  const regions = {
    type: "FeatureCollection",
    features: [
      feature("A", square(0, 0, 1)),
      feature("B", square(1, 0, 1)),
      feature("MER", square(2, 0, 1), { typeId: "type_mer" }),
    ],
  };
  const { provinces, adjacency } = generateProvinces(regions);
  const byRegion = (id) => provinces.features.filter((entry) => entry.properties.regionId === id);
  assert.equal(byRegion("MER").length, 0);
  const a = byRegion("A")[0];
  const b = byRegion("B");
  assert.ok(adjacency[a.properties.id].some((id) => id.startsWith("B#")), "voisines par-delà la frontière des régions");
  assert.ok(b.some((entry) => entry.properties.coastal), "B touche la mer");
  assert.equal(a.properties.coastal, false);
  assert.match(a.properties.id, /^A#1$/);
});

test("un nom de région en code couleur est remplacé par une ville, et les noms restent uniques", () => {
  const regions = {
    type: "FeatureCollection",
    features: [
      feature("R1", square(0, 0, 1), { name: "Province #114499", owner: "France" }),
      feature("R2", square(1, 0, 1), { name: "Province #2233EE", owner: "France" }),
      feature("R3", square(5, 0, 1), { name: "Bourgogne" }),
    ],
  };
  const cities = [{ name: "Dijon", coordinates: [0.5, 0.5], population: 100000 }];
  const { provinces } = generateProvinces(regions, { cities });
  const names = provinces.features.map((entry) => entry.properties.name);
  assert.ok(names.includes("Dijon"), "la province de la ville porte son nom");
  assert.ok(names.every((name) => !name.includes("#")), names.join(", "));
  assert.ok(names.includes("Bourgogne"), "un vrai nom de région est gardé");
  assert.ok(names.some((name) => /^Dijon – \d$/.test(name)), "la région sans ville prend la ville la plus proche, numérotée");
  assert.equal(new Set(names).size, names.length, "noms uniques");
  assert.equal(provinces.features.find((entry) => entry.properties.regionId === "R1").properties.owner, "France");
  assert.ok(provinces.features.every((entry) => entry.properties.regionId !== "R1" || Array.isArray(entry.properties.anchor)), "la province-ville a son point");
});
