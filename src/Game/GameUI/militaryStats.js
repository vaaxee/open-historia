// Phase 7.6 — les chiffres militaires d'un pays pour l'onglet Statistiques :
// ses divisions par gabarit (nombre, force et organisation moyennes), sa
// main-d'œuvre, sa réserve, ce que ses lignes ont produit au dernier saut, son
// ravitaillement, ses fronts et ses dernières batailles. Import-free.

import { divisionStrength, normalizeArmy, templatesFor } from "../../runtime/hoi/armies.js";
import { normalizeFronts } from "../../runtime/hoi/fronts.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const round2 = (value) => Math.round(value * 100) / 100;

export const militaryStats = (world, polity) => {
  const hoi = world?.hoi;
  const name = Object.keys(hoi?.armies ?? {}).find((entry) => key(entry) === key(polity));
  if (!name) return null;
  const templates = templatesFor(hoi.series);
  const army = normalizeArmy(hoi.armies[name]);
  const groups = {};
  let encircled = 0; let poorlySupplied = 0; let men = 0;
  for (const division of army.divisions) {
    const group = (groups[division.template] ??= { template: division.template, label: templates[division.template]?.label ?? division.template, count: 0, strength: 0, organisation: 0 });
    group.count += 1;
    group.strength += divisionStrength(division, templates[division.template]).overall;
    group.organisation += division.organisation;
    men += division.men;
    if (division.encircledDays > 0) encircled += 1;
    else if (division.supply < 0.5) poorlySupplied += 1;
  }
  const divisions = Object.values(groups).map((group) => ({
    ...group,
    strength: round2(group.strength / group.count),
    organisation: Math.round(group.organisation / group.count),
  })).sort((a, b) => b.count - a.count);
  const nationKey = Object.keys(hoi.nations ?? {}).find((entry) => key(entry) === key(polity));
  const report = nationKey ? hoi.lastReport?.nations?.[nationKey] : null;
  const battles = list(hoi.battleLog).filter((battle) => key(battle.attacker) === key(name) || key(battle.defender) === key(name));
  const lost = battles.reduce((sum, battle) => sum + (key(battle.attacker) === key(name) ? battle.losses?.attacker ?? 0 : battle.losses?.defender ?? 0), 0);
  return {
    polity: name,
    divisions,
    totalDivisions: army.divisions.length,
    men,
    manpower: army.manpower.available,
    stockpile: army.stockpile,
    produced: report?.produced ?? {},
    supply: { encircled, poorlySupplied, consumed: report?.army?.supply?.consumed ?? null, needed: report?.army?.supply?.needed ?? null },
    fronts: normalizeFronts(hoi.fronts).filter((front) => key(front.owner) === key(name) || key(front.enemy) === key(name)),
    battles: battles.slice(-8).reverse(),
    lostInBattle: lost,
  };
};
