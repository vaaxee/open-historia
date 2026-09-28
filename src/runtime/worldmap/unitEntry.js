/*! Open Historia — where a unit may enter on the world map. */
// The field report (game F, 8–15 January 1936): a "2ème Division Blindée
// Soviétique" was raised next to Kaunas, although the Soviet Union has no border
// with Lithuania. The front rules (warRules.js) already stop a state from being
// taken out of reach; units now follow the same neighbourhood rule. A unit may
// be raised in, or moved into, a state held by someone outside its side only when
//   - that state borders a state its side holds (its own polity and its
//     co-belligerents), or
//   - it comes by sea: a unit at sea landing on a coastal state, or a move from a
//     coastal state its side holds to another coastal state, or
//   - the holder has granted a right of passage (a military access agreement, or
//     an alliance), in force or started in the same answer.
// Anything else is refused, and the story says so (gameplay.js).

import { coBelligerents } from "./warRules.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);

export const PASSAGE_TYPES = Object.freeze(["military_access", "alliance"]);

// Has `holder` let `owner`'s forces through? An agreement in force in the world,
// or one this answer starts (agreementUpdates, text lines or objects).
export const passageGranted = (world, agreementUpdates, owner, holder) => {
  const pair = (parties) => {
    const keys = new Set(list(parties).map(key));
    return keys.has(key(owner)) && keys.has(key(holder));
  };
  const typeOf = (value) => clean(value).toLowerCase().replace(/[ -]+/g, "_");
  if (list(world?.agreements).some((agreement) => clean(agreement?.status || "active") === "active"
    && PASSAGE_TYPES.includes(typeOf(agreement?.type)) && pair(agreement?.parties))) return true;
  const records = typeof agreementUpdates === "string"
    ? agreementUpdates.split(/\r?\n/).map((line) => {
      const [id, op, type, parties] = line.split("~");
      return { id, op, type, parties: String(parties ?? "").split(",") };
    })
    : list(agreementUpdates);
  return records.some((record) => clean(record?.op).toLowerCase() === "start"
    && PASSAGE_TYPES.includes(typeOf(record?.type)) && pair(record?.parties));
};

// Why `owner`'s unit may not enter `regionId`, or "" when it may.
// `from`: { regionId, atSea } — where a moving unit stands; null for a unit raised.
// `map`: { controllerOf, neighboursOf, nameOf, isCoastal }.
export const checkUnitEntry = ({ owner, regionId, from = null, wars = [], map, world = {}, agreementUpdates = [] }) => {
  const target = clean(regionId);
  if (!target || !clean(owner)) return "";
  const holder = clean(map.controllerOf(target));
  if (!holder) return "";
  const side = coBelligerents(wars, owner);
  if (side.has(key(holder))) return "";
  if (list(map.neighboursOf(target)).some((id) => side.has(key(map.controllerOf(id))))) return "";
  if (passageGranted(world, agreementUpdates, owner, holder)) return "";
  if (from && map.isCoastal(target)) {
    if (from.atSea) return "";
    const origin = clean(from.regionId);
    if (origin && side.has(key(map.controllerOf(origin))) && map.isCoastal(origin)) return "";
  }
  const how = from ? "move into" : "be raised in";
  return `${owner}'s unit cannot ${how} ${map.nameOf(target)}, held by ${holder}: no state ${owner} or its allies hold borders it, ${holder} has granted no right of passage, and it cannot be reached by sea`;
};

// Does a region touch the sea? Points just outside its outline (a sample of its
// vertices, a few kilometres out in four directions) that fall in no region at all.
export const touchesSea = (geometry, isLand, { samples = 120, step = 0.08 } = {}) => {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  const ring = polygons.flatMap((polygon) => list(polygon?.[0]));
  if (!ring.length) return false;
  const stride = Math.max(1, Math.floor(ring.length / samples));
  for (let index = 0; index < ring.length; index += stride) {
    const [lng, lat] = ring[index];
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      if (!isLand([lng + dx, lat + dy])) return true;
    }
  }
  return false;
};

const UNIT_ENTRY_WORDING = {
  en: ({ name, place, holder, raised }) => `${name || "The unit"} could not ${raised ? "be raised in" : "enter"} ${place} (${holder}): no border, no right of passage and no way in by sea. ${raised ? "It was not raised." : "It stays where it was."}`,
  fr: ({ name, place, holder, raised }) => `${name ? `« ${name} »` : "L'unité"} n'a pas pu ${raised ? "être levée à" : "entrer à"} ${place} (${holder}) : aucune frontière commune, aucun droit de passage, aucun accès par la mer. ${raised ? "Elle n'a pas été créée." : "Elle reste où elle était."}`,
};

// The sentence the story gains when a unit is refused, in `language` (fr or en).
export const unitEntrySentence = ({ name = "", place = "", holder = "", raised = false }, language = "en") =>
  (UNIT_ENTRY_WORDING[language] ?? UNIT_ENTRY_WORDING.en)({ name: clean(name), place: clean(place), holder: clean(holder), raised });
