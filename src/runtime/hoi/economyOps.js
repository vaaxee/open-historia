// Couche HOI4 — les opérations économiques que l'IA peut demander (phase 1).
//
// Run tests: node --test src/runtime/hoi/economyOps.test.js
// Import-free apart from gameDates.js and the hoi modules, so it runs without
// node_modules.
//
// Un événement du tour peut porter impacts.economyOps : une grève, un contrat, un
// sabotage, une saisie, une réaffectation d'usines. L'IA raconte, le moteur compte :
// une opération ne fait jamais qu'AJUSTER world.hoi dans des bornes fixes, et tout
// ce qui est ramené dans ces bornes ou refusé est dit dans le reçu d'application
// (runtime/applicationReceipt.js), pour que le tour suivant sache ce qui a compté.
//
// Trois opérations, sur n'importe quelle nation suivie par la couche :
//   { op: "modifier", polity, value, days, label }   production ±, pour une durée
//   { op: "stock", polity, resource, amount }        don, saisie, commerce ponctuel
//   { op: "line", polity, equipment|lineId, factories } réaffecter des usines
//
// Appliquées dans applySimulationResult (gameplay.js) AVANT advanceHoiLayer, pour
// qu'une grève racontée ce tour pèse déjà sur la production de ce tour.

import { addGameDays, isGameDate } from "../gameDates.js";
import { HOI_TUNING, findNationKey, normalizeLine, normalizeNation } from "./engine.js";
import { HOI_EQUIPMENT } from "./presets.js";

// Réglages des garde-fous : un seul endroit à modifier, comme HOI_TUNING.
export const ECONOMY_OP_LIMITS = Object.freeze({
  // Durée d'un modificateur, en jours.
  defaultDays: 30,
  minDays: 1,
  maxDays: 365,
  // Nombre de modificateurs actifs par nation.
  maxModifiersPerNation: 8,
  // Un mouvement de stock est borné par le plus grand de ces trois montants.
  stockShareOfReserve: 0.25,
  stockMonthsOfExtraction: 1,
  stockFloor: 5,
});

export const ECONOMY_OP_KINDS = Object.freeze(["modifier", "stock", "line"]);

const OP_ALIASES = Object.freeze({
  modifier: "modifier",
  mod: "modifier",
  production: "modifier",
  strike: "modifier",
  bonus: "modifier",
  stock: "stock",
  stocks: "stock",
  stockdelta: "stock",
  resource: "stock",
  line: "line",
  linechange: "line",
  productionline: "line",
  factories: "line",
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const finite = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const pct = (value) => `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;

// « Pétrole », « petrole », « PETROLE » : une seule ressource.
export const normalizeResourceKey = (value) => text(value)
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const slug = (value) => normalizeResourceKey(value).replace(/_/g, "-").slice(0, 40);

// Forme seule, sans connaître le monde : ce que gameState.js garde sur l'événement
// stocké. Une entrée à laquelle il manque l'essentiel renvoie null, et le reçu dit
// combien ont été perdues (noteMalformedImpacts).
export const normalizeEconomyOp = (entry) => {
  if (!isObject(entry)) return null;
  const op = OP_ALIASES[normalizeResourceKey(entry.op ?? entry.type ?? entry.kind).replace(/_/g, "")];
  const polity = text(entry.polity ?? entry.polityCode ?? entry.ownerCode ?? entry.country ?? entry.target);
  if (!op || !polity) return null;
  const reason = text(entry.reason ?? entry.note);
  const base = { op, polity, ...(reason ? { reason } : {}) };

  if (op === "modifier") {
    const value = finite(entry.value ?? entry.modifier ?? entry.amount);
    if (!Number.isFinite(value) || value === 0) return null;
    const days = finite(entry.days ?? entry.durationDays);
    const label = text(entry.label ?? entry.name);
    const id = text(entry.id);
    return {
      ...base,
      value,
      ...(Number.isFinite(days) ? { days } : {}),
      ...(label ? { label } : {}),
      ...(id ? { id } : {}),
    };
  }

  if (op === "stock") {
    const resource = normalizeResourceKey(entry.resource);
    const amount = finite(entry.amount ?? entry.delta ?? entry.value);
    if (!resource || !Number.isFinite(amount) || amount === 0) return null;
    return { ...base, resource, amount };
  }

  // op === "line"
  const lineId = text(entry.lineId ?? entry.id);
  const equipment = normalizeResourceKey(entry.equipment);
  const factories = finite(entry.factories);
  if ((!lineId && !equipment) || !Number.isFinite(factories) || factories < 0) return null;
  return {
    ...base,
    ...(lineId ? { lineId } : {}),
    ...(equipment ? { equipment } : {}),
    factories: Math.floor(factories),
  };
};

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const applyModifier = (nation, op, { date, say }) => {
  const L = ECONOMY_OP_LIMITS;
  const value = clamp(op.value, HOI_TUNING.modifierMin, HOI_TUNING.modifierMax);
  if (value !== op.value) {
    say("adjusted", `production modifier ${pct(op.value)} on ${op.polity} was capped to ${pct(value)}.`);
  }
  const wantedDays = Number.isFinite(op.days) ? Math.round(op.days) : L.defaultDays;
  const days = clamp(wantedDays, L.minDays, L.maxDays);
  if (Number.isFinite(op.days) && days !== wantedDays) {
    say("adjusted", `a modifier on ${op.polity} asked for ${wantedDays} days; it lasts ${days}.`);
  }
  // Une source = un modificateur : la même grève racontée deux fois se remplace,
  // elle ne s'additionne pas.
  const id = op.id || `ia-${slug(op.label || op.reason || "modificateur") || "modificateur"}`;
  const others = nation.modifiers.filter((modifier) => modifier.id !== id);
  if (others.length >= L.maxModifiersPerNation) {
    say("dropped", `${op.polity} already has ${others.length} active modifiers; "${op.label || id}" was not added.`);
    return nation;
  }
  // Sans date de fin calculable, le modificateur serait permanent : refusé.
  const untilDate = addGameDays(date, days);
  if (!untilDate) {
    say("dropped", `"${op.label || id}" on ${op.polity} was ignored: no valid date to time it from.`);
    return nation;
  }
  return {
    ...nation,
    modifiers: [...others, { id, target: "production", value, untilDate, label: op.label || op.reason || "" }],
  };
};

const applyStock = (nation, op, { say }) => {
  const L = ECONOMY_OP_LIMITS;
  const current = Number(nation.stocks[op.resource] ?? 0);
  const perMonth = Number(nation.extraction[op.resource] ?? 0);
  if (op.amount < 0 && current <= 0) {
    say("dropped", `${op.polity} holds no ${op.resource}; nothing could be taken.`);
    return nation;
  }
  const bound = Math.max(current * L.stockShareOfReserve, perMonth * L.stockMonthsOfExtraction, L.stockFloor);
  const amount = clamp(op.amount, -bound, bound);
  if (amount !== op.amount) {
    say("adjusted", `${op.resource} ${op.amount > 0 ? "+" : ""}${op.amount} for ${op.polity} was capped to ${round2(amount)} (at most a quarter of the reserve or a month of extraction).`);
  }
  return { ...nation, stocks: { ...nation.stocks, [op.resource]: round2(Math.max(0, current + amount)) } };
};

const applyLine = (nation, op, { say }) => {
  const lines = [...nation.lines];
  let index = op.lineId ? lines.findIndex((entry) => entry.id === op.lineId) : -1;
  if (index < 0 && op.equipment) index = lines.findIndex((entry) => normalizeResourceKey(entry.equipment) === op.equipment);

  if (index < 0) {
    const spec = HOI_EQUIPMENT[op.equipment];
    if (!spec) {
      const known = Object.keys(HOI_EQUIPMENT).join(", ");
      say("dropped", `${op.polity} has no production line "${op.lineId || op.equipment}", and a new line needs one of: ${known}.`);
      return nation;
    }
    lines.push(normalizeLine({
      id: op.equipment,
      equipment: op.equipment,
      factories: 0,
      efficiency: HOI_TUNING.efficiencyFloor,
      unitCost: spec.unitCost,
      resources: { ...spec.resources },
    }, lines.length));
    index = lines.length - 1;
  }

  const target = lines[index];
  const usedElsewhere = lines.reduce((sum, entry, i) => (i === index ? sum : sum + entry.factories), 0);
  const available = Math.max(0, nation.factories.military - usedElsewhere);
  const factories = Math.min(op.factories, available);
  if (factories !== op.factories) {
    say("adjusted", `${op.polity} can put only ${factories} military factories on ${target.equipment} (${nation.factories.military} in all, ${usedElsewhere} on other lines).`);
  }
  // Des usines qui arrivent sur une ligne repartent de l'efficacité plancher :
  // la moyenne pondérée fait baisser la ligne au prorata, comme un rééquipement.
  const added = Math.max(0, factories - target.factories);
  const efficiency = factories > 0
    ? (target.efficiency * (factories - added) + HOI_TUNING.efficiencyFloor * added) / factories
    : target.efficiency;
  lines[index] = { ...target, factories, efficiency: round2(clamp(efficiency, HOI_TUNING.efficiencyFloor, HOI_TUNING.efficiencyCap)) };
  return { ...nation, lines };
};

const APPLIERS = { modifier: applyModifier, stock: applyStock, line: applyLine };

// Applique une liste d'opérations à world.hoi. Pur : renvoie un nouveau hoi, le
// nombre d'opérations qui ont eu un effet, et les notes pour le reçu.
// `date` : la date de l'événement, point de départ de la durée d'un modificateur.
export const applyEconomyOps = (hoi, ops, { date = null, title = "" } = {}) => {
  const notes = [];
  const prefix = title ? `Event "${title}": ` : "";
  const say = (kind, textValue) => notes.push({ kind, text: `${prefix}economyOps — ${textValue}` });
  const list = (Array.isArray(ops) ? ops : []).map(normalizeEconomyOp).filter(Boolean);
  if (!list.length) return { hoi, applied: 0, notes };
  if (!isObject(hoi) || !isObject(hoi.nations)) {
    say("dropped", `${list.length} operation(s) ignored: this game has no economy layer.`);
    return { hoi, applied: 0, notes };
  }

  const nations = { ...hoi.nations };
  let applied = 0;
  for (const op of list) {
    const key = findNationKey({ nations }, op.polity);
    if (!key) {
      say("dropped", `"${op.polity}" has no tracked economy; the ${op.op} operation was ignored.`);
      continue;
    }
    const before = normalizeNation(nations[key]);
    const after = APPLIERS[op.op](before, { ...op, polity: key }, { date, say });
    if (after !== before) {
      nations[key] = after;
      applied += 1;
    }
  }
  return { hoi: { ...hoi, nations }, applied, notes };
};

// Toutes les economyOps d'un tour, événement par événement, dans l'ordre.
export const applyEconomyOpsFromEvents = (hoi, events, { date = null } = {}) => {
  let current = hoi;
  let applied = 0;
  const notes = [];
  for (const event of Array.isArray(events) ? events : []) {
    const ops = event?.impacts?.economyOps;
    if (!Array.isArray(ops) || !ops.length) continue;
    const result = applyEconomyOps(current, ops, {
      date: isGameDate(event?.date) ? text(event.date) : date,
      title: text(event?.title),
    });
    current = result.hoi;
    applied += result.applied;
    notes.push(...result.notes);
  }
  return { hoi: current, applied, notes };
};
