import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { SETTLE_POLL_MS, SETTLE_RECHECK_MS, actionsSignatureOf, settleActionsAfterTurn } from "./actionsSettle.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));

// A hand-cranked clock: timers run when the test says so.
const clock = () => {
  let time = 0;
  const timers = [];
  return {
    now: () => time,
    setTimer: (fn, ms) => { timers.push({ at: time + ms, fn }); return timers.length - 1; },
    clearTimer: (id) => { if (timers[id]) timers[id].fn = null; },
    advance: async (ms) => {
      time += ms;
      for (const timer of timers) {
        if (timer.fn && timer.at <= time) { const fn = timer.fn; timer.fn = null; fn(); }
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
};

// Test F, 22–29 January 1936: the panel kept "ACTION • PLANIFIÉ" after the turn.
test("after a turn the panel reads the orders from the save once the turn is over, and once more a moment later", async () => {
  const time = clock();
  let busy = true;
  let saved = [{ id: "a1", title: "Déclarer la guerre à la Lituanie.", text: "", status: "planned" }];
  const shown = [];
  settleActionsAfterTurn({
    isBusy: () => busy,
    read: async () => saved,
    apply: (list) => shown.push(list.map((entry) => entry.status).join(",")),
    ...time,
  });
  await time.advance(SETTLE_POLL_MS);
  assert.deepEqual(shown, [], "nothing is read while the turn runs");
  saved = [{ ...saved[0], status: "resolved" }];
  busy = false;
  await time.advance(SETTLE_POLL_MS);
  assert.deepEqual(shown, ["resolved"]);
  await time.advance(SETTLE_RECHECK_MS);
  assert.deepEqual(shown, ["resolved", "resolved"], "and again, for a write that lands just after");
});

test("a closed panel or a new game stops the reading; a failed read changes nothing", async () => {
  const time = clock();
  const shown = [];
  const settle = settleActionsAfterTurn({ isBusy: () => true, read: async () => [], apply: () => shown.push("x"), ...time });
  settle.cancel();
  await time.advance(SETTLE_POLL_MS * 4);
  assert.deepEqual(shown, []);
  settleActionsAfterTurn({ read: async () => { throw new Error("offline"); }, apply: () => shown.push("x"), ...time });
  await time.advance(SETTLE_RECHECK_MS);
  assert.deepEqual(shown, []);
  assert.equal(actionsSignatureOf([{ id: "a", title: "t", text: "x", status: "resolved" }]), "a:t:x:resolved");
});

test("the Actions panel reads the save on every opening and after every new round, open or not", () => {
  const source = fs.readFileSync(path.join(here, "actions.jsx"), "utf8");
  assert.equal((source.match(/settleActionsAfterTurn\(\{/g) ?? []).length, 2);
  assert.match(source, /read: \(\) => readActionsState\(\{ force: true \}\),/);
  assert.match(source, /\}, \[game\.round\]\);/, "the round watch no longer waits for the panel to be open");
});
