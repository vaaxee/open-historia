/*! Open Historia — does a cached translation belong to its source string? */
// The translator used to pair a batch's answers with its strings by position, so
// an answer one string short shifted every later translation onto the wrong
// source (game F: a Hungarian agent under a Danish title, game E's
// "Lituanie : Tentative d'annexion pacifique" as a spy event's text). Those pairs
// sit in the shared language pack and in each browser's cache. This tells such a
// pair from a real translation, so they can be dropped and translated again.
// It looks only at what a translation must keep: the language it already had,
// its numbers, the countries it names, and roughly its length.

import { EXONYMS } from "./polityExonyms.js";

const fold = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const letters = (value) => fold(value).replace(/[^a-z0-9]+/g, "");

const STOPWORDS = {
  fr: ["le", "la", "les", "de", "des", "du", "une", "et", "est", "sur", "dans", "pour", "avec", "aux", "au", "par", "qui", "que", "ses", "son", "leur", "contre"],
  en: ["the", "and", "of", "to", "is", "are", "with", "for", "its", "has", "have", "this", "that", "on", "from", "by", "was"],
};
const count = (text, words) => {
  const tokens = fold(text).split(/[^a-z]+/);
  return tokens.filter((token) => words.includes(token)).length;
};
// "fr", "en" or "" when the text is too short or mixed to say.
export const textLanguage = (text) => {
  const fr = count(text, STOPWORDS.fr);
  const en = count(text, STOPWORDS.en);
  if (fr >= 3 && fr > en * 2) return "fr";
  if (en >= 3 && en > fr * 2) return "en";
  // A short title: "Lituanie : Tentative d'annexion pacifique par l'Union soviétique".
  if (!en && (fr >= 2 || (fr >= 1 && /[éèàçêôûîœ]/i.test(String(text))))) return "fr";
  if (!fr && en >= 2) return "en";
  return "";
};

const numbers = (text) => (String(text ?? "").match(/\d+/g) ?? []).sort().join(",");

// Every country a text names, by its English name (EXONYMS covers French,
// German, Spanish and Italian names, and English ones map to themselves).
const ENGLISH = [...new Set(Object.values(EXONYMS))];
const NAMES = new Map(Object.entries(EXONYMS));
for (const name of ENGLISH) NAMES.set(letters(name), name);
export const countriesNamed = (text) => countries(text);
function countries(text) {
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  const found = new Set();
  for (let size = 1; size <= 4; size += 1) {
    for (let index = 0; index + size <= words.length; index += 1) {
      const name = NAMES.get(words.slice(index, index + size).join(""));
      if (name) found.add(name);
    }
  }
  return found;
}

// Why `translated` is not a translation of `source` into `language`, or "".
export const misalignedReason = (source, translated, language = "fr") => {
  const from = String(source ?? "").trim();
  const to = String(translated ?? "").trim();
  if (!from || !to || from === to) return "";
  // Already in the target language: the answer had to be the same text. Any
  // change is a rewrite (test F: the player's order to Finland came back
  // reworded, "Vyborg" in bold) or another string's translation.
  if (textLanguage(from) === language) return "the source was already in that language and came back changed";
  if (numbers(from) !== numbers(to) && /\d/.test(from + to)) return "the numbers differ";
  const named = countries(from);
  const answered = countries(to);
  // A country dropped and another brought in: the text is about someone else.
  if ([...named].some((name) => !answered.has(name)) && [...answered].some((name) => !named.has(name))) return "it names other countries";
  if (from.length >= 30 && (to.length > from.length * 2.5 || to.length < from.length * 0.4)) return "its length is far from the source's";
  return "";
};

// The entries of a language pack whose translation belongs to another string.
export const misalignedEntries = (entries, language = "fr") => Object.entries(entries ?? {})
  .filter(([source, translated]) => typeof translated === "string" && misalignedReason(source, translated, language))
  .map(([source]) => source);
