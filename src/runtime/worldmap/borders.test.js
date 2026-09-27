// Run: node --test src/runtime/worldmap/borders.test.js
//
// Ce que ces tests tiennent : une limite est frontière de pays quand ses deux
// provinces n'ont pas le même propriétaire, d'état quand seul l'état change ;
// changer une province de mains ne touche que ses propres limites ; la couleur
// d'un pays vient de son numéro de carte.

import test from "node:test";
import assert from "node:assert/strict";

import { BORDER_KIND, TODAY_PALETTE, arcKind, arcsTouching, todayColour } from "./borders.js";

const owner = { 1: "FRA", 2: "FRA", 3: "DEU" };
const state = { 1: "Alsace", 2: "Lorraine", 3: "Bade" };

test("le genre d'une limite se déduit des propriétaires", () => {
  assert.equal(arcKind(1, 3, (id) => owner[id], (id) => state[id]), BORDER_KIND.country);
  assert.equal(arcKind(1, 2, (id) => owner[id], (id) => state[id]), BORDER_KIND.state);
  assert.equal(arcKind(1, 2, (id) => owner[id]), BORDER_KIND.province);
  owner[3] = "FRA";
  assert.equal(arcKind(1, 3, (id) => owner[id], () => "Alsace"), BORDER_KIND.province, "annexion : la frontière disparaît");
});

test("une province qui change de mains ne touche que ses limites", () => {
  const arcs = [[1, 1, 2, 0], [2, 2, 3, 0], [3, 3, 4, 1]];
  assert.deepEqual(arcsTouching(arcs, [3]).map(([id]) => id), [2, 3]);
});

test("couleurs : numéro de carte, sinon neutre", () => {
  assert.equal(todayColour({ color: 3 }), TODAY_PALETTE[3]);
  assert.equal(todayColour(undefined), TODAY_PALETTE[0]);
});
