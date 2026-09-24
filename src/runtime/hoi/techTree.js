// Couche HOI4 — l'arbre de recherche d'une partie (phase 2).
//
// Run tests: node --test src/runtime/hoi/techTree.test.js
// Import-free apart from the hoi modules and gameDates.js.
//
// L'IA écrit l'arbre une fois par partie (gameplay.js, generateHoiTechTree) ; le
// moteur ne le croit pas sur parole. normalizeTechTree le ramène dans des bornes
// fixes et dit ce qu'il a corrigé : identifiants uniques, branches connues,
// années proches de l'époque, coûts bornés, prérequis existants et sans boucle,
// effets bornés, ressources de l'époque seulement. Les arbres de secours
// (techTreePresets.js) passent par la même porte.
//
// world.hoi.tech = {
//   tree: { techs: [...], equipment: { id: { label, unitCost, resources, branch, techId } }, source },
//   installedAt: "1936-01-01",
// }

import { gameDateYear } from "../gameDates.js";
import { HOI_EQUIPMENT, findPresetNation } from "./presets.js";
import {
  BASE_EQUIPMENT_BRANCH,
  HOI_TECH_BRANCHES,
  indexTechTree,
  normalizeResearch,
  normalizeResourceKey,
} from "./research.js";
import { HOI_FALLBACK_TECH_TREES } from "./techTreePresets.js";

export const TECH_TREE_LIMITS = Object.freeze({
  maxTechs: 60,
  // En dessous, une réponse de l'IA est jugée inutilisable (arbre de secours).
  minTechs: 12,
  yearsBefore: 25,
  yearsAfter: 15,
  minDays: 30,
  maxDays: 720,
  maxRequires: 3,
  maxEffects: 3,
  efficiency: Object.freeze([0.01, 0.05]),
  extraction: Object.freeze([0.05, 0.3]),
  cost: Object.freeze([0.05, 0.25]),
  unitCost: Object.freeze([0.1, 60]),
  resourceAmount: Object.freeze([0.1, 5]),
  maxResourcesPerEquipment: 3,
  // Les techs acquises d'office à l'installation : jusqu'à la date du jour pour
  // un pays détaillé, quelques années de retard pour les autres.
  neutralLagYears: 3,
});

const EFFECT_ALIASES = Object.freeze({
  unlock: "unlock",
  equipment: "unlock",
  unlock_equipment: "unlock",
  efficiency: "efficiency",
  efficiency_cap: "efficiency",
  extraction: "extraction",
  cost: "cost",
  unit_cost: "cost",
});

const BRANCH_ALIASES = Object.freeze({
  infantry: "infanterie",
  infanterie: "infanterie",
  artillery: "artillerie",
  artillerie: "artillerie",
  armor: "blindes",
  armour: "blindes",
  blindes: "blindes",
  tanks: "blindes",
  air: "aviation",
  aviation: "aviation",
  industry: "industrie",
  industrie: "industrie",
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const num = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Les ressources d'une partie : tout ce qu'une nation stocke, extrait ou consomme.
// Un équipement débloqué ne peut demander que celles-là.
export const collectHoiResources = (hoi) => {
  const found = new Set();
  for (const nation of Object.values(isObject(hoi?.nations) ? hoi.nations : {})) {
    for (const key of Object.keys(nation?.stocks ?? {})) found.add(key);
    for (const key of Object.keys(nation?.extraction ?? {})) found.add(key);
    for (const line of nation?.lines ?? []) for (const key of Object.keys(line?.resources ?? {})) found.add(key);
  }
  return [...found].sort();
};

const normalizeResources = (value, allowed, say, where) => {
  const entries = Array.isArray(value)
    ? value.map((entry) => [entry?.resource, entry?.amount])
    : Object.entries(isObject(value) ? value : {});
  const out = {};
  for (const [rawKey, rawAmount] of entries) {
    const key = normalizeResourceKey(rawKey);
    const amount = num(rawAmount);
    if (!key || !Number.isFinite(amount) || amount <= 0) continue;
    if (allowed && !allowed.has(key)) {
      say(`${where}: resource "${key}" does not exist in this campaign and was removed.`);
      continue;
    }
    if (Object.keys(out).length >= TECH_TREE_LIMITS.maxResourcesPerEquipment) break;
    out[key] = round2(clamp(amount, TECH_TREE_LIMITS.resourceAmount));
  }
  return out;
};

const normalizeEffect = (raw, { allowed, say, where }) => {
  if (!isObject(raw)) return null;
  const type = EFFECT_ALIASES[normalizeResourceKey(raw.type)];
  if (!type) {
    say(`${where}: unknown effect "${text(raw.type)}" removed.`);
    return null;
  }
  const value = num(raw.value);
  if (type === "unlock") {
    const equipment = normalizeResourceKey(raw.equipment ?? raw.equipmentId ?? raw.id);
    if (!equipment) return null;
    if (HOI_EQUIPMENT[equipment]) {
      say(`${where}: "${equipment}" is base equipment and needs no unlock; effect removed.`);
      return null;
    }
    const resources = normalizeResources(raw.resources, allowed, say, where);
    if (!Object.keys(resources).length) {
      say(`${where}: "${equipment}" has no usable resource cost; effect removed.`);
      return null;
    }
    const unitCost = num(raw.unitCost);
    return {
      type,
      equipment,
      label: text(raw.label) || equipment.replace(/_/g, " "),
      unitCost: round2(clamp(Number.isFinite(unitCost) ? unitCost : 5, TECH_TREE_LIMITS.unitCost)),
      resources,
    };
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  if (type === "efficiency") return { type, value: round2(clamp(value, TECH_TREE_LIMITS.efficiency)) };
  if (type === "extraction") {
    const resource = normalizeResourceKey(raw.resource);
    if (!resource || (allowed && !allowed.has(resource))) {
      say(`${where}: extraction of unknown resource "${resource}" removed.`);
      return null;
    }
    return { type, resource, value: round2(clamp(value, TECH_TREE_LIMITS.extraction)) };
  }
  // cost
  const equipment = normalizeResourceKey(raw.equipment);
  if (!equipment) return null;
  return { type, equipment, value: round2(clamp(value, TECH_TREE_LIMITS.cost)) };
};

// Ordre topologique ; les techs prises dans une boucle de prérequis sont écartées.
const topologicalOrder = (techs) => {
  const byId = new Map(techs.map((tech) => [tech.id, tech]));
  const state = new Map();
  const order = [];
  const cyclic = new Set();
  const visit = (id, stack) => {
    if (state.get(id) === "done") return true;
    if (state.get(id) === "visiting") {
      for (const member of stack.slice(stack.indexOf(id))) cyclic.add(member);
      return false;
    }
    state.set(id, "visiting");
    let ok = true;
    for (const req of byId.get(id).requires) {
      if (!visit(req, [...stack, id])) ok = false;
    }
    state.set(id, "done");
    if (ok && !cyclic.has(id)) order.push(byId.get(id));
    return ok && !cyclic.has(id);
  };
  for (const tech of techs) visit(tech.id, []);
  return { order, cyclic };
};

// Valide un arbre venu de l'IA ou d'un arbre de secours. Renvoie l'arbre prêt à
// installer et les corrections faites, en phrases.
export const normalizeTechTree = (raw, { startYear, resources = null, source = "ai" } = {}) => {
  const notes = [];
  const say = (line) => notes.push(line);
  const allowed = resources ? new Set(resources) : null;
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.techs) ? raw.techs : []);
  const baseYear = Number.isFinite(Number(startYear)) ? Number(startYear) : null;

  const techs = [];
  const ids = new Set();
  for (const [position, entry] of list.entries()) {
    if (!isObject(entry)) continue;
    const name = text(entry.name ?? entry.title);
    const id = normalizeResourceKey(entry.id) || normalizeResourceKey(name);
    const where = `tech ${position + 1} "${name || id}"`;
    if (!id || !name) {
      say(`${where}: missing id or name; removed.`);
      continue;
    }
    if (ids.has(id)) {
      say(`${where}: duplicate id "${id}"; removed.`);
      continue;
    }
    const branch = BRANCH_ALIASES[normalizeResourceKey(entry.branch)] ?? "industrie";
    if (!BRANCH_ALIASES[normalizeResourceKey(entry.branch)]) say(`${where}: unknown branch "${text(entry.branch)}", filed under industrie.`);
    let year = Math.round(num(entry.year));
    if (!Number.isFinite(year)) year = baseYear ?? 0;
    if (baseYear !== null) {
      const bounded = clamp(year, [baseYear - TECH_TREE_LIMITS.yearsBefore, baseYear + TECH_TREE_LIMITS.yearsAfter]);
      if (bounded !== year) say(`${where}: year ${year} moved to ${bounded}.`);
      year = bounded;
    }
    const rawDays = num(entry.days ?? entry.cost);
    const days = Math.round(clamp(Number.isFinite(rawDays) ? rawDays : 180, [TECH_TREE_LIMITS.minDays, TECH_TREE_LIMITS.maxDays]));
    const requires = [...new Set((Array.isArray(entry.requires) ? entry.requires : []).map(normalizeResourceKey).filter(Boolean))]
      .filter((req) => req !== id)
      .slice(0, TECH_TREE_LIMITS.maxRequires);
    const effects = (Array.isArray(entry.effects) ? entry.effects : [])
      .map((effect) => normalizeEffect(effect, { allowed, say, where }))
      .filter(Boolean)
      .slice(0, TECH_TREE_LIMITS.maxEffects);
    ids.add(id);
    techs.push({ id, name, branch, year, days, requires, effects });
  }

  // Un équipement ne se débloque qu'une fois ; une baisse de coût doit viser un
  // équipement qui existe (de base ou débloqué par l'arbre).
  const equipment = {};
  for (const tech of techs) {
    tech.effects = tech.effects.filter((effect) => {
      if (effect.type !== "unlock") return true;
      if (equipment[effect.equipment]) {
        say(`tech "${tech.name}": "${effect.equipment}" is already unlocked by another tech; effect removed.`);
        return false;
      }
      equipment[effect.equipment] = {
        label: effect.label,
        unitCost: effect.unitCost,
        resources: effect.resources,
        branch: tech.branch,
        techId: tech.id,
      };
      return true;
    });
  }
  for (const tech of techs) {
    tech.effects = tech.effects.filter((effect) => {
      if (effect.type !== "cost" || HOI_EQUIPMENT[effect.equipment] || equipment[effect.equipment]) return true;
      say(`tech "${tech.name}": cost reduction on unknown equipment "${effect.equipment}" removed.`);
      return false;
    });
  }

  // Prérequis inconnus retirés, boucles écartées.
  for (const tech of techs) {
    const known = tech.requires.filter((req) => ids.has(req));
    if (known.length !== tech.requires.length) say(`tech "${tech.name}": unknown prerequisite(s) removed.`);
    tech.requires = known;
  }
  const { order, cyclic } = topologicalOrder(techs);
  if (cyclic.size) say(`prerequisite loop: ${[...cyclic].join(", ")} removed.`);
  // Une tech dont un prérequis a été écarté n'est plus atteignable : écartée
  // aussi, de proche en proche (l'ordre est topologique).
  const kept = new Set();
  const reachable = order.filter((tech) => {
    if (!tech.requires.every((req) => kept.has(req))) return false;
    kept.add(tech.id);
    return true;
  });
  if (reachable.length > TECH_TREE_LIMITS.maxTechs) say(`${reachable.length} techs; only the first ${TECH_TREE_LIMITS.maxTechs} kept.`);
  const final = reachable.slice(0, TECH_TREE_LIMITS.maxTechs);
  const finalIds = new Set(final.map((tech) => tech.id));
  for (const [id, spec] of Object.entries(equipment)) if (!finalIds.has(spec.techId)) delete equipment[id];

  return { tree: { techs: final, equipment, source }, notes };
};

// L'arbre de secours d'une série (1936, 1912), validé, ou null.
export const fallbackTechTree = (seriesId, { startYear, resources } = {}) => {
  const raw = HOI_FALLBACK_TECH_TREES[seriesId];
  return raw ? normalizeTechTree(raw, { startYear, resources, source: `fallback-${seriesId}` }).tree : null;
};

export const isUsableTechTree = (tree) => Array.isArray(tree?.techs) && tree.techs.length >= TECH_TREE_LIMITS.minTechs;

// ---------------------------------------------------------------------------
// Équipements
// ---------------------------------------------------------------------------

// La fiche d'un équipement : de base (presets.js) ou débloqué par l'arbre.
export const getEquipmentSpec = (hoi, equipment) => {
  const id = normalizeResourceKey(equipment);
  if (HOI_EQUIPMENT[id]) return { ...HOI_EQUIPMENT[id], branch: BASE_EQUIPMENT_BRANCH[id] ?? "industrie", techId: null };
  return hoi?.tech?.tree?.equipment?.[id] ?? null;
};

// Un équipement de base est toujours disponible ; un équipement de l'arbre, une
// fois sa tech acquise par la nation.
export const isEquipmentUnlocked = (hoi, nation, equipment) => {
  const spec = getEquipmentSpec(hoi, equipment);
  if (!spec) return false;
  return !spec.techId || (nation?.research?.done ?? []).includes(spec.techId);
};

export const unlockedEquipment = (hoi, nation) => [
  ...Object.keys(HOI_EQUIPMENT),
  ...Object.keys(hoi?.tech?.tree?.equipment ?? {}).filter((id) => isEquipmentUnlocked(hoi, nation, id)),
];

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

// Pose l'arbre dans world.hoi et donne à chaque nation les techs antérieures à
// `date` (un pays détaillé de la série) ou à `date` moins quelques années (les
// autres). Ces techs sont acquises sans effet chiffré : les valeurs de départ en
// tiennent déjà compte. N'écrase pas une recherche déjà en cours.
export const installTechTree = (hoi, tree, { date } = {}) => {
  if (!isObject(hoi) || !isUsableTechTree(tree)) return hoi;
  const year = gameDateYear(date);
  const index = indexTechTree(tree);
  const nations = {};
  for (const [polity, nation] of Object.entries(hoi.nations ?? {})) {
    const research = normalizeResearch(nation?.research);
    const detailed = Boolean(findPresetNation(hoi.series, polity));
    const limit = year === null ? -Infinity : (detailed ? year : year - TECH_TREE_LIMITS.neutralLagYears);
    const done = new Set(research.done.filter((id) => index.has(id)));
    for (const tech of tree.techs) {
      if (tech.year < limit && tech.requires.every((req) => done.has(req))) done.add(tech.id);
    }
    nations[polity] = { ...nation, research: { ...research, done: [...done] } };
  }
  return { ...hoi, nations, tech: { tree, installedAt: date ? String(date) : null } };
};
