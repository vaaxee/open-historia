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
import { normalizeAirMissions } from "./air.js";
import { describeNaval, normalizeLandings, normalizeNavalMissions } from "./naval.js";

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

// Phase 7.8 : les missions aériennes et navales (d'un pays, ou toutes), les
// blocus du dernier tour.
export const describeAirNaval = (hoi, { polity = "" } = {}) => {
  const mine = (owner) => !polity || key(owner) === key(polity);
  const fronts = new Map(normalizeFronts(hoi?.fronts).map((front) => [front.id, front]));
  const air = normalizeAirMissions(hoi?.airMissions).filter((mission) => mine(mission.owner)).map((mission) => {
    const front = fronts.get(mission.zone.frontId);
    const where = mission.zone.kind === "front" ? (front ? `the front against ${front.owner === mission.owner ? front.enemy : front.owner}` : "a front") : `state ${mission.zone.stateId}`;
    return `- ${mission.owner}: ${mission.wingIds.length} wing(s) on ${mission.mission} over ${where}.`;
  });
  const sea = normalizeNavalMissions(hoi?.navalMissions).filter((mission) => mine(mission.owner))
    .map((mission) => `- ${mission.owner}: ${mission.fleetIds.length} fleet(s) on ${mission.mission} in sea zone ${mission.zoneId}.`);
  const landings = normalizeLandings(hoi?.landings).filter((landing) => mine(landing.owner) || key(landing.enemy) === key(polity))
    .map((landing) => `- ${landing.owner}: ${landing.divisionIds.length} division(s) embarked to land on ${landing.stateName}.`);
  const blockades = list(hoi?.blockades).map((blockade) => `- ${blockade.owner} blockades sea zone ${blockade.zoneId}: ${list(blockade.states).length} enemy coastal state(s) cut from sea supply.`);
  return [...air, ...sea, ...landings, ...blockades].join("\n");
};

// Le bloc complet. `polity` : le pays dont on parle d'abord (le joueur, ou le
// dirigeant qui répond). `others` : combien d'autres armées lister (les pays en
// guerre d'abord). `battles` : les batailles que le moteur vient de décider (tour).
// `naval` : les combats navals et blocus de ce tour ({ battles, blockades }).
export const buildMilitaryPromptBlock = (world, polity, { others = 0, battles = null, naval = null, nameOf = (id) => id, forTurn = false } = {}) => {
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
  const airNaval = describeAirNaval(hoi, { polity: others > 0 ? "" : polity });
  if (airNaval) lines.push(`Air and sea:\n${airNaval}`);
  const last = list(hoi.lastBattles).filter((battle) => others > 0 || key(battle.attacker) === key(polity) || key(battle.defender) === key(polity)).slice(-8);
  if (last.length) lines.push(`Battles of the last turn:\n${describeBattles(last)}`);
  if (forTurn && list(battles).length) {
    lines.push(
      "Battles of THIS period, already decided by the engine. Each has its own event in this turn, written by the engine: narrate around them,",
      "never change who won, the losses or who holds which state, and never add a capture of your own on a front the engine fights.",
      "Never write your own event for one of these battles (no second version of it), and never announce territorial gains its sheet does not give.",
      describeBattles(battles),
    );
  }
  if (forTurn && (list(naval?.battles).length || list(naval?.blockades).length)) {
    lines.push("Naval battles and blockades of THIS period, decided by the engine (their events are written by the engine):", describeNaval(naval));
  }
  if (forTurn) {
    lines.push("An AI country fights through its fronts: economyOps front (polity, enemy at war, posture hold/attack/breakthrough, count of divisions to send) and recruits from its stockpile with economyOps recruit (template, count). economyOps air (enemy, mission superiority/support, count of wings) and naval (enemy, mission escort/blockade/support/landing, count) send its aviation and fleets; the engine picks the front or sea zone. economyOps programme (polity, label: one sentence) sets an AI country's strategy, which its local decider follows. The engine resolves every battle.");
  }
  return lines.filter(Boolean).join("\n");
};
