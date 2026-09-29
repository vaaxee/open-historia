// Test G (Mistral, 1er–15 janvier 1936) : deux tours de suite en mode secours,
// « $.stopDate is required ». Le modèle fermait mal la liste `events` : les
// champs de l'objet arrivaient comme éléments de la liste, en paires
//   ..., {dernier événement}, "stopDate: ", "1936-01-08", "summary: ", "…",
//   "clearActions: ", true, "diplomaticOutreach: ", [], ...]
// Réparé ici avant la validation : à partir du premier élément « clé: », les
// paires (clé, valeur) de la fin de la liste redeviennent des champs de l'objet.
// Un champ que l'objet a déjà n'est pas remplacé. Pur, sans import.

const KEY = /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*:\s*$/;

export const misplacedKey = (value) => (typeof value === "string" ? value.match(KEY)?.[1] ?? "" : "");

// { value, lifted } — `value` réparé (copie), `lifted` : les clés remontées.
export const liftMisplacedFields = (value, { list = "events" } = {}) => {
  const items = value?.[list];
  if (!Array.isArray(items)) return { value, lifted: [] };
  const start = items.findIndex((item) => misplacedKey(item));
  if (start < 0) return { value, lifted: [] };
  const tail = items.slice(start);
  // Seulement une fin faite de paires (clé, valeur) : sinon, rien n'est touché.
  if (tail.length % 2 !== 0 || tail.some((item, index) => index % 2 === 0 && !misplacedKey(item))) return { value, lifted: [] };
  const repaired = { ...value, [list]: items.slice(0, start) };
  const lifted = [];
  for (let index = 0; index < tail.length; index += 2) {
    const key = misplacedKey(tail[index]);
    if (key === list || repaired[key] !== undefined) continue;
    repaired[key] = tail[index + 1];
    lifted.push(key);
  }
  return { value: repaired, lifted };
};

// Même réponse : les registres (« warUpdates », « storylineUpdates »…) écrits
// DANS un événement, là où le schéma les attend en haut de la réponse. Le schéma
// les aurait coupés, et avec eux la guerre du joueur ; ils rejoignent le registre
// du haut (une ligne par enregistrement), l'événement restant lié par son warId.
export const EVENT_LEDGERS = Object.freeze(["warUpdates", "storylineUpdates", "relationUpdates", "agreementUpdates"]);
export const liftEventLedgers = (value) => {
  const events = value?.events;
  if (!Array.isArray(events)) return { value, lifted: [] };
  const lifted = [];
  const repaired = { ...value };
  repaired.events = events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return event;
    const own = EVENT_LEDGERS.filter((field) => typeof event[field] === "string" && event[field].trim());
    if (!own.length) return event;
    const next = { ...event };
    for (const field of own) {
      const top = repaired[field];
      const line = next[field].trim();
      if (Array.isArray(top)) repaired[field] = [...top, line];
      else repaired[field] = [String(top ?? "").trim(), line].filter(Boolean).join("\n");
      delete next[field];
      lifted.push(field);
    }
    return next;
  });
  return { value: repaired, lifted };
};

// La consigne de la nouvelle demande quand la liste est encore mal fermée.
export const misplacedFieldsHint = (value, { list = "events" } = {}) => {
  const keys = (Array.isArray(value?.[list]) ? value[list] : []).map(misplacedKey).filter(Boolean);
  if (!keys.length) return "";
  return `Your "${list}" array is not closed where it should be: ${keys.map((key) => `"${key}"`).join(", ")} were written as strings INSIDE "${list}" ("${keys[0]}: ", value, …). Close "${list}" with "]" after its last event object, then write each of them as a field of the top-level object: "${keys[0]}": value.`;
};
