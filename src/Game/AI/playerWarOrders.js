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

import { mentionedPolities } from "../../runtime/polityExonyms.js";

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

// For each planned order that declares war: the war the engine must start
// ({ action, target, war, event }) or the refusal ({ action, reason }).
// `warUpdates` are this answer's war records (decoded objects).
export const planPlayerWars = ({ actions, world, player, warUpdates = [], date = "" }) => {
  const started = [];
  const refused = [];
  const answerWars = list(warUpdates)
    .filter((record) => clean(record?.op).toLowerCase() === "start")
    .map((record) => ({ status: "active", sideA: record.actors, sideB: record.opponents }));
  for (const action of list(actions)) {
    if (clean(action?.status || "planned") !== "planned") continue;
    const text = `${clean(action?.title)} ${clean(action?.text ?? action?.rawInput)}`;
    if (!declaresWar(text)) continue;
    const target = warOrderTarget(text, world, player);
    if (!target) {
      refused.push({ action, reason: "the order declares war but names no polity on this map (or several, with none first): no war was started" });
      continue;
    }
    if (atWarWith(world?.wars, player, target) || atWarWith(answerWars, player, target)) continue;
    const id = `war-${slug(player)}-${slug(target)}-${slug(date) || "start"}`;
    const event = {
      date,
      title: `${player} declares war on ${target}`,
      description: `By order of its government, ${player} declares war on ${target}. From today the two are at war.`,
      kind: "military",
      importance: "major",
      notable: true,
      playerRelated: true,
      source: "engine",
      impacts: { actionIds: [clean(action?.id)].filter(Boolean) },
    };
    started.push({
      action,
      target,
      war: { id, op: "start", actors: [player], opponents: [target], eventIndexes: [], eventIds: [], note: `${player} declared war on ${target}` },
      event,
    });
    answerWars.push({ status: "active", sideA: [player], sideB: [target] });
  }
  return { started, refused };
};
