// A claim is on someone's land: the story must know whose.
//
// The field report (game F, January 1936): the Soviet Union claimed Vilnius and
// the story had Lithuania mobilise against the "annexation" — Vilnius was Polish.
// A claim has no losing side to check, so the check reads the event: when its
// text names a polity that borders the claimed region, as though the region were
// its own, and never names the polity that actually holds it, the claim is
// flagged and the model is told who holds the region. The claim itself stands
// (claiming Poland's Vilnius is a legitimate move); the story must follow it.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Test G après la phase 12 : un pays qui « revendique » sa propre région
// (l'URSS et Kharkiv) ; le narrateur, sans détenteur, l'a dite polonaise.
export const isOwnClaim = ({ holder, claimant }) => Boolean(clean(holder)) && key(holder) === key(claimant);

// "" when the story is consistent with who holds the region, else the problem.
// mentioned: the polities the event's text names (map names); neighbourOwners:
// who holds the states around the claimed region.
export const checkClaimHolder = ({ regionName, holder, claimant, mentioned = [], neighbourOwners = [] }) => {
  if (!holder || key(holder) === key(claimant)) return "";
  const named = new Set(mentioned.map(key));
  if (named.has(key(holder))) return "";
  const around = new Set(neighbourOwners.map(key));
  const confused = mentioned.filter((polity) => key(polity) !== key(claimant) && key(polity) !== key(holder) && around.has(key(polity)));
  if (!confused.length) return "";
  return `${regionName} belongs to ${holder}, not to ${confused.join(" or ")}: ${claimant}'s claim is a claim on ${holder}'s land`;
};

// The retry's line: whose region it is, and the two honest ways out.
export const describeClaimHolderFeedback = ({ path, regionName, holder, claimant, problem }) =>
  `${path}.regionClaims: ${problem}. If the story is about ${holder}'s ${regionName}, make ${holder} the one who reacts; `
  + `if it is about a region ${claimant} disputes with someone else, claim a region that one holds instead.`;

// The receipt's line.
export const describeClaimHolderReceipt = ({ title, problem, regionName, holder }) =>
  `${title ? `Event "${title}": ` : ""}the claim stands, but ${problem}. Later events must treat ${regionName} as ${holder}'s land.`;
