/*! Open Historia — timeline event de-duplication © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Why this exists: every jump the model is shown the running timeline as context
// (recentEvents / campaignHistory in promptContext.js) and, unless told otherwise,
// RESTATES events it already reported. Each restatement comes back as a NEW event
// object with a freshly-minted random id (generateId in gameState.js uses
// Date.now()+random), so an id-based de-dup can never match it — and the timeline
// ends up showing the "same" event over and over. De-dup on the event's CONTENT.
//
// Pure and dependency-free on purpose: the concat that creates the duplicates lives
// in shared client code ABOVE both the server and the in-browser stores, and this
// helper is unit-tested directly (eventDedup.test.js) without pulling in the
// browser-only asset layer that gameState.js imports.

const norm = (value) => String(value ?? "").trim();

// A stable content key. Only an EXACT restatement (same date AND title AND
// description) collides, so genuinely distinct events that merely share a date or a
// title are always kept — this can never drop real history, only literal repeats.
export const eventContentKey = (event) =>
  `${norm(event?.date)}\u0000${norm(event?.title).toLowerCase()}\u0000${norm(event?.description).toLowerCase()}`;

// Explicitly-authored transactions (notably the GM Console) need a stronger
// identity than visible prose. A correction can intentionally reuse the same
// date/title/description while changing canonical effects; treating that as a
// duplicate would reject the correction and the events write choke-point would
// otherwise silently remove it. Object key order is normalized so equivalent
// structured effects still compare equal. This key is NOT used by ordinary AI
// anti-repetition de-duplication, which deliberately remains prose-based.
const stableSerialize = (value) => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const eventCanonicalKey = (event) => {
  const combatants = Array.isArray(event?.combatants)
    ? [...event.combatants].map((value) => norm(value).toLowerCase()).filter(Boolean).sort()
    : [];
  return `${eventContentKey(event)}\u0000${stableSerialize({
    impacts: event?.impacts && typeof event.impacts === "object" ? event.impacts : null,
    warId: norm(event?.warId).toLowerCase(),
    combatants,
  })}`;
};


// Keep only the generated events that are NOT a restatement of an event already in
// `baseEvents` (the pre-turn log) or of an earlier event in the same batch.
export const dedupeGeneratedEvents = (baseEvents, generatedEvents, { keyOf = eventContentKey } = {}) => {
  const seen = new Set((Array.isArray(baseEvents) ? baseEvents : []).map((event) => keyOf(event)));
  const fresh = [];
  for (const event of Array.isArray(generatedEvents) ? generatedEvents : []) {
    const key = keyOf(event);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(event);
  }
  return fresh;
};

// Phase 10 — near-repeats. The model also restates an event in other words from
// one turn to the next (« La France appelle à la modération » three turns in a
// row). An event is a near-repeat when its title shares most of its words with a
// recent one (Jaccard ≥ 0.6), or its title some and its description most (≥ 0.4
// and ≥ 0.5). A near-repeat of a RECENT event (within `windowDays`) that changes
// nothing (no impacts) is dropped; two near-twins in the same batch are merged
// (the second's impacts join the first's). Engine events are never touched.
const STOP_WORDS = new Set(["dans", "avec", "pour", "sans", "contre", "leurs", "leur", "entre", "apres", "avant", "sous", "that", "with", "from", "their", "this", "have", "into", "over", "after"]);
export const wordsOf = (text) => new Set(norm(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)));
export const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
};
export const isNearRepeat = (a, b) => {
  const title = jaccard(wordsOf(a?.title), wordsOf(b?.title));
  if (title >= 0.6) return true;
  return title >= 0.4 && jaccard(wordsOf(a?.description), wordsOf(b?.description)) >= 0.5;
};
const hasImpacts = (event) => Object.values(event?.impacts && typeof event.impacts === "object" ? event.impacts : {})
  .some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value) && typeof value === "object" ? Object.keys(value).length > 0 : Boolean(value)));
const dayOf = (date) => Math.floor(Date.parse(`${norm(date).slice(0, 10)}T00:00:00Z`) / 86400000);
const mergeImpacts = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [key, value] of Object.entries(b ?? {})) {
    if (Array.isArray(value)) out[key] = [...(Array.isArray(out[key]) ? out[key] : []), ...value];
    else if (out[key] === undefined) out[key] = value;
  }
  return out;
};

// Returns { kept, dropped: [{ event, like }], merged: [{ event, into }] }.
export const screenRepeats = (priorEvents, generatedEvents, { windowDays = 60 } = {}) => {
  const prior = (Array.isArray(priorEvents) ? priorEvents : []).filter((event) => norm(event?.source) !== "engine");
  const kept = [];
  const dropped = [];
  const merged = [];
  for (const event of Array.isArray(generatedEvents) ? generatedEvents : []) {
    if (norm(event?.source) === "engine") { kept.push(event); continue; }
    const twin = kept.find((other) => norm(other?.source) !== "engine" && isNearRepeat(other, event));
    if (twin) {
      twin.impacts = mergeImpacts(twin.impacts, event.impacts);
      merged.push({ event, into: twin });
      continue;
    }
    const day = dayOf(event?.date);
    const like = !hasImpacts(event) && prior.find((other) => Number.isFinite(day) && day - dayOf(other?.date) <= windowDays && isNearRepeat(other, event));
    if (like) { dropped.push({ event, like }); continue; }
    kept.push(event);
  }
  return { kept, dropped, merged };
};

// Collapse exact duplicates within a single log (keeps the first occurrence). The
// choke-point every write funnels through, so no writer can persist a repeating log.
// `keyOf` says what "exact" means: the prose key (default), or eventCanonicalKey
// for a writer whose duplicates are only those with the same structured effects.
export const dedupeEventLog = (events, options) => dedupeGeneratedEvents([], events, options);
