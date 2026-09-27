// Run: node --test scripts/worldmap/worldmap.test.js
//
// Ce que ces tests tiennent, sur de petites trames dessinées à la main (la
// grille est celle du monde entier, mais seules quelques cases sont remplies) :
// - deux provinces voisines partagent exactement le même tracé, en sens
//   inverse ; une enclave fait un trou dans sa voisine ; les extérieurs sont
//   antihoraires (GeoJSON) ;
// - une petite île n'est jamais coupée, sauf par une frontière d'aujourd'hui ;
// - des îlots proches de même histoire se regroupent, pas ceux d'histoires
//   différentes ;
// - une lanière rejoint sa voisine, pas à travers un mur ;
// - les numéros sont refaits de 1 à n.

import test from "node:test";
import assert from "node:assert/strict";

import { N, W } from "./lib/grid.mjs";
import { assemble, smoothArc, toLngLat, traceArcs } from "./lib/vectorize.mjs";
import { groupArchipelagos, landComponents, mergeStrips, renumber, unifySmallIslands } from "./lib/refine.mjs";

const at = (i, j) => j * W + i;
const paint = (array, i0, j0, i1, j1, value) => {
  for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) array[at(i, j)] = value;
};
const signedArea = (ring) => {
  let s = 0;
  for (let k = 0; k < ring.length - 1; k += 1) s += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
  return s / 2;
};
const polygonsOf = (labels, id, options) => {
  const pieces = [];
  for (const arc of traceArcs(labels)) {
    const points = smoothArc(arc, options).map(toLngLat);
    if (arc.left === id) pieces.push({ points, closed: arc.closed });
    if (arc.right === id) pieces.push({ points: points.slice().reverse(), closed: arc.closed });
  }
  return assemble(pieces);
};

test("deux provinces voisines partagent le même tracé ; une enclave fait un trou", () => {
  const labels = new Int32Array(N);
  paint(labels, 100, 100, 130, 130, 1);
  paint(labels, 130, 100, 160, 130, 2);
  paint(labels, 110, 110, 118, 118, 3); // enclave dans 1
  const arcs = traceArcs(labels);
  const between = arcs.filter((arc) => [arc.left, arc.right].sort().join() === "1,2");
  assert.equal(between.length, 1, "une seule limite entre 1 et 2");
  const one = polygonsOf(labels, 1);
  const two = polygonsOf(labels, 2);
  const three = polygonsOf(labels, 3);
  assert.equal(one.broken + two.broken + three.broken, 0);
  assert.equal(one.polygons.length, 1);
  assert.equal(one.polygons[0].length, 2, "l'enclave est un trou de 1");
  assert.ok(signedArea(one.polygons[0][0]) > 0, "extérieur antihoraire");
  assert.ok(signedArea(one.polygons[0][1]) < 0, "trou horaire");
  assert.equal(three.polygons.length, 1);
  // Le tracé commun, lissé et rendu irrégulier, est identique des deux côtés.
  const shared = smoothArc(between[0]).map(toLngLat);
  const key = (p) => p.join(",");
  const onOne = new Set(one.polygons[0][0].map(key));
  const onTwo = new Set(two.polygons[0][0].map(key));
  assert.ok(shared.slice(1, -1).every((p) => onOne.has(key(p)) && onTwo.has(key(p))));
});

test("une petite île n'est jamais coupée, sauf par une frontière d'aujourd'hui", () => {
  const land = new Uint8Array(N); const labels = new Int32Array(N); const today = new Int32Array(N);
  paint(land, 200, 200, 210, 206, 1); paint(labels, 200, 200, 206, 206, 5); paint(labels, 206, 200, 210, 206, 6); paint(today, 200, 200, 210, 206, 1);
  paint(land, 300, 200, 310, 206, 1); paint(labels, 300, 200, 305, 206, 7); paint(labels, 305, 200, 310, 206, 8);
  paint(today, 300, 200, 305, 206, 1); paint(today, 305, 200, 310, 206, 2);
  const islands = landComponents(land);
  unifySmallIslands({ land, labels, today, islands });
  assert.equal(new Set([...Array(10).keys()].map((k) => labels[at(200 + k, 203)])).size, 1, "l'île entière dans une province");
  assert.equal(labels[at(300, 203)], 7);
  assert.equal(labels[at(309, 203)], 8, "coupée par une frontière d'aujourd'hui : on garde");
});

test("des îlots proches de même histoire se regroupent, pas les autres", () => {
  const land = new Uint8Array(N); const labels = new Int32Array(N); const combo = new Int32Array(N);
  // Trois îlots d'une case à 0,2° les uns des autres, vers 30° N.
  for (const [i, l, c] of [[3000, 1, 1], [3004, 2, 1], [3008, 3, 2]]) {
    land[at(i, 1000)] = 1; labels[at(i, 1000)] = l; combo[at(i, 1000)] = c;
  }
  const islands = landComponents(land);
  groupArchipelagos({ land, labels, combo, islands });
  assert.equal(labels[at(3000, 1000)], labels[at(3004, 1000)], "même histoire : regroupés");
  assert.notEqual(labels[at(3008, 1000)], labels[at(3004, 1000)], "autre histoire : à part");
});

test("une lanière rejoint sa voisine, jamais à travers un mur", () => {
  const land = new Uint8Array(N); const labels = new Int32Array(N);
  paint(land, 400, 400, 460, 460, 1);
  paint(labels, 400, 400, 430, 460, 1);
  paint(labels, 430, 400, 432, 460, 2); // lanière de deux cases de large
  paint(labels, 432, 400, 460, 460, 3);
  const islands = landComponents(land);
  // Un mur entre la lanière et la province 1.
  const crossable = (a, b) => !([a, b].some((c) => labels[c] === 1) && [a, b].some((c) => labels[c] === 2));
  mergeStrips({ land, labels, crossable, islands });
  assert.equal(labels[at(430, 430)], 3, "fondue dans la voisine franchissable");
  assert.equal(labels[at(410, 430)], 1);
});

test("les numéros sont refaits de 1 à n", () => {
  const land = new Uint8Array(N); const labels = new Int32Array(N);
  paint(land, 500, 500, 520, 510, 1);
  paint(labels, 500, 500, 510, 510, 42); paint(labels, 510, 500, 520, 510, 7);
  assert.equal(renumber({ land, labels }), 2);
  assert.deepEqual([...new Set([labels[at(505, 505)], labels[at(515, 505)]])].sort(), [1, 2]);
});
