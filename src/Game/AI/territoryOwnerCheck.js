// A territorial operation's losing side must hold the land it gives up.
//
// The field report: a model took "Vilnius" from Lithuania — the map gives Vilnius
// to Poland in 1936. Nothing compared the named loser with the real holder: the
// transfer would have taken Poland's land in a story about Lithuania, and for a
// name the map did not know the retry listed the named side's own regions, which
// invited the model to take Kaunas instead. Now the operation is refused, and
// the model is told who really holds the place — never re-aimed in silence,
// never offered another region. The resolver (resolveRegionTransfers in
// gameplay.js) builds these checks over its own indexes.

const clean = (value) => String(value ?? "").trim();

// (transfer, regionId) → the refusal ({ label, fromCode, candidates: [],
// ownerMismatch: { regionId, regionName, actualOwner } }), or null when no loser
// was named, the name is not a power (reported elsewhere), or it does hold it.
export const createOwnerMismatchCheck = ({ canonicalOwnerKey, ownerKeyOf, ownerNameOf, regionNameOf, sentinel = "Unresolved polity" }) => (transfer, regionId) => {
  const fromToken = clean(transfer?.fromCode);
  if (!fromToken || fromToken === sentinel) return null;
  const fromKey = canonicalOwnerKey(fromToken);
  const actualKey = ownerKeyOf(regionId);
  if (!fromKey || !actualKey || fromKey === actualKey) return null;
  const regionName = regionNameOf(regionId) || regionId;
  return {
    label: clean(transfer?.regionName) || clean(transfer?.regionId) || regionName,
    fromCode: fromToken,
    candidates: [],
    ownerMismatch: { regionId, regionName, actualOwner: ownerNameOf(regionId) || actualKey },
  };
};

// label → the one region anywhere on the map that name designates exactly: a
// region or one of its aliases ("Wilno"), or a map city inside a single region.
// No fuzzy or partial matching: this only decides that a name is already taken.
export const createForeignPlaceFinder = ({ byName, catalog, regionKey, matchExact, cities = [], containingRegionIds }) => (label) => {
  const key = regionKey(label);
  if (!key) return "";
  const named = byName.get(key) ?? [];
  if (named.length === 1) return named[0].id;
  if (named.length > 1) return "";
  const exact = matchExact ? matchExact(label, catalog) : null;
  if (exact?.region?.id) return exact.region.id;
  for (const city of cities) {
    if (!(city?.aliases ?? []).some((alias) => regionKey(alias) === key)) continue;
    const hits = containingRegionIds(city, catalog);
    if (hits.length === 1) return hits[0];
  }
  return "";
};

// The retry's line for a refusal: who really holds the place, and the two honest
// ways out. No region list — offering the named side's other regions is how a
// model trying to take Vilnius from Lithuania would end up taking Kaunas.
export const describeOwnerMismatchFeedback = (entry) => {
  const { regionName, actualOwner } = entry.ownerMismatch;
  const target = clean(entry.label) || regionName;
  return `${entry.path}.regionTransfers: "${target}" is ${regionName}, which belongs to ${actualOwner}, not to ${entry.fromCode}. `
    + "The engine will not re-aim this at the real owner for you, and will not take another region instead. "
    + `If the story really takes ${regionName} from ${actualOwner}, write fromCode "${actualOwner}" and make the event say so; `
    + "otherwise remove this transfer and rewrite the event so that no land changed hands.";
};

// The receipt's line (the next turn reads it): the refusal, and that it did NOT happen.
export const describeOwnerMismatchReceipt = (entry, what = "transfer of", where = "") => {
  const { regionName, actualOwner } = entry.ownerMismatch;
  const label = clean(entry.label) || regionName;
  return `${where}the ${what} "${label}" was refused — ${regionName} belongs to ${actualOwner}, not to ${clean(entry.fromCode)}. It did NOT change hands.`;
};
