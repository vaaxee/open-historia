// Run: node --test src/Game/Map/buildingFan.test.js
//
// Ce que ces tests tiennent : un bâtiment seul reste sur son point, deux bâtiments
// proches (le Fort de Paris à 3 km du complexe) s'écartent l'un de l'autre, un
// groupe se forme de proche en proche, et le résultat ne dépend pas de l'ordre.

import test from "node:test";
import assert from "node:assert/strict";

import { FAN_RADIUS, fanOutOffsets } from "./buildingFan.js";

const fort = { id: "fort", lng: 2.43, lat: 48.86 };
const complex = { id: "complexe", lng: 2.47, lat: 48.86 };
const lyon = { id: "lyon", lng: 4.96, lat: 45.76 };

test("un bâtiment seul reste sur son point", () => {
  assert.deepEqual(fanOutOffsets([lyon]).get("lyon"), [0, 0]);
});

test("le fort et le complexe de Paris s'écartent, Lyon ne bouge pas", () => {
  const offsets = fanOutOffsets([fort, complex, lyon]);
  const a = offsets.get("complexe");
  const b = offsets.get("fort");
  assert.deepEqual(offsets.get("lyon"), [0, 0]);
  assert.notDeepEqual(a, b);
  assert.equal(Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])), FAN_RADIUS * 2, "deux points opposés de l'éventail");
});

test("un groupe se forme de proche en proche, sur des distances courtes", () => {
  const chain = [
    { id: "a", lng: 2.35, lat: 48.86 },
    { id: "b", lng: 2.6, lat: 48.86 },
    { id: "c", lng: 2.85, lat: 48.86 },
  ];
  const offsets = fanOutOffsets(chain);
  assert.equal(new Set([...offsets.values()].map((value) => value.join())).size, 3, "trois positions distinctes");
  assert.deepEqual(fanOutOffsets([{ id: "a", lng: 2.35, lat: 48.86 }, { id: "z", lng: 3.5, lat: 48.86 }]).get("z"), [0, 0], "à 85 km, pas de groupe");
});

test("le résultat ne dépend pas de l'ordre, et les points sans coordonnées sont ignorés", () => {
  const one = fanOutOffsets([fort, complex, lyon]);
  const two = fanOutOffsets([lyon, complex, fort, { id: "x", lng: NaN, lat: 1 }]);
  for (const id of ["fort", "complexe", "lyon"]) assert.deepEqual(one.get(id), two.get(id));
  assert.equal(two.has("x"), false);
});
