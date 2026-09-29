// Phase 12 (étape D) — l'éditeur au pinceau : réattribuer des provinces à la
// main, sur la carte mondiale.
//
// Tout ce que la carte sait des états vient du scénario (provinces.v1.json) :
// l'état de chaque province (`states`), le nom des états (`stateInfo`), leur
// propriétaire de départ (`stateOwners`), les capitales (`capitals`). Une
// retouche au pinceau est une liste d'opérations sur ces tables ; le serveur
// les applique avec une sauvegarde, puis refait ce qui en découle (contours des
// états, ravitaillement, zones de mer). Pur ici, pour les tests et le script.
//
// Opérations ({ ... } ; `provinces` : identifiants de provinces, 1 à N) :
//   { op: "newState", id?, name, owner, aliases? }     un état neuf (vide)
//   { op: "assign", provinces, state }                 des provinces changent d'état
//   { op: "rename", state, name, aliases? }            un état change de nom
//   { op: "owner", state, owner }                      un état change de propriétaire de départ
//   { op: "capital", polity, state, province?, city? } la capitale d'un pays

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const slug = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const BRUSH_OPS = Object.freeze(["newState", "assign", "rename", "owner", "capital"]);

// Applique `ops` à une copie du scénario. `provinces` : la liste de la carte
// (provinces.json : { id, name, city, center, population… }). Renvoie
// { scenario, notes, changed: { provinces, states } } ; une opération invalide
// est refusée (note « dropped ») sans arrêter les autres.
export const applyBrushEdits = (input, ops, { provinces = [] } = {}) => {
  const scenario = {
    ...input,
    states: [...list(input?.states)],
    stateInfo: { ...(input?.stateInfo ?? {}) },
    stateOwners: { ...(input?.stateOwners ?? {}) },
    capitals: { ...(input?.capitals ?? {}) },
  };
  const notes = [];
  const say = (kind, text) => notes.push({ kind, text: `brush — ${text}` });
  const changedProvinces = new Set();
  const changedStates = new Set();
  const exists = (state) => Boolean(scenario.stateInfo[state]) || scenario.states.includes(state);
  const byProvince = (id) => provinces[Number(id) - 1] ?? null;
  for (const op of list(ops)) {
    const kind = clean(op?.op);
    if (kind === "newState") {
      const name = clean(op.name);
      const owner = clean(op.owner);
      if (!name || !owner) { say("dropped", "a new state needs a name and an owner."); continue; }
      const id = clean(op.id) || `brush-${slug(name)}`;
      if (exists(id)) { say("dropped", `the state "${id}" already exists.`); continue; }
      scenario.stateInfo[id] = { name, provinces: 0, ...(list(op.aliases).length ? { aliases: list(op.aliases).map(clean).filter(Boolean) } : {}) };
      scenario.stateOwners[id] = owner;
      changedStates.add(id);
      say("adjusted", `new state "${name}" (${id}) for ${owner}.`);
    } else if (kind === "assign") {
      const state = clean(op.state);
      if (!exists(state)) { say("dropped", `no state "${state}" to paint provinces into.`); continue; }
      let moved = 0;
      for (const raw of list(op.provinces)) {
        const id = Number(raw);
        if (!Number.isInteger(id) || id < 1 || id > scenario.states.length) { say("dropped", `no province ${raw}.`); continue; }
        const before = scenario.states[id - 1];
        if (before === state) continue;
        if (!before) { say("dropped", `province ${id} is not land of any state (sea or lake).`); continue; }
        scenario.states[id - 1] = state;
        changedProvinces.add(id);
        changedStates.add(before);
        changedStates.add(state);
        moved += 1;
      }
      if (moved) say("adjusted", `${moved} province(s) painted into ${scenario.stateInfo[state]?.name ?? state}.`);
    } else if (kind === "rename") {
      const state = clean(op.state);
      if (!exists(state) || !clean(op.name)) { say("dropped", `no state "${state}" to rename, or no name.`); continue; }
      scenario.stateInfo[state] = { ...(scenario.stateInfo[state] ?? {}), name: clean(op.name), ...(list(op.aliases).length ? { aliases: list(op.aliases).map(clean).filter(Boolean) } : {}) };
      changedStates.add(state);
      say("adjusted", `state ${state} renamed "${clean(op.name)}".`);
    } else if (kind === "owner") {
      const state = clean(op.state);
      if (!exists(state) || !clean(op.owner)) { say("dropped", `no state "${state}", or no owner.`); continue; }
      scenario.stateOwners[state] = clean(op.owner);
      changedStates.add(state);
      say("adjusted", `state ${scenario.stateInfo[state]?.name ?? state} now starts with ${clean(op.owner)}.`);
    } else if (kind === "capital") {
      const polity = clean(op.polity);
      const state = clean(op.state);
      if (!polity || !exists(state)) { say("dropped", `a capital needs a country and a state.`); continue; }
      if (clean(scenario.stateOwners[state]) !== polity) { say("dropped", `${scenario.stateInfo[state]?.name ?? state} does not belong to ${polity}: no capital there.`); continue; }
      const inState = scenario.states.map((s, k) => (s === state ? k + 1 : 0)).filter(Boolean);
      const province = Number(op.province) && inState.includes(Number(op.province))
        ? Number(op.province)
        : inState.slice().sort((a, b) => (byProvince(b)?.population ?? 0) - (byProvince(a)?.population ?? 0))[0];
      scenario.capitals[polity] = {
        city: clean(op.city) || byProvince(province)?.city || byProvince(province)?.name || scenario.stateInfo[state]?.name || state,
        state, stateName: scenario.stateInfo[state]?.name ?? state, province: province ?? 0,
      };
      say("adjusted", `${polity}'s capital: ${scenario.capitals[polity].city} (${scenario.capitals[polity].stateName}).`);
    } else {
      say("dropped", `"${kind}" is not a brush operation (${BRUSH_OPS.join(", ")}).`);
    }
  }
  // Les comptes de provinces des états touchés ; un état vidé disparaît.
  for (const state of changedStates) {
    const count = scenario.states.filter((s) => s === state).length;
    if (!count) say("adjusted", `state ${scenario.stateInfo[state]?.name ?? state} has no province left.`);
    if (scenario.stateInfo[state]) scenario.stateInfo[state] = { ...scenario.stateInfo[state], provinces: count };
    // Une capitale dont l'état a perdu la province de la ville suit la plus peuplée.
    for (const [polity, capital] of Object.entries(scenario.capitals)) {
      if (capital?.state !== state || !capital.province || scenario.states[capital.province - 1] === state) continue;
      const moved = scenario.states[capital.province - 1];
      if (moved && clean(scenario.stateOwners[moved]) === polity) scenario.capitals[polity] = { ...capital, state: moved, stateName: scenario.stateInfo[moved]?.name ?? moved };
    }
  }
  return { scenario, notes, changed: { provinces: [...changedProvinces], states: [...changedStates] } };
};

// Les provinces d'un état, par nom de province (pour écrire une retouche à la main).
export const provincesNamed = (names, provinces, { state = "", states = [] } = {}) => {
  const wanted = new Set(list(names).map((name) => clean(name).toLowerCase()));
  return provinces.filter((province, index) => wanted.has(clean(province?.name).toLowerCase()) && (!state || states[index] === state)).map((province) => province.id);
};
