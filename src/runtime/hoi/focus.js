// Couche HOI4 — les focus nationaux (phase 8).
//
// Run tests: node --test src/runtime/hoi/politics.test.js (focus et politique)
// Import-free à part les modules purs de la couche.
//
// world.hoi.focus[pays] = {
//   current   : { id, startDate, days } | null   le focus en cours
//   completed : [ids]                            ceux qu'il a finis
//   custom    : [focus]                          ceux que l'IA a proposés, validés
// }
// Un focus dure `days` jours ; il faut ses prérequis, aucun de ses exclus ; à sa
// fin, le moteur applique ses effets (usines, recherche, divisions, relations,
// idéologie, revendications). Les pays IA choisissent leur prochain focus par le
// décideur local s'il est là, sinon par l'ordre de leur arbre ; le joueur le
// choisit dans le panneau Focus. L'IA peut proposer un focus « sur mesure »
// (economyOps focus) : le moteur le valide et le borne (parseFocusEffects).

import { FOCUS_TREES, GENERIC_FOCUS_TREE } from "./focusTrees.js";
import { IDEOLOGIES, normalizePolitics, shiftPopularity } from "./politics.js";
import { recruitDivision, templatesFor } from "./armies.js";

export const FOCUS_TUNING = Object.freeze({
  minDays: 14,
  maxDays: 140,
  // Les bornes d'un focus sur mesure, effet par effet.
  customLimits: Object.freeze({ factories: 3, production: 0.15, research: 0.2, divisions: 3, manpower: 200000, stock: 500, stability: 15, warSupport: 15, ideology: 15, opinion: 50, claims: 3 }),
  maxCustomEffects: 4,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const list = (value) => (Array.isArray(value) ? value : []);
const round2 = (value) => Math.round(value * 100) / 100;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(days) * 86400000).toISOString().slice(0, 10);
const slug = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);

export const normalizeFocusState = (value) => {
  const source = isObject(value) ? value : {};
  const current = isObject(source.current) && clean(source.current.id)
    ? { id: clean(source.current.id), startDate: clean(source.current.startDate), days: clamp(Math.round(num(source.current.days, 70)), 1, 365) }
    : null;
  return {
    current,
    completed: [...new Set(list(source.completed).map(clean).filter(Boolean))],
    custom: list(source.custom).filter((entry) => isObject(entry) && clean(entry.id)),
  };
};

// L'arbre d'un pays : le sien, sinon le générique ; plus ses focus sur mesure.
export const focusTreeFor = (polity, state = {}) => {
  const own = Object.entries(FOCUS_TREES).find(([name]) => key(name) === key(polity))?.[1] ?? GENERIC_FOCUS_TREE;
  return [...own, ...normalizeFocusState(state).custom];
};

// Où en est un focus pour ce pays : "done", "current", "available", "locked"
// (prérequis manquants) ou "excluded" (un exclu est fait ou en cours).
export const focusStatus = (focus, state, politics = null) => {
  const s = normalizeFocusState(state);
  if (s.completed.includes(focus.id)) return "done";
  if (s.current?.id === focus.id) return "current";
  const taken = new Set([...s.completed, ...(s.current ? [s.current.id] : [])]);
  if (list(focus.excludes).some((id) => taken.has(id))) return "excluded";
  if (list(focus.requires).some((id) => !s.completed.includes(id))) return "locked";
  if (list(focus.requiresAny).length && !list(focus.requiresAny).some((id) => s.completed.includes(id))) return "locked";
  if (focus.ideology && politics && normalizePolitics(politics).ideology !== focus.ideology) return "locked";
  return "available";
};

export const availableFocuses = (polity, state, politics = null) => focusTreeFor(polity, state).filter((focus) => focusStatus(focus, state, politics) === "available");

// Commencer un focus. Renvoie { state, note }.
export const startFocus = (polity, state, focusId, { date = "", politics = null } = {}) => {
  const s = normalizeFocusState(state);
  const focus = focusTreeFor(polity, s).find((entry) => entry.id === clean(focusId));
  if (!focus) return { state: s, note: { kind: "dropped", text: `focus — ${polity} has no focus "${clean(focusId)}".` } };
  if (s.current) return { state: s, note: { kind: "dropped", text: `focus — ${polity} is already on "${s.current.id}".` } };
  const status = focusStatus(focus, s, politics);
  if (status !== "available") return { state: s, note: { kind: "dropped", text: `focus — ${polity} cannot take "${focus.name.en}" (${status}).` } };
  return { state: { ...s, current: { id: focus.id, startDate: clean(date), days: focus.days } }, note: { kind: "adjusted", text: `focus — ${polity} starts "${focus.name.en}" (${focus.days} days).` } };
};

// Un focus sur mesure proposé par l'IA : « civil+2; stability+5; divisions:infanterie*2;
// claim:Gdańsk; opinion:Poland-20; ideology:fascist+5; research+0.1; production+0.1 ».
// Renvoie { effects, dropped } ; chaque valeur est bornée (FOCUS_TUNING.customLimits).
export const parseFocusEffects = (text) => {
  const L = FOCUS_TUNING.customLimits;
  const effects = [];
  const dropped = [];
  for (const part of clean(text).split(/[;,]/).map((entry) => entry.trim()).filter(Boolean)) {
    let m;
    if ((m = part.match(/^(civil|civilian|military|militaire)\s*([+-]\d+)$/i))) {
      const n = clamp(Number(m[2]), -L.factories, L.factories);
      effects.push({ type: "factories", [/^mil/i.test(m[1]) ? "military" : "civilian"]: n });
    } else if ((m = part.match(/^(stability|stabilite|stabilité|warsupport|war support|soutien)\s*([+-]\d+(?:\.\d+)?)$/i))) {
      const type = /^stab/i.test(m[1]) ? "stability" : "warSupport";
      effects.push({ type, delta: clamp(Number(m[2]), -L[type], L[type]) });
    } else if ((m = part.match(/^(production|research|recherche)\s*([+-]\d+(?:\.\d+)?)$/i))) {
      const type = /^prod/i.test(m[1]) ? "production" : "research";
      effects.push({ type, value: clamp(Number(m[2]), -L[type], L[type]), ...(type === "production" ? { days: 180 } : {}) });
    } else if ((m = part.match(/^divisions?\s*:\s*(\w+)\s*\*\s*(\d+)$/i))) {
      effects.push({ type: "divisions", template: m[1].toLowerCase(), count: clamp(Number(m[2]), 1, L.divisions) });
    } else if ((m = part.match(/^manpower\s*([+-]\d+)$/i))) {
      effects.push({ type: "manpower", amount: clamp(Number(m[1]), -L.manpower, L.manpower) });
    } else if ((m = part.match(/^stock\s*:\s*(\w+)\s*([+-]\d+)$/i))) {
      effects.push({ type: "stock", resource: m[1].toLowerCase(), amount: clamp(Number(m[2]), -L.stock, L.stock) });
    } else if ((m = part.match(/^ideology\s*:\s*(\w+)\s*([+-]\d+)$/i)) && IDEOLOGIES.includes(m[1].toLowerCase())) {
      effects.push({ type: "ideology", ideology: m[1].toLowerCase(), delta: clamp(Number(m[2]), -L.ideology, L.ideology) });
    } else if ((m = part.match(/^opinion\s*:\s*(.+?)\s*([+-]\d+)$/i))) {
      effects.push({ type: "opinion", target: m[1].trim(), delta: clamp(Number(m[2]), -L.opinion, L.opinion) });
    } else if ((m = part.match(/^claims?\s*:\s*(.+)$/i))) {
      effects.push({ type: "claim", states: m[1].split("/").map((name) => name.trim()).filter(Boolean).slice(0, L.claims) });
    } else {
      dropped.push(part);
    }
  }
  return { effects: effects.slice(0, FOCUS_TUNING.maxCustomEffects), dropped: [...dropped, ...effects.slice(FOCUS_TUNING.maxCustomEffects).map((effect) => effect.type)] };
};

// Un focus sur mesure, validé : { focus, note }. Il se range en bout d'arbre.
export const customFocus = (polity, { label = "", days = 70, effects = "" } = {}, state = {}) => {
  const name = clean(label).slice(0, 80);
  const parsed = parseFocusEffects(effects);
  if (!name || !parsed.effects.length) return { focus: null, note: { kind: "dropped", text: `focus — ${polity}: a custom focus needs a name and at least one effect the engine knows (${parsed.dropped.join(", ") || "none given"}).` } };
  const s = normalizeFocusState(state);
  const id = `custom-${slug(polity)}-${slug(name)}`;
  if (focusTreeFor(polity, s).some((entry) => entry.id === id)) return { focus: null, note: { kind: "dropped", text: `focus — ${polity} already has "${name}".` } };
  const tree = focusTreeFor(polity, s);
  const focus = {
    id, name: { fr: name, en: name }, days: clamp(Math.round(num(days, 70)), FOCUS_TUNING.minDays, FOCUS_TUNING.maxDays),
    x: Math.max(0, ...tree.map((entry) => num(entry.x))) + 1, y: s.custom.length, effects: parsed.effects, requires: [], requiresAny: [], excludes: [], custom: true,
  };
  return { focus, note: { kind: parsed.dropped.length ? "adjusted" : "adjusted", text: `focus — ${polity} adds the custom focus "${name}"${parsed.dropped.length ? ` (ignored: ${parsed.dropped.join(", ")})` : ""}.` } };
};

// Les effets d'un focus fini sur le monde. `resolveState(name)` → id d'état.
// Renvoie { world, notes }. Pur.
export const applyFocusEffects = (world, polity, focus, { date = "", resolveState = () => "" } = {}) => {
  const notes = [];
  let hoi = { ...(world?.hoi ?? {}) };
  let regionClaimants = { ...(world?.regionClaimants ?? {}) };
  const nationKey = Object.keys(hoi.nations ?? {}).find((name) => key(name) === key(polity));
  const armyKey = Object.keys(hoi.armies ?? {}).find((name) => key(name) === key(polity));
  const politicsKey = Object.keys(hoi.politics ?? {}).find((name) => key(name) === key(polity));
  const setNation = (change) => { if (nationKey) hoi = { ...hoi, nations: { ...hoi.nations, [nationKey]: change(hoi.nations[nationKey] ?? {}) } }; };
  const setArmy = (change) => { if (armyKey) hoi = { ...hoi, armies: { ...hoi.armies, [armyKey]: change(hoi.armies[armyKey] ?? {}) } }; };
  const setPolitics = (change) => { if (politicsKey) hoi = { ...hoi, politics: { ...hoi.politics, [politicsKey]: change(normalizePolitics(hoi.politics[politicsKey])) } }; };
  const templates = templatesFor(hoi.series);
  for (const effect of list(focus?.effects)) {
    switch (effect?.type) {
      case "factories":
        setNation((nation) => ({ ...nation, factories: {
          civilian: Math.max(0, num(nation.factories?.civilian) + num(effect.civilian)),
          military: Math.max(0, num(nation.factories?.military) + num(effect.military)),
        } }));
        break;
      case "production":
        setNation((nation) => ({ ...nation, modifiers: [...list(nation.modifiers), { id: `focus-${focus.id}`, target: "production", value: num(effect.value), untilDate: addDays(date || "1936-01-01", num(effect.days, 180)), label: focus.name?.en ?? focus.id }] }));
        break;
      case "research":
        setNation((nation) => {
          const research = nation.research ?? {};
          // Les recherches en cours avancent de `value` × 100 jours de travail
          // (research.js compte la progression en jours ; 0,15 → 15 jours).
          const slots = list(research.slots).map((slot) => ({ ...slot, progress: round2(Math.max(0, num(slot.progress) + num(effect.value) * 100)) }));
          return { ...nation, research: { ...research, slots } };
        });
        break;
      case "divisions":
        setArmy((army) => {
          let next = army;
          for (let n = 0; n < clamp(Math.round(num(effect.count, 1)), 1, 10); n += 1) {
            // Un focus lève ses divisions équipées : l'équipement vient avec.
            const spec = templates[effect.template];
            if (!spec) break;
            const stocked = { ...next, stockpile: { ...(next.stockpile ?? {}) }, manpower: { ...(next.manpower ?? {}) } };
            for (const [item, need] of Object.entries(spec.equipment)) stocked.stockpile[item] = num(stocked.stockpile[item]) + need;
            stocked.manpower.available = num(stocked.manpower.available) + spec.men;
            const result = recruitDivision(stocked, { template: effect.template, date, id: `${slug(polity)}-${focus.id}-${n + 1}` }, templates);
            if (!result.division) { notes.push({ kind: "dropped", text: `focus — ${polity}: ${result.reason}` }); break; }
            next = { ...result.army, divisions: result.army.divisions.map((division) => (division.id === result.division.id ? { ...division, organisation: 60 } : division)) };
          }
          return next;
        });
        break;
      case "manpower":
        setArmy((army) => ({ ...army, manpower: { ...(army.manpower ?? {}), available: Math.max(0, num(army.manpower?.available) + num(effect.amount)) } }));
        break;
      case "stock":
        setNation((nation) => ({ ...nation, stocks: { ...(nation.stocks ?? {}), [effect.resource]: Math.max(0, num(nation.stocks?.[effect.resource]) + num(effect.amount)) } }));
        break;
      case "stability":
      case "warSupport":
        setPolitics((politics) => ({ ...politics, [effect.type]: clamp(politics[effect.type] + num(effect.delta), 0, 100) }));
        break;
      case "ideology":
        setPolitics((politics) => ({ ...politics, parties: shiftPopularity(politics.parties, effect.ideology, num(effect.delta)) }));
        break;
      case "opinion":
        setPolitics((politics) => ({ ...politics, opinions: { ...politics.opinions, [effect.target]: clamp(num(politics.opinions[effect.target]) + num(effect.delta), -100, 100) } }));
        break;
      case "claim":
        for (const name of list(effect.states)) {
          const id = clean(resolveState(name));
          if (!id) { notes.push({ kind: "dropped", text: `focus — ${polity}: no state "${name}" to claim on this map.` }); continue; }
          const claimants = list(regionClaimants[id]);
          if (!claimants.some((entry) => key(entry) === key(polity))) regionClaimants = { ...regionClaimants, [id]: [...claimants, polity] };
        }
        break;
      default:
        notes.push({ kind: "dropped", text: `focus — unknown effect "${effect?.type}".` });
    }
  }
  return { world: { ...world, hoi, regionClaimants }, notes };
};

// Les focus d'un saut, pour tous les pays : ceux qui finissent dans la période
// (leur date de fin), puis le choix du suivant pour les pays IA (`choose(polity,
// available)` → id, par défaut le premier de l'arbre). Renvoie { focus: nouvel
// état de tous les pays, completed: [{ polity, focus, date }] }. Pur ; les
// effets s'appliquent à part (applyFocusEffects).
export const advanceFocuses = (hoi, { toDate, player = "", choose = null } = {}) => {
  const out = { ...(isObject(hoi?.focus) ? hoi.focus : {}) };
  const completed = [];
  for (const polity of Object.keys(hoi?.nations ?? {})) {
    let state = normalizeFocusState(out[polity]);
    const politics = hoi?.politics?.[polity] ?? null;
    if (state.current) {
      const end = addDays(state.current.startDate || toDate, state.current.days);
      if (end <= toDate) {
        const focus = focusTreeFor(polity, state).find((entry) => entry.id === state.current.id);
        if (focus) completed.push({ polity, focus, date: end });
        state = { ...state, completed: [...state.completed, state.current.id], current: null };
      }
    }
    if (!state.current && (!player || key(polity) !== key(player))) {
      const available = availableFocuses(polity, state, politics);
      const picked = (typeof choose === "function" ? choose(polity, available) : null) ?? available[0]?.id;
      if (picked) state = startFocus(polity, state, picked, { date: toDate, politics }).state;
    }
    out[polity] = state;
  }
  return { focus: out, completed };
};

// Le programme d'un pays, pour la fiche de Jev et l'IA : son régime, son focus
// en cours, ses deux derniers finis.
export const programmeFor = (polity, hoi) => {
  const politics = hoi?.politics?.[Object.keys(hoi?.politics ?? {}).find((name) => key(name) === key(polity))];
  const state = normalizeFocusState(hoi?.focus?.[Object.keys(hoi?.focus ?? {}).find((name) => key(name) === key(polity))]);
  const tree = focusTreeFor(polity, state);
  const nameOf = (id) => tree.find((entry) => entry.id === id)?.name?.en ?? id;
  const parts = [];
  if (politics) parts.push(`${normalizePolitics(politics).ideology} government`);
  if (state.current) parts.push(`working on "${nameOf(state.current.id)}"`);
  const recent = state.completed.slice(-2).map(nameOf);
  if (recent.length) parts.push(`has done ${recent.map((name) => `"${name}"`).join(" and ")}`);
  return parts.join("; ");
};
