// Test G (tour de bataille du 29 janvier au 5 février 1936) : la bataille de
// Varsovie racontée deux fois, des pertes toujours de 3 320 hommes, et la crise
// espagnole racontée avant les élections du 16 février.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { datesAfter, duplicateBattleEvents, electionsNotHeld } from "./turnGuards.js";
import { mentionedPolities } from "../../runtime/polityExonyms.js";
import { placeNameFor } from "../../runtime/worldmap/placeNames.js";
import { resolveCombat } from "../../runtime/hoi/combat.js";
import { buildWarMap } from "../../runtime/worldmap/warMap.js";
import { POLITICS_PRESETS_1936, advancePolitics, seedPolitics } from "../../runtime/hoi/politics.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", "..", ...parts), "utf8");
// Les pays que la carte connaît (le jeu passe le monde de la partie).
const mapWorld = { polityOverrides: Object.fromEntries(["Soviet Union", "Poland", "Spain", "Germany", "France"].map((name) => [name, { name }])) };
const mentions = (text) => mentionedPolities(text, mapWorld);
const placeNames = (battle) => [battle.stateName, placeNameFor(battle.stateName, "fr")];

// Les événements réels du tour (titres et débuts de description, G, 1936-02-05).
const warsawByAi = { date: "1936-02-01", source: "ai", title: "Bataille de Varsovie : les Soviétiques progressent mais subissent des pertes lourdes", description: "Les forces soviétiques ont lancé une offensive majeure vers Varsovie, la capitale polonaise, dans le cadre de leur guerre déclarée le 16 janvier. Malgré des gains territoriaux, les combats ont été intenses, entraînant des pertes significatives des deux côtés." };
const warsawByEngine = { date: "1936-02-01", source: "engine", battleId: "battle-1936-02-01-f-imp-rgb-0077EE", title: "Bataille de Varsovie : combats indécis", description: "L'Union soviétique attaque Varsovie, tenue par la Pologne. Pertes : 3 320 hommes pour l'Union soviétique, 9 000 pour la Pologne." };
const rhine = { date: "1936-02-03", source: "ai", title: "L'Allemagne renforce ses préparatifs militaires dans la région du Rhin", description: "Des rapports indiquent que l'Allemagne continue d'augmenter discrètement sa présence militaire dans la région du Rhin." };
const spain = { date: "1936-02-04", source: "ai", title: "Crise politique en Espagne après les élections de février", description: "Les résultats des élections espagnoles de février ont exacerbé les tensions politiques dans le pays. Le Front populaire a remporté une victoire écrasante." };
const warsaw = { stateName: "Warsaw", attacker: "Soviet Union", defender: "Poland", result: "stalemate" };

test("the engine's battle is not told twice, and no gains the sheet does not give", () => {
  const found = duplicateBattleEvents([warsawByEngine, rhine, warsawByAi, spain], [warsaw], { mentions, placeNames });
  assert.deepEqual(found.map((entry) => [entry.index, entry.reason]), [[2, "retells"]]);
  // Gains announced without naming the place, in the same war.
  const gains = { source: "ai", title: "L'Armée rouge perce les lignes polonaises", description: "L'Union soviétique réalise des gains territoriaux face à la Pologne." };
  assert.deepEqual(duplicateBattleEvents([gains], [warsaw], { mentions, placeNames }).map((entry) => entry.reason), ["gains"]);
  // What happens around a battle stays: a reaction naming both sides, without a battle or gains.
  const reaction = { source: "ai", title: "La France condamne l'attaque soviétique", description: "Paris dénonce l'attaque de l'Union soviétique contre la Pologne et rappelle son alliance." };
  assert.deepEqual(duplicateBattleEvents([reaction], [warsaw], { mentions, placeNames }), []);
  assert.deepEqual(duplicateBattleEvents([warsawByAi], [], { mentions, placeNames }), [], "no engine battle, nothing to duplicate");
  const block = read("src", "runtime", "hoi", "militaryPrompt.js");
  assert.match(block, /Never write your own event for one of these battles \(no second version of it\), and never announce territorial gains its sheet does not give\./);
});

test("an election is told only once the engine has held it; nothing dated after the period is told as done", () => {
  assert.deepEqual(electionsNotHeld([rhine, spain], [], { mentions }).map((entry) => [entry.index, entry.polities]), [[1, ["Spain"]]]);
  assert.deepEqual(electionsNotHeld([spain], [{ polity: "Spain", date: "1936-02-16" }], { mentions }).length, 1, "held after the event's date");
  assert.deepEqual(electionsNotHeld([{ ...spain, date: "1936-02-18" }], [{ polity: "Spain", date: "1936-02-16" }], { mentions }), [], "held before");
  const later = { date: "1936-02-04", title: "Crise en Espagne", description: "Le 16 février, le Front populaire a gagné." };
  assert.deepEqual(datesAfter(later, "1936-02-05"), ["1936-02-16"]);
  assert.deepEqual(datesAfter({ date: "1936-02-04", title: "Élections", description: "Les élections auront lieu le 16 février." }, "1936-02-05"), [], "announced for later: allowed");
  assert.deepEqual(datesAfter({ date: "1936-02-04", title: "x", description: "Le 2 février, Madrid proteste." }, "1936-02-05"), []);
  assert.deepEqual(datesAfter({ date: "1936-02-04", title: "x", description: "On February 20, 1936, the vote was counted." }, "1936-02-05"), ["1936-02-20"]);
  // The Spanish Republic has its election on 16 February 1936, held by the engine.
  assert.deepEqual(POLITICS_PRESETS_1936.Spain.elections, { everyYears: 4, next: "1936-02-16" });
  const held = advancePolitics(seedPolitics("Spain", { date: "1936-01-01" }), { fromDate: "1936-02-05", toDate: "1936-02-19" });
  assert.deepEqual(held.changes.map((change) => [change.date, change.kind]), [["1936-02-16", "election"]]);
  const politics = read("src", "runtime", "hoi", "politicsPrompt.js");
  assert.match(politics, /never narrate one it did not decide, nor its result before its date; and never tell as done anything dated after the end of this period\./);
});

test("wired: the guards judge the turn's answer (sent back, then removed)", () => {
  const gameplay = read("src", "Game", "AI", "gameplay.js");
  assert.match(gameplay, /const guardFaults = turnGuardFaults\(candidate, \{\s*battles: normalizeArray\(context\.engineCombat\?\.battles\),/);
  assert.match(gameplay, /if \(strict\) return guardFaults\.map\(\(fault\) => `\$\.events: \$\{fault\.text\}`\)\.join\("\\n"\);/);
  const guard = gameplay.indexOf("const guardFaults = turnGuardFaults(");
  assert.ok(guard > 0 && guard < gameplay.indexOf("if (segmentIndex === 0) addEngineBattles(candidate, context.engineCombat,"), "judged before the engine's battles are added");
});

// Les pertes : forces engagées, terrain, dés.
const info = {
  origin: { terrain: "plaine", neighbours: ["open", "marsh"], lat: 52 },
  open: { terrain: "plaine", neighbours: ["origin", "marsh"], lat: 52 },
  marsh: { terrain: "marais", neighbours: ["origin", "open"], lat: 52 },
};
const catalog = [{ id: "origin", country: "Soviet Union", name: "Origin" }, { id: "open", country: "Poland", name: "Open" }, { id: "marsh", country: "Poland", name: "Marsh" }];
const inf = (id, stateId, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 100, morale: 70, experience: 0, supply: 1, stateId, ...extra });
const battleAt = ({ axis = "open", soviet = 40, seed = "g", date = "1936-06-10" } = {}) => {
  const world = { hoi: { series: "1936", armies: {
    "Soviet Union": { divisions: Array.from({ length: soviet }, (_, i) => inf(`s${i}`, "origin", { frontId: "f" })) },
    Poland: { divisions: [inf("p0", axis), inf("p1", axis)] },
  }, fronts: [{ id: "f", owner: "Soviet Union", enemy: "Poland", posture: "breakthrough", axis, divisionIds: Array.from({ length: soviet }, (_, i) => `s${i}`) }] } };
  return resolveCombat({ world, map: buildWarMap({ world: {}, catalog, info }), atWar: () => true, date, days: 7, seed }).battles.find((battle) => battle.stateId === axis);
};

test("losses follow the forces engaged, the terrain and the dice — never the same 1 % of the army", () => {
  const seeds = ["g", "h", "i", "j", "k", "l"].map((seed) => battleAt({ seed }).losses.attacker);
  assert.ok(new Set(seeds).size >= 5, `dice: ${seeds.join(", ")}`);
  // 40 divisions de 10 000 hommes : l'ancien arrondi donnait toujours un multiple de 1 % (4 000).
  assert.ok(seeds.some((men) => men % 4000 !== 0), `not always a whole per cent of the army: ${seeds.join(", ")}`);
  const small = battleAt({ soviet: 20 }).losses.attacker;
  const large = battleAt({ soviet: 40 }).losses.attacker;
  assert.notEqual(small, large, "the forces engaged count");
  const plain = battleAt({ axis: "open" });
  const marsh = battleAt({ axis: "marsh" });
  assert.ok(marsh.losses.attacker / marsh.factors.lossDice.attacker > plain.losses.attacker / plain.factors.lossDice.attacker, "a marsh costs the attacker more");
  assert.ok(plain.factors.lossDice.attacker >= 0.75 && plain.factors.lossDice.attacker <= 1.25);
});
