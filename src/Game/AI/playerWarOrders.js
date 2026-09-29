// The player's declaration of war is carried out, or refused out loud.
//
// The field report (game F): the order "Déclarer la guerre à la Lituanie et lancer
// l'Armée rouge à la conquête de Kaunas" came back with no war record, no event
// about it and no refusal — and the order was marked done. Declaring war is an
// act of the player's own government: nothing on the other side has to agree.
// So when an order declares war on a polity the map knows, and neither the world
// nor the answer holds that war, the engine starts it with an event of its own,
// tied to the order. An order that declares war on nobody the map knows is
// refused with its reason in the receipt.

// Game F, second week: the model did start the war — on its offensive towards
// Kaunas, an event that never says war was declared — so no event announced it
// (and the ledger, reading only English, then dropped it). The player's
// declaration is an act of its own: the engine now always tells it, in the
// game's language, and a war the answer started from some other event is moved
// onto that announcement, which comes first.

import { createPolityNameTranslator, frenchPolityWithArticle, mentionedPolities } from "../../runtime/polityExonyms.js";
import { eventDeclaresWar } from "./nativeWarLedger.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);

const DECLARE_WAR = /(d[ée]clar\w*\s+(?:la\s+)?guerre|declar\w*\s+(?:of\s+)?war|declaration of war|kriegserkl[äa]rung|den krieg erkl[äa]r|declara\w*\s+(?:la\s+)?guerra|dichiara\w*\s+(?:la\s+)?guerra|dichiarazione di guerra)/i;

export const declaresWar = (text) => DECLARE_WAR.test(clean(text));

// The polity an order declares war on: the one polity (other than the player)
// the order names; with several, the one named right after the declaration.
export const warOrderTarget = (text, world, player) => {
  const others = mentionedPolities(text, world).filter((polity) => key(polity) !== key(player));
  if (others.length <= 1) return others[0] ?? "";
  const after = clean(text).split(DECLARE_WAR).slice(-1)[0] ?? "";
  const first = mentionedPolities(after.split(/[,.;:]| et | and | und | y | e /)[0] ?? "", world).filter((polity) => key(polity) !== key(player));
  return first.length === 1 ? first[0] : "";
};

const atWarWith = (wars, a, b) => list(wars).some((war) => {
  if (clean(war?.status || "active") === "ended") return false;
  const sideA = list(war?.sideA ?? war?.actors).map(key);
  const sideB = list(war?.sideB ?? war?.opponents).map(key);
  return (sideA.includes(key(a)) && sideB.includes(key(b))) || (sideA.includes(key(b)) && sideB.includes(key(a)));
});

const slug = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const DECLARATION_WORDING = {
  en: (player, target) => ({
    title: `${player} declares war on ${target}`,
    description: `By order of its government, ${player} declares war on ${target}. From today the two are at war.`,
  }),
  fr: (player, target) => ({
    title: `Déclaration de guerre : ${frenchPolityWithArticle(player)} contre ${frenchPolityWithArticle(target)}`,
    description: `Sur ordre de son gouvernement, ${frenchPolityWithArticle(player)} déclare la guerre ${frenchPolityWithArticle(target, "à")}. À partir d'aujourd'hui, les deux pays sont en guerre.`,
  }),
};

// The engine's announcement of the player's war, in `language` (fr or en).
export const declarationEvent = ({ player, target, date = "", language = "en", actionId = "", warId = "" }) => ({
  date,
  ...(DECLARATION_WORDING[language] ?? DECLARATION_WORDING.en)(player, target),
  kind: "military",
  importance: "major",
  notable: true,
  playerRelated: true,
  source: "engine",
  ...(warId ? { warId } : {}),
  impacts: { actionIds: [clean(actionId)].filter(Boolean) },
});

// Test F, 15–22 January: the answer's own war was written "URSS" against
// "Lituanie"; unrecognised, it stood beside the engine's, the ledger found two
// wars for one front and dropped both. Names are read as the map spells them.
const startsBetween = (record, a, b, canon = (name) => name) => clean(record?.op).toLowerCase() === "start"
  && atWarWith([{ sideA: list(record.actors).map(canon), sideB: list(record.opponents).map(canon) }], a, b);

// For each planned order that declares war: the war the engine must start
// ({ action, target, war, event }) or the refusal ({ action, reason }).
// `warUpdates` are this answer's war records (decoded objects), `events` its
// events. When the answer already starts that war but none of the events it is
// tied to announces it, the entry carries `existing` (the answer's record, whose
// id the announcement takes) instead of a new war.
export const planPlayerWars = ({ actions, world, player, warUpdates = [], events = [], date = "", language = "en" }) => {
  const started = [];
  const refused = [];
  const planned = [];
  const announced = [];
  const canon = createPolityNameTranslator(world);
  for (const action of list(actions)) {
    if (clean(action?.status || "planned") !== "planned") continue;
    const text = `${clean(action?.title)} ${clean(action?.text ?? action?.rawInput)}`;
    if (!declaresWar(text)) continue;
    const target = warOrderTarget(text, world, player);
    if (!target) {
      refused.push({ action, reason: "the order declares war but names no polity on this map (or several, with none first): no war was started" });
      continue;
    }
    if (atWarWith(world?.wars, player, target) || planned.some((other) => key(other) === key(target))) continue;
    planned.push(target);
    const existing = list(warUpdates).find((record) => startsBetween(record, player, target, canon)) ?? null;
    if (existing && list(existing.eventIndexes).some((index) => eventDeclaresWar(list(events)[index]))) {
      // Announced by the answer itself: kept, and protected like the engine's own.
      announced.push({ action, target, id: clean(existing.id) });
      continue;
    }
    // Test G with Jev: the answer started the war on one event and told the
    // declaration in another ("Déclaration de guerre de l'Union soviétique contre
    // la Pologne"); the engine then added its own — two declarations. That
    // event becomes the war's announcement, and the engine adds none.
    const declaring = list(events).findIndex((entry) => eventDeclaresWar(entry)
      && mentionedPolities(`${clean(entry?.title)}. ${clean(entry?.description)}`, world).some((name) => key(name) === key(target)));
    if (existing && declaring >= 0) {
      announced.push({ action, target, id: clean(existing.id), index: declaring });
      continue;
    }
    const id = clean(existing?.id) || `war-${slug(player)}-${slug(target)}-${slug(date) || "start"}`;
    // The answer wrote the declaration but no war record (test F, 22–29 January:
    // "Lituanie : Déclaration de guerre soviétique et avancée…", and the engine's
    // announcement beside it): the war is tied to that event, with no second one.
    const own = existing ? -1 : list(events).findIndex((entry) => eventDeclaresWar(entry)
      && mentionedPolities(`${clean(entry?.title)}. ${clean(entry?.description)}`, world).some((name) => key(name) === key(target)));
    if (own >= 0) {
      started.push({
        action,
        target,
        existing: null,
        announcer: own,
        war: { id, op: "start", actors: [player], opponents: [target], eventIndexes: [], eventIds: [], note: `${player} declared war on ${target}` },
        event: null,
      });
      continue;
    }
    started.push({
      action,
      target,
      existing,
      war: existing
        ? { ...existing, actors: [player], opponents: [target], eventIndexes: [], eventIds: [] }
        : { id, op: "start", actors: [player], opponents: [target], eventIndexes: [], eventIds: [], note: `${player} declared war on ${target}` },
      event: declarationEvent({ player, target, date, language, actionId: action?.id, warId: id }),
    });
  }
  return { started, refused, announced };
};

// Puts `event` at `position` in the answer and moves every record that points at
// an event by its number (war, storyline, relation and agreement records, as
// decoded objects) so each still points at the same event.
export const insertEventAt = (candidate, event, position, decoders = {}) => {
  const events = candidate.events;
  const at = Math.max(0, Math.min(Number.isInteger(position) ? position : events.length, events.length));
  events.splice(at, 0, event);
  for (const [field, decode] of Object.entries(decoders)) {
    if (candidate[field] == null || candidate[field] === "") continue;
    candidate[field] = decode(candidate[field]).map((record) => (Array.isArray(record?.eventIndexes)
      ? { ...record, eventIndexes: record.eventIndexes.map((index) => (index >= at ? index + 1 : index)) }
      : record));
  }
  return at;
};
