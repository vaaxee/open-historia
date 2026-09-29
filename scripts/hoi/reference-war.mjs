// La simulation de référence URSS–Pologne (test G avec Jev).
//
//   node scripts/hoi/reference-war.mjs [semaines=8] [départ=1936-01-01]
//
// Sur les vraies données de la carte (états, terrain, voisins, capitales du
// scénario hoi4-states-copy-copy-2) et les armées de départ de 1936 : l'URSS
// déclare la guerre, ouvre son front en percée, axe Rovno, avec 34 divisions ;
// la Pologne tient sa frontière par la défense par défaut. Chaque semaine, le
// moteur redéploie les fronts, livre les batailles, porte les pertes et les prises,
// et fait avancer les armées (main-d'œuvre, entretien, renforts, organisation).
// Ni l'IA ni l'aviation : le rythme du combat terrestre seul. Rien n'est écrit.
// Cible (test G) : 1 à 2 états par semaine en hiver.
//
// OH_DATA_DIR désigne un autre dossier de données.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { advanceArmy, enableHoiArmies, templatesFor } from "../../src/runtime/hoi/armies.js";
import { applyFrontOps } from "../../src/runtime/hoi/fronts.js";
import { applyCombatOutcome, resolveCombat, weatherAt } from "../../src/runtime/hoi/combat.js";
import { applyFrontsForTurn } from "../../src/runtime/worldmap/frontsTurn.js";
import { buildWarMap } from "../../src/runtime/worldmap/warMap.js";
import { atWar, warsFor } from "../../src/runtime/worldmap/warRules.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const DATA = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
const SCENARIO = "hoi4-states-copy-copy-2";
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export const runReferenceWar = ({ weeks = 8, start = "1936-01-01", axisName = "Rivne", divisions = 34 } = {}) => {
  const info = readJson(path.join(DATA, "worldmap", "v1", `supply-${SCENARIO}.json`)).states;
  const provinces = readJson(path.join(DATA, "scenarios", SCENARIO, "provinces.v1.json"));
  const catalog = Object.keys(info).map((id) => ({ id, country: provinces.stateOwners?.[id] ?? "", name: provinces.stateInfo?.[id]?.name ?? id }));
  const capitals = provinces.capitals;
  const axis = catalog.find((row) => row.name === axisName)?.id ?? "";
  const templates = templatesFor("1936");
  let world = {
    wars: [{ id: "war", status: "active", sideA: ["Soviet Union"], sideB: ["Poland"] }],
    regionOwnershipOverrides: {},
    hoi: enableHoiArmies({ series: "1936", nations: { "Soviet Union": {}, Poland: {} } }, { capitals, date: start }),
  };
  const mapOf = (w) => buildWarMap({ world: w, catalog, info });
  // L'URSS : son front en percée, axe Rovno, 34 divisions d'infanterie.
  const opened = applyFrontOps([
    { op: "create", polity: "Soviet Union", enemy: "Poland", posture: "breakthrough", axis },
    { op: "assign", polity: "Soviet Union", enemy: "Poland", count: divisions, template: "infanterie" },
  ], { armies: world.hoi.armies, fronts: [], atWar: () => true, templates, date: start, map: mapOf(world) });
  world = { ...world, hoi: { ...world.hoi, armies: opened.armies, fronts: opened.fronts } };
  const weeksOut = [];
  let date = start;
  for (let week = 1; week <= weeks; week += 1) {
    const map = mapOf(world);
    // La Pologne tient par défaut ; l'URSS est « le joueur » (ses ordres restent).
    world = applyFrontsForTurn(world, { map, date, player: "Soviet Union" }).world;
    const wars = warsFor(world);
    const battleDate = addDays(date, 3);
    const combat = resolveCombat({
      world, map: mapOf(world), atWar: (a, b) => atWar(wars, a, b), date: battleDate, days: 7, seed: "reference",
      capitalOf: (polity) => capitals?.[polity]?.state ?? "",
    });
    const overrides = { ...world.regionOwnershipOverrides };
    for (const capture of combat.captures) overrides[capture.stateId] = capture.to;
    let armies = applyCombatOutcome(world.hoi.armies, combat.outcome);
    armies = Object.fromEntries(Object.entries(armies).map(([owner, army]) => [owner, advanceArmy(army, 7, { templates }).army]));
    world = {
      ...world,
      regionOwnershipOverrides: overrides,
      hoi: { ...world.hoi, armies, battleLog: [...(world.hoi.battleLog ?? []), ...combat.battles].slice(-60) },
    };
    weeksOut.push({
      week, date: battleDate,
      weather: weatherAt(battleDate, info[axis]?.lat),
      captured: combat.captures.map((capture) => capture.stateName),
      battles: combat.battles.map((battle) => `${battle.stateName} ${battle.result}${battle.factors.capitalHolds ? " (capitale tient)" : ""}`),
      losses: combat.battles.reduce((sum, battle) => ({ attacker: sum.attacker + battle.losses.attacker, defender: sum.defender + battle.losses.defender }), { attacker: 0, defender: 0 }),
    });
    date = addDays(date, 7);
  }
  const taken = Object.entries(world.regionOwnershipOverrides).filter(([, owner]) => owner === "Soviet Union").length;
  return { weeks: weeksOut, taken, warsawTaken: world.regionOwnershipOverrides[capitals.Poland.state] === "Soviet Union" };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const weeks = Number(process.argv[2]) || 8;
  const start = process.argv[3] || "1936-01-01";
  const result = runReferenceWar({ weeks, start });
  for (const week of result.weeks) {
    console.log(`semaine ${week.week} (${week.date}, ${week.weather || "beau temps"}) : ${week.captured.length} prise(s) ${week.captured.join(", ") || "—"} | batailles : ${week.battles.join(" ; ")} | pertes ${week.losses.attacker} / ${week.losses.defender}`);
  }
  console.log(`Total : ${result.taken} états pris en ${weeks} semaines ; Varsovie ${result.warsawTaken ? "prise" : "tenue"}.`);
}
