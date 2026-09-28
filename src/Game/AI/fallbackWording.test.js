import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { pendingOrderDescription, pendingOrderTitle, pendingOrdersSummary } from "./fallbackWording.js";
import { assertsChangeOfHands } from "./claimGuard.js";

const order = "Treaty of Moscow with Finland: after tense negotiations, Finland cedes the Karelian Isthmus, including the city of Vyborg, to the Soviet Union.";

test("a fallback turn quotes the player's order as an order and says it did NOT happen", () => {
  const text = pendingOrderDescription("Soviet Union", order);
  assert.match(text, /^The simulation could not be run for this period/);
  assert.match(text, /order "Treaty of Moscow with Finland: after tense negotiations, Finland cedes/);
  assert.match(text, /was NOT carried out: nothing it describes has happened/);
  assert.match(text, /stays queued for the next turn/);
  assert.equal(pendingOrderTitle("Soviet Union"), "Soviet Union: order not yet carried out");
  assert.doesNotMatch(pendingOrderTitle("Soviet Union"), /acts on|begins implementing/);
  assert.ok(!assertsChangeOfHands(pendingOrderTitle("Soviet Union")), "the title claims nothing");
});

test("a very long order is cut, and the summary says nothing was carried out", () => {
  const text = pendingOrderDescription("France", "x".repeat(400));
  assert.ok(text.includes(`"${"x".repeat(157)}…"`));
  assert.match(pendingOrdersSummary("France"), /orders were not carried out: nothing they describe has happened yet/);
});

test("a fallback turn keeps the orders queued instead of marking them done", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  const start = source.indexOf("const fallbackJumpSimulation = async");
  const end = source.indexOf("const normalizeGeneratedEvent", start);
  const body = source.slice(start, end);
  assert.match(body, /clearActions: false,/);
  assert.doesNotMatch(body, /clearActions: true/);
  assert.doesNotMatch(body, /acts on \$\{action\.title|begins implementing \$\{action\.title/);
  assert.match(body, /pendingOrderDescription\(bundle\.game\.country, action\.title\)/);
});
