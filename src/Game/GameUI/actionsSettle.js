// The Actions panel's own reading of the orders, once no turn is running.
//
// Test F (15–22 and 22–29 January 1936): straight after a turn the panel still
// listed the turn's orders as "ACTION • PLANIFIÉ", and only a reload cleared
// them. The new round is published while the turn is still writing, so whatever
// the panel heard at that moment could be the list from before. This waits until
// the turn is over (the simulation's busy flag), then reads the save itself, and
// once more a moment later for a write that lands just after the flag drops.
//
// Import-free, so the tests run without React or a server.

export const actionsSignatureOf = (list) => (Array.isArray(list) ? list : [])
  .map((action) => `${action?.id}:${action?.title}:${action?.text}:${action?.status}`)
  .join("|");

export const SETTLE_POLL_MS = 500;
export const SETTLE_RECHECK_MS = 1500;
export const SETTLE_GIVE_UP_MS = 10 * 60 * 1000;

// { isBusy, read, apply } → { cancel }. `read` returns a promise of the list;
// `apply` receives it. Timers are injectable for the tests.
export const settleActionsAfterTurn = ({
  isBusy = () => false,
  read,
  apply,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
} = {}) => {
  let cancelled = false;
  let timer = null;
  const started = now();
  const readOnce = async () => {
    try {
      const list = await read();
      if (!cancelled && Array.isArray(list)) apply(list);
    } catch {
      // Offline or between games: the store's own copy stays.
    }
  };
  const wait = () => {
    if (cancelled) return;
    if (isBusy() && now() - started < SETTLE_GIVE_UP_MS) {
      timer = setTimer(wait, SETTLE_POLL_MS);
      return;
    }
    void readOnce().then(() => {
      if (!cancelled) timer = setTimer(() => { void readOnce(); }, SETTLE_RECHECK_MS);
    });
  };
  wait();
  return {
    cancel: () => {
      cancelled = true;
      if (timer !== null) clearTimer(timer);
    },
  };
};
