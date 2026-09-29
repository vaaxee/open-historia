// Phase 8 — ce que montrent les panneaux Focus et Politique, sans React : l'arbre
// du joueur (chaque focus, sa place, son état, ses liens), le focus en cours et
// ses jours restants, et la politique d'un pays. Import-free à part la couche.

import { availableFocuses, focusStatus, focusTreeFor, normalizeFocusState, startFocus } from "../../runtime/hoi/focus.js";
import { IDEOLOGIES, IDEOLOGY_WORDS, enableHoiPolitics, normalizePolitics, POLITICS_TUNING, stabilityProductionModifier, warSupportManpowerFactor } from "../../runtime/hoi/politics.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const nameIn = (map, polity) => Object.keys(map ?? {}).find((name) => key(name) === key(polity)) ?? "";
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const isFrench = (language) => /^fr\b/i.test(String(language || ""));

// La politique d'une partie, même avant le premier tour qui la pose.
const politicsOf = (world) => (world?.hoi?.politics ? world.hoi : enableHoiPolitics(world?.hoi ?? {}, { countryStats: world?.countryStats, date: world?.hoi?.lastDate ?? "" }));

// L'arbre du joueur : { polity, nodes: [{ id, name, days, x, y, status, effects }], links: [[from, to]], current, remaining }.
export const focusPanelModel = (world, player, { language = "en", date = "" } = {}) => {
  const polity = nameIn(world?.hoi?.nations, player);
  if (!polity) return null;
  const hoi = politicsOf(world);
  const state = normalizeFocusState(hoi.focus?.[nameIn(hoi.focus, polity)]);
  const politics = hoi.politics?.[nameIn(hoi.politics, polity)] ?? null;
  const tree = focusTreeFor(polity, state);
  const fr = isFrench(language);
  const nodes = tree.map((focus) => ({
    id: focus.id,
    name: fr ? focus.name.fr : focus.name.en,
    days: focus.days,
    x: Number(focus.x) || 0,
    y: Number(focus.y) || 0,
    status: focusStatus(focus, state, politics),
    effects: list(focus.effects),
    custom: Boolean(focus.custom),
  }));
  const links = tree.flatMap((focus) => [...list(focus.requires), ...list(focus.requiresAny)].map((from) => [from, focus.id]));
  const exclusive = tree.flatMap((focus) => list(focus.excludes).filter((other) => other > focus.id).map((other) => [focus.id, other]));
  const current = state.current ? nodes.find((node) => node.id === state.current.id) ?? null : null;
  const remaining = state.current && date ? Math.max(0, state.current.days - daysBetween(state.current.startDate, date)) : null;
  return { polity, nodes, links, exclusive, current, remaining, completed: state.completed.length };
};

// Le joueur choisit son focus. Renvoie { world, note }.
export const applyPlayerFocus = (world, player, focusId, { date = "" } = {}) => {
  const polity = nameIn(world?.hoi?.nations, player);
  if (!polity) return { world, note: { kind: "dropped", text: "focus — no tracked country." } };
  const hoi = politicsOf(world);
  const focusKey = nameIn(hoi.focus, polity) || polity;
  const result = startFocus(polity, hoi.focus?.[focusKey], focusId, { date, politics: hoi.politics?.[nameIn(hoi.politics, polity)] ?? null });
  if (result.note.kind === "dropped") return { world, note: result.note };
  return { world: { ...world, hoi: { ...hoi, focus: { ...(hoi.focus ?? {}), [focusKey]: result.state } } }, note: result.note };
};

// Le joueur abandonne son focus en cours (le temps passé est perdu).
export const cancelPlayerFocus = (world, player) => {
  const polity = nameIn(world?.hoi?.nations, player);
  const focusKey = nameIn(world?.hoi?.focus, polity);
  if (!focusKey || !world.hoi.focus[focusKey]?.current) return { world, note: { kind: "dropped", text: "focus — nothing to cancel." } };
  return { world: { ...world, hoi: { ...world.hoi, focus: { ...world.hoi.focus, [focusKey]: { ...normalizeFocusState(world.hoi.focus[focusKey]), current: null } } } }, note: { kind: "adjusted", text: "focus — cancelled." } };
};

// La politique d'un pays pour le panneau : régime, partis (du plus fort au plus
// faible), stabilité, soutien, élection, et ce que ces chiffres font au pays.
export const politicsPanelModel = (world, polity, { language = "en" } = {}) => {
  const hoi = politicsOf(world);
  const name = nameIn(hoi.politics, polity);
  if (!name) return null;
  const politics = normalizePolitics(hoi.politics[name]);
  const words = IDEOLOGY_WORDS[isFrench(language) ? "fr" : "en"];
  return {
    polity: name,
    ideology: politics.ideology,
    ideologyName: words[politics.ideology],
    parties: IDEOLOGIES.map((ideology) => ({ ideology, name: words[ideology], share: politics.parties[ideology], ruling: ideology === politics.ideology }))
      .sort((a, b) => b.share - a.share),
    stability: politics.stability,
    warSupport: politics.warSupport,
    nextElection: politics.elections?.next ?? "",
    production: stabilityProductionModifier(politics.stability),
    manpower: warSupportManpowerFactor(politics.warSupport),
    canDeclareWar: politics.warSupport >= POLITICS_TUNING.minWarSupportToDeclare,
    coupRisk: politics.stability < POLITICS_TUNING.coupStability + 10
      && IDEOLOGIES.some((ideology) => ideology !== politics.ideology && politics.parties[ideology] > POLITICS_TUNING.coupPopularity - 10),
    opinions: Object.entries(politics.opinions).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8),
    lastChange: politics.lastChange,
  };
};

// Les focus que le joueur peut prendre, pour le conseiller et le panneau.
export const playerFocusChoices = (world, player) => {
  const polity = nameIn(world?.hoi?.nations, player);
  if (!polity) return [];
  const hoi = politicsOf(world);
  return availableFocuses(polity, hoi.focus?.[nameIn(hoi.focus, polity)], hoi.politics?.[nameIn(hoi.politics, polity)] ?? null);
};

// Le texte d'un effet, pour l'infobulle d'un focus.
export const focusEffectText = (effect, language = "en") => {
  const fr = isFrench(language);
  const sign = (n) => `${n > 0 ? "+" : ""}${n}`;
  switch (effect?.type) {
    case "factories": return [effect.civilian ? `${sign(effect.civilian)} ${fr ? "usine(s) civile(s)" : "civilian factory(ies)"}` : "", effect.military ? `${sign(effect.military)} ${fr ? "usine(s) militaire(s)" : "military factory(ies)"}` : ""].filter(Boolean).join(", ");
    case "production": return `${fr ? "production" : "production"} ${sign(Math.round(effect.value * 100))} % (${effect.days} ${fr ? "j" : "d"})`;
    case "research": return `${fr ? "recherche" : "research"} ${sign(Math.round(effect.value * 100))} ${fr ? "jours" : "days"}`;
    case "divisions": return `${sign(effect.count)} ${effect.template}`;
    case "manpower": return `${sign(effect.amount)} ${fr ? "hommes mobilisables" : "manpower"}`;
    case "stock": return `${sign(effect.amount)} ${effect.resource}`;
    case "stability": return `${fr ? "stabilité" : "stability"} ${sign(effect.delta)}`;
    case "warSupport": return `${fr ? "soutien à la guerre" : "war support"} ${sign(effect.delta)}`;
    case "ideology": return `${IDEOLOGY_WORDS[fr ? "fr" : "en"][effect.ideology] ?? effect.ideology} ${sign(effect.delta)}`;
    case "opinion": return `${fr ? "relations avec" : "opinion of"} ${effect.target} ${sign(effect.delta)}`;
    case "claim": return `${fr ? "revendique" : "claims"} ${list(effect.states).join(", ")}`;
    default: return "";
  }
};
