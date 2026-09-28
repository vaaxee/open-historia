// The story written after the engine: two-step narration.
//
// A time skip's answer carries its events' text and their impacts together, and
// the engine then refuses what it cannot enact (an unknown polity, a loser who
// does not hold the land, a region that does not exist). The text used to stay:
// "Fall of Vilnius and unconditional surrender" over a transfer that never
// happened. claimGuard.js catches the plain cases with no request; this does it
// properly with one: once the answer is validated, the model is shown every
// event with the changes the engine ACTUALLY applied and what it refused, and
// rewrites only the titles and descriptions to match. Nothing else moves — not
// a date, not an impact, not an event.
//
// Setting: Settings → AI → "Write the story after validation" (on by default,
// runtime/mapSettings.js narrateAfterValidation). Off, or when the request
// budget has no room, the guard alone holds.

import { assertsCapitulation, assertsChangeOfHands } from "./claimGuard.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const place = (entry) => clean(entry?.regionName) || clean(entry?.regionId) || "a region";

// What the engine will apply for one event, in plain lines.
export const describeAppliedImpacts = (impacts) => {
  const lines = [];
  for (const transfer of list(impacts?.regionTransfers)) {
    lines.push(`${place(transfer)} passes legally from ${clean(transfer.fromCode) || "its previous owner"} to ${clean(transfer.toCode)}`);
  }
  for (const op of list(impacts?.regionControlOps)) {
    const kind = clean(op?.op).toLowerCase();
    if (kind === "control") lines.push(`${place(op)} is now controlled by ${clean(op.toCode)} (occupation; legal owner unchanged)`);
    else if (kind === "contest") lines.push(`${place(op)} is contested by ${clean(op.actorCode)}`);
    else if (kind === "clear_contest") lines.push(`the contest over ${place(op)} ends`);
  }
  for (const claim of list(impacts?.regionClaims)) {
    lines.push(claim?.drop
      ? `${clean(claim.claimantCode)} renounces its claim on ${place(claim)}`
      : `${clean(claim.claimantCode)} claims ${place(claim)} (a claim only: no border moves)`);
  }
  for (const change of list(impacts?.polityChanges)) {
    const operation = clean(change?.operation) || "update";
    lines.push(`polity ${clean(change?.code)}: ${operation}${clean(change?.name) ? ` (${clean(change.name)})` : ""}`);
  }
  const units = list(impacts?.unitOps).length;
  if (units) lines.push(`${units} military unit operation${units === 1 ? "" : "s"} (moves, new units, losses)`);
  for (const chat of list(impacts?.createdChats)) lines.push(`a diplomatic chat opens: "${clean(chat?.title)}"`);
  return lines;
};

// The narrator's input: every event, its applied changes, and whether the engine
// already rewrote it as a failed attempt (claimGuard.js).
export const buildNarrationItems = (events) => list(events).map((event, index) => ({
  index,
  date: clean(event?.date),
  title: clean(event?.title),
  description: clean(event?.description),
  appliedChanges: describeAppliedImpacts(event?.impacts),
  ...(event?.rewrittenFrom ? { refusedByEngine: true } : {}),
}));

// An answer is usable only whole: one entry per event, each with a title and a
// description. Returns a complaint, or "" when it is fine.
export const validateNarration = (payload, count) => {
  const rows = list(payload?.events);
  if (rows.length !== count) return `Return exactly ${count} events, one per supplied index (got ${rows.length}).`;
  const seen = new Set();
  for (const row of rows) {
    const index = Number(row?.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) return `Event index ${row?.index} is not one of the supplied indexes.`;
    if (seen.has(index)) return `Event index ${index} appears twice.`;
    seen.add(index);
    if (!clean(row?.title) || !clean(row?.description)) return `Event ${index} needs a title and a description.`;
  }
  return "";
};

// Writes the new titles and descriptions onto the events; nothing else changes.
// A rewrite that would make an event announce a change of hands (or a surrender)
// its applied changes do not carry, when its text did not before, is refused:
// the narrator may not bring back what the engine took out.
// Returns how many events changed.
export const applyNarration = (events, payload) => {
  const rows = list(payload?.events);
  let changed = 0;
  for (const row of rows) {
    const event = list(events)[Number(row?.index)];
    if (!event) continue;
    const title = clean(row.title);
    const description = clean(row.description);
    if (title === clean(event.title) && description === clean(event.description)) continue;
    const territorial = list(event.impacts?.regionTransfers).length + list(event.impacts?.regionControlOps).length;
    const before = `${event.title ?? ""}. ${event.description ?? ""}`;
    const after = `${title}. ${description}`;
    if (!territorial && ((assertsChangeOfHands(after) && !assertsChangeOfHands(before))
      || (assertsCapitulation(after) && !assertsCapitulation(before)))) continue;
    event.narratedFrom = event.narratedFrom ?? { title: event.title ?? "", description: event.description ?? "" };
    event.title = title;
    event.description = description;
    changed += 1;
  }
  return changed;
};

export const NARRATION_SCHEMA = Object.freeze({
  type: "object",
  description: "The same events, with titles and descriptions rewritten to match exactly what the engine applied.",
  properties: {
    events: {
      type: "array",
      description: "One entry per supplied event index.",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 0, description: "The supplied event index." },
          title: { type: "string", description: "The event's title, in the event's own language." },
          description: { type: "string", description: "The event's description, in the event's own language." },
        },
        required: ["index", "title", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["events"],
  additionalProperties: false,
});

export const NARRATION_PROMPT = `You are the NARRATOR of an alternate-history strategy game. The simulation has already decided what happened in this period, and the engine has already validated it: some proposed changes were applied, others were REFUSED. You write the words, nothing else.

EVENTS (index, date, current title and description, and the changes the engine actually applied for each):
\${narrationItems}

REFUSED BY THE ENGINE (these did NOT happen):
\${narrationRefusals}

RULES
1. Rewrite every event's title and description so that they state as done ONLY what its appliedChanges list says. A territory, city or country may be said to change hands, fall, be annexed, ceded, occupied or surrender ONLY if its appliedChanges list says so.
2. Anything in the refused list, and anything the text announces that no appliedChanges line supports, must be told as an attempt that failed, a threat, a demand or a claim — never as accomplished. An event marked refusedByEngine is already a failed attempt: keep it one.
3. Keep each event's date, actors, place and tone; keep the facts that are consistent. Change as little as the rules require: an already consistent event may be returned unchanged.
4. Write each event in the language it is already written in. Do not add or remove events, and do not invent new changes.
5. Return exactly one entry per supplied index.`;
