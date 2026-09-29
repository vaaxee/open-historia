// Open Historia, the bits of the AI stack the HUD needs SYNCHRONOUSLY.
//
// Everything else lives behind gameplayLazy.js. These cannot: a promise is no
// use to a render path or an 800ms poll, so importing them from gameplay.js is
// what kept 600 KB of simulation in the entry chunk. Nothing here may import
// anything that pulls it back in. debugLog.js is a leaf and is already loaded.
//
// This file OWNS the turn state rather than mirroring it, so a new write site
// that forgets to update it is a ReferenceError rather than silent drift.
import { logDebugEvent } from "../../runtime/debugLog.js";

// A counter, not a boolean: independent generators overlap.
let activeSimulations = 0;
// What is running, by name (test G with Jev: the Fronts panel said "a time skip
// is running" after the turn had landed, and only a reload cleared it; the panel
// now says which task it waits for).
const runningTasks = new Map();

// A jump held on a failed segment, and a turn held at the Projects board.
let pendingJumpSegment = null;
let pendingProjectsJump = null;

// The idle chat poll is mid-generation ("someone might be typing").
let chatGenerationInFlight = false;

// The calling function's name, read off the stack ("createInteractive",
// "consolidateHistoryNow"…), or "task" when the stack says nothing usable.
const callerName = () => {
  const lines = String(new Error().stack ?? "").split("\n").map((line) => line.trim());
  const frame = lines.find((line, index) => index > 0 && !/callerName|beginSimulation|endSimulation/.test(line) && /^at /.test(line));
  return frame?.match(/^at (?:async )?([\w$.]+)/)?.[1]?.split(".").pop() || "task";
};

export const beginSimulation = (label = callerName()) => {
  activeSimulations += 1;
  runningTasks.set(label, (runningTasks.get(label) ?? 0) + 1);
};

export const endSimulation = (label = callerName()) => {
  activeSimulations = Math.max(0, activeSimulations - 1);
  const left = (runningTasks.get(label) ?? 0) - 1;
  if (left > 0) runningTasks.set(label, left);
  else runningTasks.delete(label);
};

// The names of what keeps the game busy: running tasks, a held turn or segment.
export const busyReasons = () => [
  ...runningTasks.keys(),
  ...(pendingProjectsJump !== null ? ["held-turn"] : []),
  ...(pendingJumpSegment !== null ? ["held-segment"] : []),
];

export const getPendingJumpSegment = () => pendingJumpSegment;
export const setPendingJumpSegment = (value) => {
  pendingJumpSegment = value ?? null;
};

export const getPendingProjectsJump = () => pendingProjectsJump;
export const setPendingProjectsJump = (value) => {
  pendingProjectsJump = value ?? null;
};

export const setChatGenerationInFlight = (inFlight) => {
  chatGenerationInFlight = inFlight === true;
};

export const hasPendingJumpSegment = () => pendingJumpSegment !== null;
export const hasPendingProjectsJump = () => pendingProjectsJump !== null;

// A held jump counts as busy: the idle pulse checks this before it writes, so it
// cannot write into a world that is about to be replaced by the held turn.
export const isSimulationBusy = () => activeSimulations > 0
  || pendingProjectsJump !== null
  || pendingJumpSegment !== null;

export const isChatGenerationLikely = () => chatGenerationInFlight;

// Both discards stay synchronous: time.jsx fires them next to a setState, and an
// async one would leave isSimulationBusy() true for a tick afterwards. Nothing
// was written either way, so there is nothing to undo.
export const discardPendingJumpSegment = () => {
  const had = pendingJumpSegment !== null;
  pendingJumpSegment = null;
  if (had) logDebugEvent("turn", "Held jump discarded; nothing was written and its finished segments are gone.");
  return had;
};

export const discardPendingProjectsJump = () => {
  const had = pendingProjectsJump !== null;
  pendingProjectsJump = null;
  if (had) logDebugEvent("turn", "Held turn discarded; the board was never updated and nothing was written.");
  return had;
};

// Compared by identity in a render path (time.jsx).
export const NO_RESPONSE_BODY_NOTE = "(no response body — the request failed before the model answered, so there was nothing to parse. See the failure reason above: a transport or HTTP error like this usually means the provider URL, API key or model name is wrong, not that the model misbehaved.)";
