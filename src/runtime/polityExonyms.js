/*! Open Historia — polity names in other languages, back to the map's exact name. */
// The engine keys every polity by the exact name the map spells ("Lithuania",
// "United Kingdom", "Imperialist Japan"). A model that writes the story in French
// names them "Lituanie", "Royaume-Uni", "Japon": before this, such a name made
// the transfer fail ("Lituanie is not a power on this map"), dropped the war,
// left chats unopened — and a receiver named that way FOUNDED a second country
// beside the real one. Every polity name in a generated payload now goes through
// here first (validateGeneratedWorldChanges in AI/gameplay.js).
//
// A name is translated only to a polity the map already has:
//   1. the name, a polity's display name or one of its aliases, or a country code;
//   2. an exonym from EXONYMS below (French, German, Spanish, Italian, Russian
//      transliterations…), turned into the English name and matched as in 1;
//   3. failing that, the one polity whose name ends with that English name
//      ("Japon" → "Japan" → "Imperialist Japan"), when exactly one does.
// Anything else is left exactly as written: an unknown receiver still founds a
// polity under the name the model gave it.

import { ownerIdentityKey, toCountryName } from "./ownerNames.js";

// Folded exonym → English name. Folding is ownerIdentityKey (case, accents and
// punctuation dropped), so "Royaume-Uni", "royaume uni" and "ROYAUME UNI" are one key.
const EXONYM_ROWS = [
  // French
  ["Allemagne", "Germany"], ["Reich allemand", "Germany"], ["Troisième Reich", "Germany"], ["Autriche", "Austria"],
  ["Royaume-Uni", "United Kingdom"], ["Grande-Bretagne", "United Kingdom"], ["Angleterre", "United Kingdom"],
  ["États-Unis", "United States"], ["États-Unis d'Amérique", "United States"], ["Amérique", "United States"],
  ["Union soviétique", "Soviet Union"], ["URSS", "Soviet Union"], ["Russie soviétique", "Soviet Union"], ["Russie", "Russia"],
  ["Italie", "Italy"], ["Espagne", "Spain"], ["Pologne", "Poland"], ["Lituanie", "Lithuania"], ["Lettonie", "Latvia"],
  ["Estonie", "Estonia"], ["Finlande", "Finland"], ["Suède", "Sweden"], ["Norvège", "Norway"], ["Danemark", "Denmark"],
  ["Pays-Bas", "Netherlands"], ["Hollande", "Netherlands"], ["Belgique", "Belgium"], ["Suisse", "Switzerland"],
  ["Tchécoslovaquie", "Czechoslovakia"], ["Hongrie", "Hungary"], ["Roumanie", "Romania"], ["Bulgarie", "Bulgaria"],
  ["Yougoslavie", "Yugoslavia"], ["Grèce", "Greece"], ["Albanie", "Albania"], ["Turquie", "Turkey"],
  ["Irlande", "Ireland"], ["Islande", "Iceland"], ["Portugal", "Portugal"], ["Luxembourg", "Luxembourg"],
  ["Ville libre de Dantzig", "Free City of Danzig"], ["Dantzig", "Free City of Danzig"],
  ["Zone internationale de Tanger", "Tangier International Zone"], ["Tanger", "Tangier International Zone"],
  ["Japon", "Japan"], ["Empire du Japon", "Japan"], ["Chine", "China"], ["Mandchoukouo", "Manchukuo"], ["Mongolie", "Mongolia"],
  ["Inde", "India"], ["Inde britannique", "British Raj"], ["Perse", "Iran"], ["Irak", "Iraq"], ["Syrie", "Syria"],
  ["Liban", "Lebanon"], ["Arabie saoudite", "Saudi Arabia"], ["Égypte", "Egypt"], ["Éthiopie", "Ethiopia"],
  ["Abyssinie", "Ethiopia"], ["Libéria", "Liberia"], ["Afrique du Sud", "South Africa"], ["Maroc", "Morocco"],
  ["Algérie", "Algeria"], ["Tunisie", "Tunisia"], ["Libye", "Libya"], ["Canada", "Canada"], ["Mexique", "Mexico"],
  ["Brésil", "Brazil"], ["Argentine", "Argentina"], ["Chili", "Chile"], ["Pérou", "Peru"], ["Colombie", "Colombia"],
  ["Australie", "Australia"], ["Nouvelle-Zélande", "New Zealand"], ["Thaïlande", "Thailand"], ["Siam", "Thailand"],
  ["Afghanistan", "Afghanistan"], ["Népal", "Nepal"], ["Tibet", "Tibet"], ["Corée", "Korea"], ["Philippines", "Philippines"],
  ["Indes néerlandaises", "Dutch East Indies"], ["Touva", "Tannu Tuva"], ["Tannou-Touva", "Tannu Tuva"],
  // German
  ["Deutschland", "Germany"], ["Deutsches Reich", "Germany"], ["Österreich", "Austria"], ["Großbritannien", "United Kingdom"],
  ["Vereinigtes Königreich", "United Kingdom"], ["Vereinigte Staaten", "United States"], ["Sowjetunion", "Soviet Union"],
  ["Italien", "Italy"], ["Spanien", "Spain"], ["Polen", "Poland"], ["Litauen", "Lithuania"], ["Lettland", "Latvia"],
  ["Estland", "Estonia"], ["Finnland", "Finland"], ["Schweden", "Sweden"], ["Norwegen", "Norway"], ["Dänemark", "Denmark"],
  ["Niederlande", "Netherlands"], ["Belgien", "Belgium"], ["Schweiz", "Switzerland"], ["Tschechoslowakei", "Czechoslovakia"],
  ["Ungarn", "Hungary"], ["Rumänien", "Romania"], ["Bulgarien", "Bulgaria"], ["Jugoslawien", "Yugoslavia"],
  ["Griechenland", "Greece"], ["Albanien", "Albania"], ["Türkei", "Turkey"], ["Frankreich", "France"], ["Freie Stadt Danzig", "Free City of Danzig"],
  ["Danzig", "Free City of Danzig"], ["Japan", "Japan"], ["Mandschukuo", "Manchukuo"],
  // Spanish
  ["Alemania", "Germany"], ["Reino Unido", "United Kingdom"], ["Gran Bretaña", "United Kingdom"], ["Estados Unidos", "United States"],
  ["Unión Soviética", "Soviet Union"], ["Italia", "Italy"], ["España", "Spain"], ["Polonia", "Poland"], ["Lituania", "Lithuania"],
  ["Letonia", "Latvia"], ["Finlandia", "Finland"], ["Suecia", "Sweden"], ["Noruega", "Norway"], ["Dinamarca", "Denmark"],
  ["Países Bajos", "Netherlands"], ["Bélgica", "Belgium"], ["Suiza", "Switzerland"], ["Checoslovaquia", "Czechoslovakia"],
  ["Hungría", "Hungary"], ["Rumania", "Romania"], ["Yugoslavia", "Yugoslavia"], ["Grecia", "Greece"], ["Turquía", "Turkey"],
  ["Francia", "France"], ["Japón", "Japan"], ["Marruecos", "Morocco"], ["Tánger", "Tangier International Zone"],
  // Italian
  ["Germania", "Germany"], ["Regno Unito", "United Kingdom"], ["Stati Uniti", "United States"], ["Unione Sovietica", "Soviet Union"],
  ["Spagna", "Spain"], ["Lettonia", "Latvia"], ["Svezia", "Sweden"], ["Norvegia", "Norway"], ["Danimarca", "Denmark"],
  ["Paesi Bassi", "Netherlands"], ["Belgio", "Belgium"], ["Svizzera", "Switzerland"], ["Cecoslovacchia", "Czechoslovakia"],
  ["Ungheria", "Hungary"], ["Jugoslavia", "Yugoslavia"], ["Turchia", "Turkey"], ["Giappone", "Japan"], ["Etiopia", "Ethiopia"],
  // Russian (transliterated) and common short forms
  ["SSSR", "Soviet Union"], ["USSR", "Soviet Union"], ["Sovetsky Soyuz", "Soviet Union"], ["Germaniya", "Germany"],
  ["Polsha", "Poland"], ["Litva", "Lithuania"], ["Latviya", "Latvia"], ["Estoniya", "Estonia"], ["Finlyandiya", "Finland"],
  ["UK", "United Kingdom"], ["Britain", "United Kingdom"], ["Great Britain", "United Kingdom"], ["England", "United Kingdom"],
  ["USA", "United States"], ["US", "United States"], ["America", "United States"], ["Nazi Germany", "Germany"],
  ["Third Reich", "Germany"], ["Soviet Russia", "Soviet Union"], ["Persia", "Iran"], ["Abyssinia", "Ethiopia"],
  ["Holland", "Netherlands"], ["Danzig Free City", "Free City of Danzig"], ["Tangier", "Tangier International Zone"],
];

export const EXONYMS = Object.freeze(Object.fromEntries(
  EXONYM_ROWS.map(([foreign, english]) => [ownerIdentityKey(foreign), english]),
));

// The polities a world knows, by folded name: key, display name, aliases, and
// every owner a region carries. A name two polities answer to identifies nobody.
const buildPolityIndex = (world) => {
  const index = new Map();
  const ambiguous = new Set();
  const add = (name, canonical) => {
    const key = ownerIdentityKey(name);
    if (!key || !canonical) return;
    const existing = index.get(key);
    if (existing && existing !== canonical) ambiguous.add(key);
    else index.set(key, canonical);
  };
  for (const token of Object.keys(world?.polityOverrides ?? {})) add(token, token);
  for (const [token, polity] of Object.entries(world?.polityOverrides ?? {})) {
    if (!polity || typeof polity !== "object") continue;
    add(polity.name, token);
    for (const alias of Array.isArray(polity.aliases) ? polity.aliases : []) add(alias, token);
  }
  for (const owner of [
    ...Object.values(world?.regionOwnershipOverrides ?? {}),
    ...Object.values(world?.regionSovereigntyOverrides ?? {}),
  ]) {
    const name = String(owner ?? "").trim();
    if (name) add(name, name);
  }
  for (const key of ambiguous) index.delete(key);
  return index;
};

// token -> the map's exact polity name, or the token unchanged.
export const createPolityNameTranslator = (world) => {
  const index = buildPolityIndex(world);
  const canonicals = [...new Set(index.values())];
  const exact = (name) => index.get(ownerIdentityKey(name)) ?? "";
  // "Japan" → the one polity whose name ends with it ("Imperialist Japan").
  const bySuffix = (english) => {
    const tail = ownerIdentityKey(english);
    if (tail.length < 4) return "";
    const hits = canonicals.filter((name) => ownerIdentityKey(name).endsWith(tail));
    return hits.length === 1 ? hits[0] : "";
  };
  return (token) => {
    const raw = String(token ?? "").trim();
    if (!raw) return raw;
    const direct = exact(raw) || exact(toCountryName(raw));
    if (direct) return direct;
    const english = EXONYMS[ownerIdentityKey(raw)];
    if (english) return exact(english) || bySuffix(english) || raw;
    return raw;
  };
};

const WAR_SEPARATOR = "~";

// Every polity name in a generated payload, rewritten in place to the map's
// exact name. Returns the translations made ([{ from, to }], one per distinct
// name), for the receipt.
export const canonicalizePayloadPolityNames = (candidate, world) => {
  if (!candidate || typeof candidate !== "object") return [];
  const translate = createPolityNameTranslator(world);
  const made = new Map();
  const fix = (value) => {
    if (typeof value !== "string") return value;
    const next = translate(value);
    if (next && next !== value.trim()) {
      made.set(value.trim(), next);
      return next;
    }
    return value;
  };
  const fixField = (object, field) => {
    if (object && typeof object === "object" && typeof object[field] === "string") object[field] = fix(object[field]);
  };
  const fixList = (list) => (Array.isArray(list) ? list.map((item) => (typeof item === "string" ? fix(item) : item)) : list);
  const fixCountries = (countries) => (Array.isArray(countries)
    ? countries.map((entry) => {
      if (typeof entry === "string") return fix(entry);
      if (entry && typeof entry === "object") {
        const code = typeof entry.code === "string" ? fix(entry.code) : entry.code;
        const name = typeof entry.name === "string" ? fix(entry.name) : entry.name;
        return { ...entry, code, name };
      }
      return entry;
    })
    : countries);
  const fixChat = (chat) => {
    if (!chat || typeof chat !== "object") return;
    chat.countries = fixCountries(chat.countries);
    fixField(chat, "speaker");
  };
  const fixImpacts = (impacts) => {
    if (!impacts || typeof impacts !== "object") return;
    for (const transfer of Array.isArray(impacts.regionTransfers) ? impacts.regionTransfers : []) {
      fixField(transfer, "fromCode"); fixField(transfer, "toCode");
    }
    for (const op of Array.isArray(impacts.regionControlOps) ? impacts.regionControlOps : []) {
      fixField(op, "fromCode"); fixField(op, "toCode"); fixField(op, "actorCode"); fixField(op, "claimantCode");
    }
    for (const claim of Array.isArray(impacts.regionClaims) ? impacts.regionClaims : []) fixField(claim, "claimantCode");
    for (const chat of Array.isArray(impacts.createdChats) ? impacts.createdChats : []) fixChat(chat);
    for (const op of Array.isArray(impacts.unitOps) ? impacts.unitOps : []) {
      fixField(op, "ownerCode"); fixField(op?.unit, "ownerCode");
    }
    for (const op of Array.isArray(impacts.markerOps) ? impacts.markerOps : []) {
      fixField(op, "ownerCode"); fixField(op?.marker, "ownerCode");
    }
    for (const change of Array.isArray(impacts.polityChanges) ? impacts.polityChanges : []) {
      // A creation, restoration or rename names the polity it brings into being:
      // those names are the model's to choose. An update addresses an existing one.
      const operation = String(change?.operation ?? "").trim().toLowerCase();
      if (!["create", "restore", "rename"].includes(operation)) fixField(change, "code");
    }
  };
  // Ledger records travel as text lines ("id~op~actors~opponents~…"): every
  // field, and every comma-separated name in one, is translated only when the
  // whole of it is a polity name, so free text is left alone.
  const fixLedgerText = (text) => String(text).split(/\r?\n/).map((line) => line.split(WAR_SEPARATOR)
    .map((field) => field.split(",").map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const next = fix(trimmed);
      return next === trimmed ? part : part.replace(trimmed, next);
    }).join(","))
    .join(WAR_SEPARATOR)).join("\n");
  const fixLedger = (value) => {
    if (typeof value === "string") return fixLedgerText(value);
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
      if (typeof entry === "string") return fixLedgerText(entry);
      if (!entry || typeof entry !== "object") return entry;
      const next = { ...entry };
      for (const field of ["actors", "opponents", "participants", "polities", "parties"]) {
        if (Array.isArray(next[field])) next[field] = fixList(next[field]);
      }
      return next;
    });
  };

  for (const event of Array.isArray(candidate.events) ? candidate.events : []) {
    if (!event || typeof event !== "object") continue;
    fixImpacts(event.impacts);
    if (Array.isArray(event.combatants)) event.combatants = fixList(event.combatants);
  }
  fixImpacts(candidate.impacts);
  for (const chat of Array.isArray(candidate.diplomaticOutreach) ? candidate.diplomaticOutreach : []) fixChat(chat);
  for (const field of ["warUpdates", "relationUpdates", "agreementUpdates", "storylineUpdates"]) {
    if (candidate[field] !== undefined) candidate[field] = fixLedger(candidate[field]);
  }
  return [...made].map(([from, to]) => ({ from, to }));
};
