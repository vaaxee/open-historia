// Test G (tour de bataille du 22 au 29 janvier 1936, plus de 5 minutes) : ce
// que coûte chaque étape d'un tour. Un chronomètre par tour : Jev, combat,
// politique, espionnage, construction du prompt, chaque appel à l'IA et sa
// validation (relances comprises), récit après validation, application ; les
// traductions de la page à part. Le relevé part au serveur (POST
// /api/debug/turn-profile, server/turnProfileLog.js), qui l'écrit dans
// DATA/logs/turn-profile.jsonl ; il reste aussi dans window.__ohTurnProfile.

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
let active = null;

export const startTurnProfile = (meta = {}) => {
  active = { kind: "turn", startedAt: new Date().toISOString(), started: now(), steps: [], ...meta };
  return active;
};
export const activeTurnProfile = () => active;

// Une étape : son nom, sa durée, quand elle a commencé depuis le début du tour.
export const recordStep = (step, ms, detail = {}) => {
  if (!active) return;
  active.steps.push({ step, ms: Math.round(ms), at: Math.round(now() - active.started - ms), ...detail });
};

// Chronomètre `fn` (synchrone ou non) sous le nom `step`. `detail(result)`
// ajoute ce qu'on sait après coup (nombre de décisions, de batailles…).
export const timeStep = async (step, fn, detail = null) => {
  const started = now();
  let result;
  try {
    result = await fn();
    return result;
  } finally {
    let extra = {};
    try { extra = typeof detail === "function" ? detail(result) ?? {} : {}; } catch { /* un détail illisible ne coûte pas l'étape */ }
    recordStep(step, now() - started, extra);
  }
};

// Un chronomètre à tours : `lap(step, detail)` note le temps écoulé depuis le
// tour précédent (ou la création), pour chronométrer des étapes qui se suivent
// sans toucher aux lignes qui les appellent.
export const lapClock = () => {
  let last = now();
  return (step, detail = {}) => {
    const at = now();
    recordStep(step, at - last, detail);
    last = at;
  };
};

// Le cumul par étape : { step, count, ms }, du plus coûteux au moins coûteux.
export const summarizeSteps = (steps) => {
  const byStep = new Map();
  for (const entry of steps ?? []) {
    const row = byStep.get(entry.step) ?? { step: entry.step, count: 0, ms: 0 };
    row.count += 1;
    row.ms += Number(entry.ms) || 0;
    byStep.set(entry.step, row);
  }
  return [...byStep.values()].sort((a, b) => b.ms - a.ms);
};

const send = (entry, fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== "function") return;
  try {
    Promise.resolve(fetchImpl("/api/debug/turn-profile", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry),
    })).catch(() => {});
  } catch { /* le relevé ne coûte jamais le tour */ }
};

export const finishTurnProfile = (extra = {}, { fetchImpl } = {}) => {
  const profile = active;
  active = null;
  if (!profile) return null;
  const { started, ...rest } = profile;
  const entry = { ...rest, totalMs: Math.round(now() - started), ...extra, summary: summarizeSteps(profile.steps) };
  if (typeof window !== "undefined") window.__ohTurnProfile = entry;
  send(entry, fetchImpl);
  return entry;
};

// Les traductions de la page : un lot, sa durée, sa taille. Envoyées groupées
// (au plus une fois toutes les 5 s) pour ne pas multiplier les requêtes.
let translations = [];
let flushTimer = null;
export const recordTranslation = ({ ms, strings = 0, chars = 0, language = "", ok = true }, { fetchImpl } = {}) => {
  const entry = { at: new Date().toISOString(), ms: Math.round(ms), strings, chars, language, ok };
  if (active) recordStep("translation", ms, { strings, chars });
  translations.push(entry);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = translations;
    translations = [];
    send({ kind: "translation", batches: batch, totalMs: batch.reduce((sum, row) => sum + row.ms, 0) }, fetchImpl);
  }, 5000);
};
