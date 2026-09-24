// Couche HOI4 — la recherche (phase 2).
//
// Run tests: node --test src/runtime/hoi/research.test.js
// Import-free apart from gameDates.js: engine.js imports this module, so it must
// not import engine.js back.
//
// Chaque nation a des emplacements de recherche (selon ses usines civiles). Une
// tech coûte un nombre de jours de travail, plus cher si elle est en avance sur
// son époque ; terminée, elle applique ses effets, bornés. Le moteur choisit seul
// la recherche de tous les pays sauf celui du joueur (advanceHoiLayer).
//
// Forme dans chaque nation de world.hoi.nations :
//   research: { done: [techId], slots: [{ techId, progress }], queue: [techId], partial: { techId: progress } }
//   bonuses:  { efficiencyCap: +0.03, costFactor: { chars: 0.9 } }
// progress est en jours de travail ; partial garde l'avancement d'une recherche
// arrêtée, pour qu'elle reprenne où elle en était.
//
// L'arbre lui-même (world.hoi.tech.tree) est validé par techTree.js ; ici on le
// lit tel quel : { techs: [{ id, name, branch, year, days, requires, effects }] }.

import { gameDateYear } from "../gameDates.js";

export const HOI_TECH_BRANCHES = Object.freeze(["infanterie", "artillerie", "blindes", "aviation", "industrie"]);

export const RESEARCH_TUNING = Object.freeze({
  // Emplacements : 1, plus un par seuil d'usines civiles atteint, 4 au plus.
  slotThresholds: Object.freeze([10, 20, 30]),
  maxSlots: 4,
  // Surcoût par année d'avance sur l'époque d'une tech, et son maximum (×3).
  aheadPenaltyPerYear: 0.5,
  aheadPenaltyMax: 2,
  // Plafond d'efficacité gagné par les techs, au total.
  efficiencyBonusMax: 0.09,
  // Une réduction de coût ne descend jamais sous la moitié du coût d'origine.
  costFactorMin: 0.5,
  // Une tech d'extraction sur une ressource que le pays n'extrait pas encore
  // lui en donne value × 10 par mois (0,2 → 2 par mois).
  extractionFromNothing: 10,
  maxQueue: 20,
});

// La branche des équipements de base (presets.js), pour le choix automatique.
export const BASE_EQUIPMENT_BRANCH = Object.freeze({
  fusils: "infanterie",
  mitrailleuses: "infanterie",
  artillerie: "artillerie",
  obus: "artillerie",
  chars: "blindes",
  chasseurs: "aviation",
  bombardiers: "aviation",
  camions: "industrie",
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const text = (value) => String(value ?? "").trim();
const uniqueIds = (list, max = Infinity) => [...new Set((Array.isArray(list) ? list : []).map(text).filter(Boolean))].slice(0, max);

// « Pétrole », « petrole », « PETROLE » : une seule clé. Sert aux ressources,
// aux équipements et aux identifiants de tech (economyOps.js, techTree.js).
export const normalizeResourceKey = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

// ---------------------------------------------------------------------------
// Forme
// ---------------------------------------------------------------------------

export const normalizeBonuses = (value) => {
  const source = isObject(value) ? value : {};
  const costFactor = Object.fromEntries(
    Object.entries(isObject(source.costFactor) ? source.costFactor : {})
      .map(([key, factor]) => [text(key), clamp(num(factor, 1), RESEARCH_TUNING.costFactorMin, 1)])
      .filter(([key, factor]) => key && factor < 1),
  );
  return {
    efficiencyCap: round2(clamp(num(source.efficiencyCap), 0, RESEARCH_TUNING.efficiencyBonusMax)),
    costFactor,
  };
};

export const normalizeResearch = (value) => {
  const source = isObject(value) ? value : {};
  const done = uniqueIds(source.done);
  const doneSet = new Set(done);
  const seen = new Set();
  const slots = (Array.isArray(source.slots) ? source.slots : [])
    .map((slot) => ({ techId: text(slot?.techId), progress: round2(Math.max(0, num(slot?.progress))) }))
    .filter((slot) => slot.techId && !doneSet.has(slot.techId) && !seen.has(slot.techId) && seen.add(slot.techId))
    .slice(0, RESEARCH_TUNING.maxSlots);
  const queue = uniqueIds(source.queue, RESEARCH_TUNING.maxQueue).filter((id) => !doneSet.has(id) && !seen.has(id));
  const partial = Object.fromEntries(
    Object.entries(isObject(source.partial) ? source.partial : {})
      .map(([key, progress]) => [text(key), round2(Math.max(0, num(progress)))])
      .filter(([key, progress]) => key && progress > 0 && !doneSet.has(key)),
  );
  return { done, slots, queue, partial };
};

export const emptyResearchReport = () => ({ researched: [] });

// ---------------------------------------------------------------------------
// Lecture de l'arbre
// ---------------------------------------------------------------------------

const treeIndexCache = new WeakMap();

// id → tech, mis en cache par arbre.
export const indexTechTree = (tree) => {
  if (!isObject(tree) || !Array.isArray(tree.techs)) return new Map();
  const cached = treeIndexCache.get(tree);
  if (cached) return cached;
  const index = new Map(tree.techs.filter((tech) => tech?.id).map((tech) => [tech.id, tech]));
  treeIndexCache.set(tree, index);
  return index;
};

export const researchSlotCount = (nation) => {
  const civilian = num(nation?.factories?.civilian);
  const extra = RESEARCH_TUNING.slotThresholds.filter((threshold) => civilian >= threshold).length;
  return clamp(1 + extra, 1, RESEARCH_TUNING.maxSlots);
};

// Surcoût d'avance : 0 pour une tech de son époque, jusqu'à ×3 pour une tech
// très en avance. Sans date lisible, pas de surcoût.
export const aheadPenalty = (tech, date) => {
  const year = gameDateYear(date);
  if (year === null || !Number.isFinite(Number(tech?.year))) return 0;
  return clamp((Number(tech.year) - year) * RESEARCH_TUNING.aheadPenaltyPerYear, 0, RESEARCH_TUNING.aheadPenaltyMax);
};

export const effectiveTechCost = (tech, date) => Math.max(1, num(tech?.days, 1)) * (1 + aheadPenalty(tech, date));

export const isTechAvailable = (nation, tech) => {
  if (!tech) return false;
  const done = new Set(nation?.research?.done ?? []);
  if (done.has(tech.id)) return false;
  return (tech.requires ?? []).every((id) => done.has(id));
};

// "done" | "active" | "queued" | "available" | "locked"
export const techStatus = (nation, tech) => {
  const research = nation?.research ?? {};
  if ((research.done ?? []).includes(tech.id)) return "done";
  if ((research.slots ?? []).some((slot) => slot.techId === tech.id)) return "active";
  if ((research.queue ?? []).includes(tech.id)) return "queued";
  return isTechAvailable(nation, tech) ? "available" : "locked";
};

// ---------------------------------------------------------------------------
// Effets
// ---------------------------------------------------------------------------

// Les effets d'une tech terminée, bornés. Les techs acquises avant le début de
// la partie n'y passent pas : les valeurs de départ en tiennent déjà compte.
export const applyTechEffects = (nation, tech) => {
  let next = { ...nation, bonuses: normalizeBonuses(nation.bonuses) };
  for (const effect of Array.isArray(tech?.effects) ? tech.effects : []) {
    const value = num(effect?.value);
    if (effect?.type === "efficiency" && value > 0) {
      next.bonuses = {
        ...next.bonuses,
        efficiencyCap: round2(clamp(next.bonuses.efficiencyCap + value, 0, RESEARCH_TUNING.efficiencyBonusMax)),
      };
    } else if (effect?.type === "extraction" && value > 0 && effect.resource) {
      const current = num(next.extraction?.[effect.resource]);
      const gained = current > 0 ? current * (1 + value) : value * RESEARCH_TUNING.extractionFromNothing;
      next = { ...next, extraction: { ...next.extraction, [effect.resource]: round2(gained) } };
    } else if (effect?.type === "cost" && value > 0 && effect.equipment) {
      const factor = num(next.bonuses.costFactor[effect.equipment], 1);
      const newFactor = Math.max(RESEARCH_TUNING.costFactorMin, factor * (1 - value));
      const ratio = newFactor / factor;
      next = {
        ...next,
        bonuses: { ...next.bonuses, costFactor: { ...next.bonuses.costFactor, [effect.equipment]: round2(newFactor) } },
        lines: next.lines.map((line) => (line.equipment === effect.equipment
          ? { ...line, unitCost: Math.max(0.01, round2(line.unitCost * ratio)) }
          : line)),
      };
    }
    // "unlock" : rien à faire ici, la disponibilité se lit dans research.done.
  }
  return next;
};

// ---------------------------------------------------------------------------
// Choix automatique (tous les pays sauf le joueur)
// ---------------------------------------------------------------------------

const techBranchEquipment = (tech) => (tech.effects ?? [])
  .map((effect) => effect?.equipment)
  .filter(Boolean);

// La tech disponible la plus utile : d'abord celles qui touchent ce que le pays
// produit déjà (même branche ou même équipement), puis l'industrie, puis la moins
// chère à cette date. Déterministe : à égalité, l'identifiant tranche.
export const pickAutoTech = (nation, tree, date, exclude = new Set()) => {
  const index = indexTechTree(tree);
  const producing = new Set((nation.lines ?? []).filter((line) => line.factories > 0).map((line) => line.equipment));
  const branches = new Set([...producing].map((equipment) => BASE_EQUIPMENT_BRANCH[equipment]).filter(Boolean));
  const candidates = [...index.values()].filter((tech) => !exclude.has(tech.id) && isTechAvailable(nation, tech));
  if (!candidates.length) return null;
  const score = (tech) => {
    let value = 0;
    if (branches.has(tech.branch)) value += 2;
    if (techBranchEquipment(tech).some((equipment) => producing.has(equipment))) value += 2;
    if (tech.branch === "industrie") value += 1;
    return value;
  };
  candidates.sort((a, b) => score(b) - score(a)
    || effectiveTechCost(a, date) - effectiveTechCost(b, date)
    || a.id.localeCompare(b.id));
  return candidates[0].id;
};

// ---------------------------------------------------------------------------
// Avancement
// ---------------------------------------------------------------------------

// Remplit les emplacements libres : la file d'attente d'abord, puis, pour un pays
// géré par le moteur, le choix automatique.
const fillSlots = (research, nation, tree, date, auto) => {
  const index = indexTechTree(tree);
  const slots = [...research.slots];
  const partial = { ...research.partial };
  const capacity = researchSlotCount(nation);
  const busy = () => new Set(slots.map((slot) => slot.techId));
  const probe = { ...nation, research: { ...research } };
  // Une tech de la file encore verrouillée y reste : elle attend ses prérequis.
  const queue = [];
  for (const id of research.queue) {
    const tech = index.get(id);
    if (!tech || busy().has(id)) continue;
    if (slots.length >= capacity || !isTechAvailable(probe, tech)) {
      queue.push(id);
      continue;
    }
    slots.push({ techId: id, progress: num(partial[id]) });
    delete partial[id];
  }
  while (auto && slots.length < capacity) {
    const id = pickAutoTech(probe, tree, date, busy());
    if (!id) break;
    slots.push({ techId: id, progress: num(partial[id]) });
    delete partial[id];
  }
  return { ...research, slots, queue, partial };
};

// Avance la recherche d'une nation de `days` jours. Pur. Renvoie la nation et les
// noms des techs acquises pendant ces jours.
export const advanceResearch = (inputNation, days, { date = null, tree = null, auto = false } = {}) => {
  const nation = { ...inputNation, research: normalizeResearch(inputNation?.research) };
  const index = indexTechTree(tree);
  if (!index.size || !(days > 0)) return { nation, researched: [] };

  let next = nation;
  let research = fillSlots(nation.research, nation, tree, date, auto);
  const researched = [];
  const done = [...research.done];
  const slots = [];
  for (const slot of research.slots) {
    const tech = index.get(slot.techId);
    if (!tech) continue;
    const progress = slot.progress + days;
    if (progress >= effectiveTechCost(tech, date)) {
      done.push(tech.id);
      researched.push(tech.name || tech.id);
      next = applyTechEffects(next, tech);
    } else {
      slots.push({ techId: tech.id, progress: round2(progress) });
    }
  }
  research = { ...research, done, slots };
  // Un emplacement libéré se remplit tout de suite : il reprendra au saut suivant.
  if (researched.length) research = fillSlots(research, { ...next, research }, tree, date, auto);
  return { nation: { ...next, research: normalizeResearch(research) }, researched };
};

// ---------------------------------------------------------------------------
// Actions du joueur (panneau Recherche). Chacune renvoie { nation, error }.
// ---------------------------------------------------------------------------

export const startResearch = (inputNation, techId, tree) => {
  const nation = { ...inputNation, research: normalizeResearch(inputNation?.research) };
  const tech = indexTechTree(tree).get(techId);
  if (!tech) return { nation, error: "unknown-tech" };
  const status = techStatus(nation, tech);
  if (status === "done" || status === "active") return { nation, error: status };
  if (!isTechAvailable(nation, tech)) return { nation, error: "locked" };
  const { slots, queue, partial } = nation.research;
  if (slots.length >= researchSlotCount(nation)) return { nation, error: "no-free-slot" };
  const { [techId]: resumed = 0, ...restPartial } = partial;
  return {
    nation: {
      ...nation,
      research: {
        ...nation.research,
        slots: [...slots, { techId, progress: resumed }],
        queue: queue.filter((id) => id !== techId),
        partial: restPartial,
      },
    },
    error: null,
  };
};

// Arrêter garde l'avancement : la tech reprendra où elle en était.
export const stopResearch = (inputNation, techId) => {
  const nation = { ...inputNation, research: normalizeResearch(inputNation?.research) };
  const slot = nation.research.slots.find((entry) => entry.techId === techId);
  if (!slot) return { nation, error: "not-active" };
  return {
    nation: {
      ...nation,
      research: {
        ...nation.research,
        slots: nation.research.slots.filter((entry) => entry.techId !== techId),
        partial: slot.progress > 0 ? { ...nation.research.partial, [techId]: slot.progress } : nation.research.partial,
      },
    },
    error: null,
  };
};

export const enqueueResearch = (inputNation, techId, tree) => {
  const nation = { ...inputNation, research: normalizeResearch(inputNation?.research) };
  const tech = indexTechTree(tree).get(techId);
  if (!tech) return { nation, error: "unknown-tech" };
  const status = techStatus(nation, tech);
  if (status === "done" || status === "active" || status === "queued") return { nation, error: status };
  if (nation.research.queue.length >= RESEARCH_TUNING.maxQueue) return { nation, error: "queue-full" };
  // Une tech verrouillée peut attendre dans la file : elle passera quand ses
  // prérequis seront acquis.
  return { nation: { ...nation, research: { ...nation.research, queue: [...nation.research.queue, techId] } }, error: null };
};

export const dequeueResearch = (inputNation, techId) => {
  const nation = { ...inputNation, research: normalizeResearch(inputNation?.research) };
  if (!nation.research.queue.includes(techId)) return { nation, error: "not-queued" };
  return {
    nation: { ...nation, research: { ...nation.research, queue: nation.research.queue.filter((id) => id !== techId) } },
    error: null,
  };
};
