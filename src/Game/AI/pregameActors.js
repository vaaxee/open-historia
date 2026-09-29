// Test G : l'histoire d'avant la partie échouait à chaque ouverture, parce
// qu'un enregistrement citait « League of Nations », qui n'est pas un pays de la
// carte. Un acteur inconnu est retiré de l'enregistrement ; un enregistrement
// qui n'a plus assez d'acteurs est retiré ; la génération continue. Pur.

const list = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").trim();

// Les champs d'acteurs de chaque registre, et le minimum pour qu'il tienne.
const FIELDS = Object.freeze({
  storylineUpdates: [{ field: "participants", min: 1 }],
  warUpdates: [{ field: "actors", min: 1 }, { field: "opponents", min: 1 }],
  agreementUpdates: [{ field: "parties", min: 2 }],
});

// `ledgers` : { storylineUpdates, warUpdates, relationUpdates, agreementUpdates }
// déjà décodés. `isKnown(name)` : un pays de la carte. Renvoie les registres
// nettoyés et les notes ({ ledger, record, removed: [...], dropped }).
export const pruneUnknownActors = (ledgers, isKnown) => {
  const notes = [];
  const out = {};
  for (const [ledger, records] of Object.entries(ledgers)) {
    out[ledger] = list(records).flatMap((record) => {
      const id = clean(record?.id) || `${ledger} record`;
      if (ledger === "relationUpdates") {
        const unknown = [record?.a, record?.b].filter((name) => clean(name) && !isKnown(clean(name))).map(clean);
        if (!unknown.length) return [record];
        notes.push({ ledger, record: id, removed: unknown, dropped: true });
        return [];
      }
      const specs = FIELDS[ledger];
      if (!specs) return [record];
      let next = record;
      const removed = [];
      let dropped = false;
      for (const { field, min } of specs) {
        const names = list(record?.[field]);
        const kept = names.filter((name) => isKnown(clean(name)));
        removed.push(...names.filter((name) => !isKnown(clean(name))).map(clean));
        if (kept.length < min) dropped = true;
        next = { ...next, [field]: kept };
      }
      if (!removed.length) return [record];
      notes.push({ ledger, record: id, removed, dropped });
      return dropped ? [] : [next];
    });
  }
  return { ledgers: out, notes };
};

export const describePrunedActors = ({ ledger, record, removed, dropped }) =>
  `${ledger} ${record}: ${removed.map((name) => `"${name}"`).join(", ")} ${removed.length === 1 ? "is" : "are"} not a country on this map and ${removed.length === 1 ? "was" : "were"} left out${dropped ? "; the record, left without enough countries, was dropped" : ""}.`;
