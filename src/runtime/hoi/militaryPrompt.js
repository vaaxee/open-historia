// Couche HOI4 — ce que les IA savent des armées (phase 7.5).
//
// Un seul bloc, lu par le tour (toutes les IA du monde), par le conseiller du
// joueur et par les dirigeants étrangers : les armées (divisions par gabarit et
// leur état, main-d'œuvre, réserve), les fronts et leur posture, le
// ravitaillement (divisions mal ravitaillées, encerclées), les batailles du
// dernier tour et, pour le tour, celles que le moteur vient de décider.
// Import-free à part les modules purs de la couche.

import { divisionStrength, normalizeArmy, templatesFor } from "./armies.js";
import { describeBattles } from "./combat.js";
import { normalizeFronts } from "./fronts.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const round = (value) => Math.round(Number(value) || 0);
const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

const armyKeyOf = (hoi, polity) => Object.keys(hoi?.armies ?? {}).find((name) => key(name) === key(polity)) ?? "";

// Une ligne par armée : ses divisions par gabarit et leur force moyenne, sa
// main-d'œuvre et l'essentiel de sa réserve, son ravitaillement.
export const describeArmyLine = (hoi, polity) => {
  const name = armyKeyOf(hoi, polity);
  if (!name) return "";
  const templates = templatesFor(hoi.series);
  const army = normalizeArmy(hoi.armies[name]);
  const groups = {};
  let poor = 0; let encircled = 0; let organisation = 0;
  for (const division of army.divisions) {
    const group = (groups[division.template] ??= { count: 0, strength: 0 });
    group.count += 1;
    group.strength += divisionStrength(division, templates[division.template]).overall;
    if (division.encircledDays > 0) encircled += 1;
    else if (division.supply < 0.5) poor += 1;
    organisation += division.organisation;
  }
  const units = Object.entries(groups).map(([template, group]) => `${group.count} ${template} (${pct(group.strength / group.count)})`).join(", ") || "none";
  const reserve = ["fusils", "artillerie", "chars", "camions", "fournitures"]
    .filter((item) => army.stockpile[item] > 0).map((item) => `${item} ${round(army.stockpile[item])}`).join(", ");
  const supply = encircled || poor ? `; supply: ${encircled} division(s) encircled, ${poor} poorly supplied` : "";
  const org = army.divisions.length ? `, organisation ${round(organisation / army.divisions.length)}` : "";
  return `- ${name}: ${units}${org}; manpower ${round(army.manpower.available).toLocaleString("en-US")}${reserve ? `; reserve ${reserve}` : ""}${supply}.`;
};

// Les fronts d'un pays (ou tous) : qui contre qui, posture, axe, divisions.
export const describeFronts = (hoi, { polity = "", nameOf = (id) => id } = {}) => normalizeFronts(hoi?.fronts)
  .filter((front) => !polity || key(front.owner) === key(polity) || key(front.enemy) === key(polity))
  .map((front) => `- ${front.owner} against ${front.enemy}: ${front.posture}${front.axis ? `, axis ${front.axisName || nameOf(front.axis)}` : ""}, ${front.divisionIds.length} division(s)${front.sector.length ? `, drawn over ${front.sector.length} state(s)` : ""}.`)
  .join("\n");

// Le bloc complet. `polity` : le pays dont on parle d'abord (le joueur, ou le
// dirigeant qui répond). `others` : combien d'autres armées lister (les pays en
// guerre d'abord). `battles` : les batailles que le moteur vient de décider (tour).
export const buildMilitaryPromptBlock = (world, polity, { others = 0, battles = null, nameOf = (id) => id, forTurn = false } = {}) => {
  const hoi = world?.hoi;
  if (!hoi?.armies) return "";
  const lines = ["[ARMIES — computed by the engine]"];
  const own = describeArmyLine(hoi, polity);
  if (own) lines.push(own);
  if (others > 0) {
    const atWar = new Set(normalizeFronts(hoi.fronts).flatMap((front) => [key(front.owner), key(front.enemy)]));
    for (const war of list(world?.wars)) if (clean(war?.status) === "active") for (const name of [...list(war.sideA), ...list(war.sideB)]) atWar.add(key(name));
    const rest = Object.keys(hoi.armies)
      .filter((name) => key(name) !== key(polity))
      .sort((a, b) => Number(atWar.has(key(b))) - Number(atWar.has(key(a))) || list(hoi.armies[b]?.divisions).length - list(hoi.armies[a]?.divisions).length)
      .slice(0, others);
    for (const name of rest) lines.push(describeArmyLine(hoi, name));
  }
  const fronts = describeFronts(hoi, { polity: others > 0 ? "" : polity, nameOf });
  lines.push(fronts ? `Fronts:\n${fronts}` : "Fronts: none.");
  const last = list(hoi.lastBattles).filter((battle) => others > 0 || key(battle.attacker) === key(polity) || key(battle.defender) === key(polity)).slice(-8);
  if (last.length) lines.push(`Battles of the last turn:\n${describeBattles(last)}`);
  if (forTurn && list(battles).length) {
    lines.push(
      "Battles of THIS period, already decided by the engine. Each has its own event in this turn, written by the engine: narrate around them,",
      "never change who won, the losses or who holds which state, and never add a capture of your own on a front the engine fights.",
      describeBattles(battles),
    );
  }
  if (forTurn) {
    lines.push("An AI country fights through its fronts: economyOps front (polity, enemy at war, posture hold/attack/breakthrough, count of divisions to send) and recruits from its stockpile with economyOps recruit (template, count). The engine resolves every battle.");
  }
  return lines.filter(Boolean).join("\n");
};
