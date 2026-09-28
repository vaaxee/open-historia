// Carte mondiale unique (phase 6, étape 2) — la guerre, état par état.
//
// On the world map a war is no longer whatever the story says. The engine holds
// four rules, and the model is told them:
//   1. Declared war. Taking control of a state by force (regionControlOps
//      control or contest) needs an ACTIVE war, in world.wars or started in the
//      same answer, with the attacker and the state's controller on opposite sides.
//   2. Occupation state by state. The target touches a state the attacker or one
//      of its co-belligerents already controls (state adjacency), or one of their
//      units stands in it or next to it; and a front moves at most
//      OCCUPATIONS_PER_WEEK states a week for each attacker/defender pair.
//      Occupation changes the controller only: the legal sovereign stays, and the
//      map hatches the state in the sovereign's colour.
//   3. Capitulation by the engine. A polity at war whose capital is occupied by
//      an enemy, and that has lost at least CAPITULATION_SHARE of its states,
//      capitulates: the engine writes the event, takes it out of its wars and
//      records it (world.capitulations). The story may not declare one itself.
//   4. Sovereignty by treaty or after capitulation. A legal transfer
//      (regionTransfers) needs the loser's consent — a treaty between the two
//      (an agreement of type peace_settlement or other, active or started in the
//      same answer), or the player giving up its own land by its own order — or
//      the loser's capitulation, for a state the winning side controls.
// Pure functions: the time skip (validateGeneratedWorldChanges) and the turn's
// application (applySimulationResult) in AI/gameplay.js call them.

export const OCCUPATIONS_PER_WEEK = 3;
export const CAPITULATION_SHARE = 1 / 3;
export const TREATY_TYPES = Object.freeze(["peace_settlement", "other"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);

// The wars as the rules read them: world.wars plus the wars this answer starts.
// warUpdates may be text lines ("id~op~actors~opponents~events~note") or objects.
export const warsFor = (world, warUpdates = []) => {
  const wars = list(world?.wars).map((war) => ({
    id: clean(war?.id),
    status: clean(war?.status) || "active",
    sideA: list(war?.sideA).map(clean).filter(Boolean),
    sideB: list(war?.sideB).map(clean).filter(Boolean),
  }));
  const records = typeof warUpdates === "string"
    ? warUpdates.split(/\r?\n/).map((line) => {
      const [id, op, actors, opponents] = line.split("~");
      return { id, op, actors: String(actors ?? "").split(","), opponents: String(opponents ?? "").split(",") };
    })
    : list(warUpdates);
  for (const record of records) {
    const op = clean(record?.op).toLowerCase();
    const actors = list(record?.actors).map(clean).filter(Boolean);
    const opponents = list(record?.opponents).map(clean).filter(Boolean);
    const existing = wars.find((war) => war.id && war.id === clean(record?.id));
    if (op === "start" && actors.length && opponents.length && !existing) {
      wars.push({ id: clean(record?.id), status: "active", sideA: actors, sideB: opponents });
    } else if (existing && op === "join-a") existing.sideA.push(...actors);
    else if (existing && op === "join-b") existing.sideB.push(...actors);
    else if (existing && op === "resume") existing.status = "active";
  }
  return wars;
};

const sideOf = (war, polity) => {
  const k = key(polity);
  if (war.sideA.some((name) => key(name) === k)) return "A";
  if (war.sideB.some((name) => key(name) === k)) return "B";
  return "";
};

// Are a and b fighting each other in an active war?
export const atWar = (wars, a, b) => list(wars).some((war) => {
  if (war.status !== "active") return false;
  const sa = sideOf(war, a); const sb = sideOf(war, b);
  return Boolean(sa && sb && sa !== sb);
});

// a and everyone fighting on a's side in an active war.
export const coBelligerents = (wars, a) => {
  const out = new Set([key(a)]);
  for (const war of list(wars)) {
    if (war.status !== "active") continue;
    const side = sideOf(war, a);
    if (!side) continue;
    for (const name of side === "A" ? war.sideA : war.sideB) out.add(key(name));
  }
  return out;
};

// Everyone at war with a (active wars).
export const enemiesOf = (wars, a) => {
  const out = new Set();
  for (const war of list(wars)) {
    if (war.status !== "active") continue;
    const side = sideOf(war, a);
    if (!side) continue;
    for (const name of side === "A" ? war.sideB : war.sideA) out.add(clean(name));
  }
  return [...out];
};

// The key a front's count is kept under (attacker → defender), for the rule and
// for whoever counts what an answer took.
export const frontKey = (attacker, defender) => `${key(attacker)}>${key(defender)}`;

// How many states a front may take in a period: OCCUPATIONS_PER_WEEK a week, at least one.
export const occupationAllowance = (spanDays) => Math.max(1, Math.ceil((OCCUPATIONS_PER_WEEK * Math.max(1, Number(spanDays) || 7)) / 7));

// One control operation against the rules. `map` gives the state's controller,
// its neighbours and who has units where; `taken` counts what this answer already
// took per attacker→defender pair. Returns "" when allowed, else the reason.
export const checkControlOperation = ({ op, wars, map, taken, allowance }) => {
  const kind = clean(op?.op).toLowerCase();
  if (kind !== "control" && kind !== "contest") return "";
  const stateId = clean(op?.regionId);
  const attacker = clean(kind === "control" ? op?.toCode : op?.actorCode);
  const defender = map.controllerOf(stateId);
  if (!stateId || !attacker || !defender || key(attacker) === key(defender)) return "";
  if (!atWar(wars, attacker, defender)) {
    return `${attacker} is not at war with ${defender}: declare the war first (warUpdates start) — no state is taken by force in peacetime`;
  }
  const side = coBelligerents(wars, attacker);
  const neighbours = list(map.neighboursOf(stateId));
  const touches = neighbours.some((id) => side.has(key(map.controllerOf(id))));
  const troops = [stateId, ...neighbours].some((id) => list(map.unitOwnersIn(id)).some((owner) => side.has(key(owner))));
  if (!touches && !troops) {
    return `${map.nameOf(stateId)} does not border any state ${attacker} or its allies hold, and none of their units stands in or next to it: the front advances state by state`;
  }
  if (kind === "control") {
    if ((taken.get(frontKey(attacker, defender)) ?? 0) >= allowance) {
      return `the front between ${attacker} and ${defender} has already moved ${allowance} state${allowance === 1 ? "" : "s"} this period`;
    }
  }
  return "";
};

// The agreements that count as a treaty between a and b: active in the world,
// or started in this answer (agreementUpdates, text lines or objects).
export const treatyBetween = (world, agreementUpdates, a, b) => {
  const pair = (parties) => {
    const keys = new Set(list(parties).map(key));
    return keys.has(key(a)) && keys.has(key(b));
  };
  const known = list(world?.agreements).some((agreement) =>
    clean(agreement?.status || "active") === "active" && TREATY_TYPES.includes(clean(agreement?.type)) && pair(agreement?.parties));
  if (known) return true;
  const records = typeof agreementUpdates === "string"
    ? agreementUpdates.split(/\r?\n/).map((line) => {
      const [id, op, type, parties] = line.split("~");
      return { id, op, type, parties: String(parties ?? "").split(",") };
    })
    : list(agreementUpdates);
  return records.some((record) => clean(record?.op).toLowerCase() === "start"
    && TREATY_TYPES.includes(clean(record?.type).toLowerCase().replace(/[ -]+/g, "_")) && pair(record?.parties));
};

// Has `polity` capitulated, and is `receiver` on the winning side?
export const capitulatedTo = (world, polity, receiver) => list(world?.capitulations).some((entry) =>
  key(entry?.polity) === key(polity) && list(entry?.victors).some((victor) => key(victor) === key(receiver)));

// One legal transfer against the rules. Returns "" when allowed, else the reason.
export const checkLegalTransfer = ({ transfer, world, agreementUpdates, map, playerPolity = "", playerOrdered = false }) => {
  const stateId = clean(transfer?.regionId);
  const receiver = clean(transfer?.toCode);
  const loser = map.sovereignOf(stateId) || clean(transfer?.fromCode);
  if (!stateId || !receiver || !loser || key(loser) === key(receiver)) return "";
  if (playerOrdered && playerPolity && key(loser) === key(playerPolity)) return "";
  if (treatyBetween(world, agreementUpdates, loser, receiver)) return "";
  if (capitulatedTo(world, loser, receiver)) {
    const holder = map.controllerOf(stateId);
    const winners = new Set(list(world?.capitulations).filter((entry) => key(entry?.polity) === key(loser)).flatMap((entry) => list(entry?.victors)).map(key));
    if (winners.has(key(holder))) return "";
    return `${loser} has capitulated, but ${map.nameOf(stateId)} is not held by the winning side: occupy it first, or settle it by treaty`;
  }
  return `${loser} has not agreed to give up ${map.nameOf(stateId)} (no treaty between ${loser} and ${receiver}) and has not capitulated: sovereignty changes only by treaty or after a capitulation — take it by occupation (regionControlOps) in a declared war instead`;
};

// The polities that capitulate on this world. `capitals` is the scenario's
// { polity: { state, city } }; `map` gives each state's controller and sovereign
// and the list of states. Only polities at war, whose capital an enemy holds and
// who lost at least CAPITULATION_SHARE of their states (or all of them).
export const findCapitulations = ({ world, capitals, map }) => {
  const wars = warsFor(world);
  const already = new Set(list(world?.capitulations).map((entry) => key(entry?.polity)));
  const out = [];
  const belligerents = new Set(wars.filter((war) => war.status === "active").flatMap((war) => [...war.sideA, ...war.sideB]));
  for (const polity of belligerents) {
    if (already.has(key(polity))) continue;
    const enemies = enemiesOf(wars, polity);
    if (!enemies.length) continue;
    const enemyKeys = new Set(enemies.map(key));
    const states = map.states().filter((id) => key(map.sovereignOf(id)) === key(polity));
    if (!states.length) continue;
    const occupied = states.filter((id) => enemyKeys.has(key(map.controllerOf(id))));
    const capital = capitals?.[polity] ?? Object.entries(capitals ?? {}).find(([name]) => key(name) === key(polity))?.[1];
    const capitalTaken = Boolean(capital?.state) && enemyKeys.has(key(map.controllerOf(capital.state)));
    const share = occupied.length / states.length;
    if (!(occupied.length === states.length || (capitalTaken && share >= CAPITULATION_SHARE))) continue;
    const holders = [...new Set(occupied.map((id) => clean(map.controllerOf(id))))];
    out.push({
      polity,
      capital: capital?.city ?? "",
      capitalState: capital?.state ?? "",
      capitalHolder: capital?.state ? clean(map.controllerOf(capital.state)) : "",
      occupied: occupied.length,
      total: states.length,
      victors: enemies,
      occupiers: holders,
      warIds: wars.filter((war) => war.status === "active" && sideOf(war, polity)).map((war) => war.id),
    });
  }
  return out;
};

const CAPITULATION_WORDING = {
  en: (c) => ({
    title: `${c.polity} capitulates`,
    description: `With ${c.capital || "its capital"} in the hands of ${c.capitalHolder || c.occupiers.join(", ")} and ${c.occupied} of its ${c.total} states occupied, the government of ${c.polity} capitulates. It leaves the war; ${c.victors.join(", ")} may now settle the fate of the occupied territory.`,
  }),
  fr: (c) => ({
    title: `${c.polity} capitule`,
    description: `${c.capital || "Sa capitale"} aux mains de ${c.capitalHolder || c.occupiers.join(", ")} et ${c.occupied} de ses ${c.total} états occupés, le gouvernement de ${c.polity} capitule. Il sort de la guerre ; ${c.victors.join(", ")} peuvent désormais régler le sort des territoires occupés.`,
  }),
};

// The engine's event for a capitulation, dated `date`, in `language` (fr or en).
export const capitulationEvent = (capitulation, { date = "", language = "en", id = "" } = {}) => {
  const words = (CAPITULATION_WORDING[language] ?? CAPITULATION_WORDING.en)(capitulation);
  return {
    ...(id ? { id } : {}),
    date,
    title: words.title,
    description: words.description,
    kind: "military",
    importance: "major",
    notable: true,
    source: "engine",
    impacts: {},
  };
};

// The capitulation recorded on the world: world.capitulations gains it, and the
// polity leaves each of its active wars (warUpdates for applyWarUpdates).
export const capitulationRecord = (capitulation, { date = "", eventId = "" } = {}) => ({
  record: {
    polity: capitulation.polity,
    date,
    victors: capitulation.victors,
    occupiers: capitulation.occupiers,
    capital: capitulation.capital,
    warIds: capitulation.warIds,
    ...(eventId ? { eventId } : {}),
  },
  warUpdates: capitulation.warIds.map((id) => ({
    id,
    op: "leave",
    actors: [capitulation.polity],
    opponents: [],
    eventIndexes: [],
    eventIds: eventId ? [eventId] : [],
    note: `${capitulation.polity} capitulated`,
  })),
});

// The rules as the model reads them, with the capitulations on record.
export const describeWarRules = (world) => {
  const lines = [
    "- A state is taken by force (regionControlOps control or contest) only in a DECLARED, active war between the attacker and the state's controller: start the war first with warUpdates.",
    `- Occupation moves state by state: the target must border a state the attacker or its co-belligerents hold, or have one of their units in or next to it; a front takes at most ${OCCUPATIONS_PER_WEEK} states a week. Occupation changes the controller, never the legal owner.`,
    "- Capitulation is declared by the ENGINE, never by the story: a polity whose capital an enemy holds and that has lost a third of its states capitulates on its own. Do not write a surrender or capitulation.",
    "- Legal sovereignty (regionTransfers) changes only by a treaty between the two (agreementUpdates start of type peace_settlement or other, both as parties), or after the loser's capitulation for a state the winning side holds.",
  ];
  const capitulations = list(world?.capitulations);
  if (capitulations.length) {
    lines.push("Capitulated (these may now cede territory to the winners):");
    for (const entry of capitulations) lines.push(`- ${clean(entry?.polity)} capitulated on ${clean(entry?.date) || "?"} to ${list(entry?.victors).join(", ")}`);
  }
  return lines.join("\n");
};
