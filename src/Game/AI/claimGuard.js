// Guard: a story may not announce what the engine refused.
//
// The field report (a Soviet game, January 1936): the model wrote "Fall of
// Vilnius and unconditional surrender" with a transfer the engine refused
// ("Lituanie" was not a power on the map, and Vilnius was Polish anyway). The
// transfer was dropped, the story stayed, and the following turns narrated
// condemnations of an annexation the map never saw.
//
// No extra request: an event whose territorial operations the engine refused,
// and whose text announces a capture, a fall, an annexation, a cession or a
// capitulation, is rewritten by the engine as an attempt that did not succeed —
// in the event's own language — and the next turn's receipt says it did NOT
// happen. A capitulation is also rewritten when the event carries no territorial
// operation at all: the engine has no other way to make one real.
// (The two-step narration, narrateAfterValidation in gameplay.js, does better
// with one more request; this guard is what always holds.)

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// What counts as announcing a change of hands, by language. Stems, matched on
// lowercase text with accents kept (French "cède", German "abgetreten").
// No \b beside an accented letter: in JavaScript \b only knows ASCII letters,
// so "\btombée\b" would never match.
const CHANGE_OF_HANDS = [
  // English
  /\b(captur|seiz|conquer|annex|occup|overr[au]n|took control|takes control|fall of|falls to|fell to|cede[sd]?\b|cession|incorporat|hand(?:s|ed)? over|surrender|capitulat)/,
  // French
  /(prise d[eu] |prise de l'|\bprenn?ent\b|\bprend\b|s'empare|chute d[eu] |chute de l'|\btomb[eé]|\bannex|\boccup|\bconqu[iê]|\bc[èe]d(?:e|ent)\b|\bcession\b|\bincorpor|\brattach|\breddition\b|\bcapitul)/,
  // German
  /(erober|einnahme|\bfall von\b|annekt|besetz|abgetreten|abtretung|kapitul)/,
  // Spanish, Italian
  /(\bcaptura|\btoma de\b|ca[ií]da de |\bcaduta di\b|\bpresa di\b|\banexi|\bannession|\bconquist|\bcede\b|\bcedid|cesi[oó]n\b|\bcessione\b|rendici[oó]n\b|\bresa\b|\bcapitul)/,
];
const CAPITULATION = /(surrender|capitulat|reddition|capitul|kapitul|rendici[oó]n|\bresa\b)/;
// Already told as a failure or an attempt: nothing to rewrite.
const FAILURE = /(\battempt|\bfail|\brepel|\brepuls|\bstall|without effect|\btentative\b|\btente\b|échou|sans effet|\brepouss|\benlis|\bversuch|\bscheiter|gescheitert|\bintento\b|fracas|\btentativo\b|\bfallit)/;

export const assertsChangeOfHands = (text) => {
  const lower = clean(text).toLowerCase();
  return Boolean(lower) && CHANGE_OF_HANDS.some((pattern) => pattern.test(lower));
};
export const assertsCapitulation = (text) => CAPITULATION.test(clean(text).toLowerCase());
export const toldAsFailure = (text) => FAILURE.test(clean(text).toLowerCase());

// The event's language, near enough to word the engine's sentence in it.
export const detectLanguage = (text) => {
  const words = ` ${clean(text).toLowerCase().replace(/[^\p{L}' ]+/gu, " ")} `;
  const score = (list) => list.reduce((n, word) => n + (words.includes(` ${word} `) ? 1 : 0), 0);
  const scores = {
    fr: score(["le", "la", "les", "des", "du", "et", "une", "est", "dans", "par", "sur", "pour", "avec", "sans"]),
    en: score(["the", "and", "of", "to", "in", "is", "by", "with", "for", "on", "its", "from", "as"]),
    de: score(["der", "die", "das", "und", "von", "mit", "den", "ist", "im", "auf", "für"]),
    es: score(["el", "los", "las", "del", "y", "en", "por", "con", "una", "para", "que"]),
    it: score(["il", "gli", "della", "di", "e", "con", "per", "una", "che", "nel", "sono"]),
  };
  const [best, points] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return points >= 2 ? best : "en";
};

// The reader sees a story, not the engine: plain prose in the event's language,
// with no technical reason in it (those go to the receipt, in English, for the
// next turn's model).
const WORDING = {
  en: {
    title: (title) => `Attempted: ${title}`,
    body: () => "The attempt comes to nothing: no border moves and no government gives way. What was announced did not happen.",
    partial: () => "Not all of it came to pass, though: the rest of what was announced did not happen, and no other border moved.",
  },
  fr: {
    title: (title) => `Tentative : ${title}`,
    body: () => "La tentative tourne court : aucune frontière ne bouge et aucun gouvernement ne cède. Ce qui était annoncé n'a pas eu lieu.",
    partial: () => "Tout ne s'est pas passé comme annoncé : le reste n'a pas eu lieu, et aucune autre frontière n'a bougé.",
  },
  de: {
    title: (title) => `Versuch: ${title}`,
    body: () => "Der Versuch läuft ins Leere: keine Grenze verschiebt sich, keine Regierung gibt nach. Was angekündigt war, ist nicht geschehen.",
    partial: () => "Nicht alles kam jedoch wie angekündigt: der Rest ist nicht geschehen, und keine weitere Grenze hat sich verschoben.",
  },
  es: {
    title: (title) => `Intento: ${title}`,
    body: () => "El intento queda en nada: ninguna frontera se mueve y ningún gobierno cede. Lo anunciado no ha ocurrido.",
    partial: () => "Sin embargo, no todo ocurrió como se anunció: el resto no tuvo lugar y ninguna otra frontera se movió.",
  },
  it: {
    title: (title) => `Tentativo: ${title}`,
    body: () => "Il tentativo non approda a nulla: nessun confine si sposta e nessun governo cede. Quanto annunciato non è avvenuto.",
    partial: () => "Non tutto però è andato come annunciato: il resto non è avvenuto e nessun altro confine si è spostato.",
  },
};

// Rewrites one event in place as a failed attempt. The model's text is kept
// out of sight in `rewrittenFrom` (for the log and the Game Master), never shown
// as what happened.
export const rewriteAsAttempt = (event, { reasons = "" } = {}) => {
  const title = clean(event?.title) || "event";
  const language = detectLanguage(`${event?.title ?? ""} ${event?.description ?? ""}`);
  const wording = WORDING[language] ?? WORDING.en;
  event.rewrittenFrom = { title: event.title ?? "", description: event.description ?? "" };
  event.title = wording.title(title);
  event.description = wording.body(title, clean(reasons));
  return event;
};

// An event the engine enacted in part: its text stays, and the engine's own
// sentence says which part did NOT happen.
export const noteRefusedPart = (event, { reasons = "" } = {}) => {
  const language = detectLanguage(`${event?.title ?? ""} ${event?.description ?? ""}`);
  const wording = WORDING[language] ?? WORDING.en;
  event.description = `${clean(event.description)} ${wording.partial(clean(reasons))}`.trim();
  event.partlyRefused = true;
  return event;
};

// containers: [{ event, impacts, path }] after the territorial operations were
// resolved (the refused ones already left out of impacts). refused: the
// resolver's unresolved entries ({ path, label, ... }), with a text for each.
// Rewrites what must be rewritten; returns the receipt lines, one per event.
export const guardRefusedTerritory = (containers, refused = [], { describe = (entry) => clean(entry?.label) } = {}) => {
  const refusedByPath = new Map();
  for (const entry of Array.isArray(refused) ? refused : []) {
    const path = clean(entry?.path);
    if (!path) continue;
    if (!refusedByPath.has(path)) refusedByPath.set(path, []);
    refusedByPath.get(path).push(entry);
  }
  const notes = [];
  for (const container of Array.isArray(containers) ? containers : []) {
    const { event, impacts, path } = container ?? {};
    if (!event || typeof event !== "object") continue;
    const text = `${event.title ?? ""}. ${event.description ?? ""}`;
    if (toldAsFailure(text)) continue;
    const refusedHere = refusedByPath.get(path) ?? [];
    const applied = (Array.isArray(impacts?.regionTransfers) ? impacts.regionTransfers.length : 0)
      + (Array.isArray(impacts?.regionControlOps) ? impacts.regionControlOps.length : 0);
    const refusedClaim = refusedHere.length > 0 && assertsChangeOfHands(text);
    const bareCapitulation = applied === 0 && assertsCapitulation(text);
    if (!refusedClaim && !bareCapitulation) continue;
    const reasons = refusedHere.map(describe).filter(Boolean).slice(0, 3).join("; ");
    const original = clean(event.title);
    // Part of it happened: keep the story, and say which part did not.
    if (refusedClaim && applied > 0) {
      noteRefusedPart(event, { reasons });
      notes.push(`Event "${original}" was enacted only in part: the engine refused ${reasons || "some of its territorial changes"}. That part did NOT happen: do not narrate it as done in later events.`);
      continue;
    }
    rewriteAsAttempt(event, { reasons: refusedHere.length ? reasons : "" });
    notes.push(refusedClaim
      ? `Event "${original}" announced a change of hands the engine refused (${reasons || "see above"}); it was rewritten as an attempt. This did NOT happen: no border moved. Do not narrate it as done in later events.`
      : `Event "${original}" announced a capitulation with no territorial operation behind it; it was rewritten as an attempt. This did NOT happen: no government surrendered and no border moved. Do not narrate it as done in later events.`);
  }
  return notes;
};
