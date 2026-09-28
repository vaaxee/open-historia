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

import { assertsCapitulation, assertsChangeOfHands, detectLanguage } from "./claimGuard.js";
import { countriesNamed } from "../../runtime/translationCheck.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// A map region's code ("imp-rgb-0066DD", "RUS-2321", "danzig~free-city-of-danzig")
// is never a name the story may use.
export const looksLikeRegionCode = (value) => /^(imp-rgb-|adm1-)|~|^[A-Z]{3}[-.]\d/.test(clean(value));

// What the engine will apply for one event, in plain lines. `nameOf(id)` gives a
// region's name when the operation carries only its id: the narrator is never
// shown a region code, which it would copy into the story.
export const describeAppliedImpacts = (impacts, { nameOf = () => "" } = {}) => {
  const place = (entry) => {
    const named = clean(entry?.regionName);
    if (named && !looksLikeRegionCode(named)) return named;
    const looked = clean(nameOf(clean(entry?.regionId)));
    if (looked && !looksLikeRegionCode(looked)) return looked;
    const raw = clean(entry?.regionId);
    return raw && !looksLikeRegionCode(raw) ? raw : "a region";
  };
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
    // Who holds the claimed region (set by the engine): a claim on Vilnius is a
    // claim against Poland, whatever the story first said.
    const holder = clean(claim?.holder);
    lines.push(claim?.drop
      ? `${clean(claim.claimantCode)} renounces its claim on ${place(claim)}`
      : `${clean(claim.claimantCode)} claims ${place(claim)}${holder ? `, which belongs to ${holder}` : ""} (a claim only: no border moves)`);
  }
  for (const change of list(impacts?.polityChanges)) {
    const operation = clean(change?.operation) || "update";
    lines.push(`polity ${clean(change?.code)}: ${operation}${clean(change?.name) ? ` (${clean(change.name)})` : ""}`);
  }
  // Units are not listed: they move no border, and a line such as "unit
  // operations" was copied word for word into the story.
  for (const chat of list(impacts?.createdChats)) lines.push(`a diplomatic chat opens: "${clean(chat?.title)}"`);
  return lines;
};

// Region codes written into a story ("la région identifiée par le code
// imp-rgb-0066DD") become the region's name; a code with no known name becomes
// a plain "the region". Returns how many were replaced.
// The code, and the words that introduce it ("identifiée par le code", "identified
// by the code"), go together.
const REGION_CODE = /(?:(?:identifi[ée]+e?s?|désign[ée]+e?s?) par le code |(?:identified|designated) by (?:the )?code |(?:le |the )?code )?\b(imp-rgb-[0-9A-Fa-f]{6}(?:~[a-z0-9-]+(?:-\d+)?)?|[a-z]+~[a-z0-9-]+|adm1-\d+|[A-Z]{3}-\d{3,5})\b/g;
const UNNAMED = { fr: "cette région", de: "diese Region", es: "esa región", it: "quella regione", en: "the region" };
export const scrubRegionCodes = (event, { nameOf = () => "" } = {}) => {
  let replaced = 0;
  const language = detectLanguage(`${event?.title ?? ""} ${event?.description ?? ""}`);
  for (const field of ["title", "description"]) {
    if (typeof event?.[field] !== "string") continue;
    event[field] = event[field].replace(REGION_CODE, (_match, code) => {
      replaced += 1;
      return clean(nameOf(code)) || UNNAMED[language] || UNNAMED.en;
    }).replace(/\s+/g, " ").trim();
  }
  return replaced;
};

// The narrator's input: every event, its applied changes, and whether the engine
// already rewrote it as a failed attempt (claimGuard.js).
export const buildNarrationItems = (events, { nameOf } = {}) => list(events).map((event, index) => ({
  index,
  date: clean(event?.date),
  title: clean(event?.title),
  description: clean(event?.description),
  appliedChanges: describeAppliedImpacts(event?.impacts, { nameOf }),
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
const same = (a, b) => {
  const fold = (value) => clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const x = fold(a); const y = fold(b);
  return Boolean(x) && Boolean(y) && (x === y || (x.length >= 30 && y.length >= 30 && x.slice(0, 30) === y.slice(0, 30)));
};

// Is a rewrite the story of something else? (Game F's spy events came out with
// title and text crossed and another event's words — a translation fault, as it
// turned out, but the narrator is held to the same rule.)
export const belongsElsewhere = ({ event, title, description, events = [] }) => {
  if (same(title, event.description) || same(description, event.title)) return true;
  const others = list(events).filter((other) => other && other !== event);
  if (others.some((other) => (same(title, other.title) && !same(title, event.title))
    || (same(description, other.description) && !same(description, event.description)))) return true;
  const was = countriesNamed(`${event.title ?? ""}. ${event.description ?? ""}`);
  const now = countriesNamed(`${title}. ${description}`);
  return was.size > 0 && now.size > 0 && ![...was].some((name) => now.has(name));
};

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
    // Each rewrite stays with its own event: none that swaps title and text, takes
    // another event's words, or leaves every country the event was about.
    if (belongsElsewhere({ event, title, description, events })) continue;
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
5. Return exactly one entry per supplied index.
6. The appliedChanges and refused lines are notes for you, not text for the reader: never copy or translate them word for word, and never write a region code (such as "imp-rgb-0066DD") — name places as a historian would. When a claim names who the region belongs to, it is that polity that reacts.`;
