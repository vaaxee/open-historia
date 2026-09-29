// Le test G avec Jev (URSS contre Pologne, 2 tours) : ce qui était à corriger,
// hors du rythme des percées (combat.test.js, scripts/hoi/reference-war.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { declarationEvent, planPlayerWars } from "../AI/playerWarOrders.js";
import { applyNarration } from "../AI/validatedNarration.js";
import { busyReasons, beginSimulation, endSimulation, isSimulationBusy } from "../AI/simulationStatus.js";
import { waitUntilIdle } from "./hoiWrites.js";
import { describeBusy, frontsPanelWords, jevChoiceText, panelNoteText } from "./frontsPanelText.js";
import { militaryStats } from "./militaryStats.js";
import { deriveEventFocusBounds, engineEventTextProps, withDrawnRegionBounds, worldMapStateRegions } from "./eventFocus.js";
import { frenchPolityWithArticle, frenchWithArticle } from "../../runtime/polityExonyms.js";
import { SEA_BOXES, seaAt, seaZoneLabel } from "../../runtime/worldmap/seaNames.js";
import { classifySeaZones } from "../../../scripts/worldmap/seas.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, ...parts), "utf8");

// ——— 2. Récit : les lieux du moteur et les articles ———

test("French articles: the country names the engine writes take their article", () => {
  assert.equal(frenchPolityWithArticle("Soviet Union"), "l'Union soviétique");
  assert.equal(frenchPolityWithArticle("Poland"), "la Pologne");
  assert.equal(frenchPolityWithArticle("Poland", "de"), "de la Pologne");
  assert.equal(frenchPolityWithArticle("Soviet Union", "de"), "de l'Union soviétique");
  assert.equal(frenchPolityWithArticle("Japan", "à"), "au Japon");
  assert.equal(frenchPolityWithArticle("United Kingdom", "de"), "du Royaume-Uni");
  assert.equal(frenchPolityWithArticle("United States", "à"), "aux États-Unis");
  assert.equal(frenchPolityWithArticle("Netherlands"), "les Pays-Bas");
  assert.equal(frenchPolityWithArticle("Italy", "à"), "à l'Italie");
  assert.equal(frenchWithArticle("Imperialist Japan", "de"), "de Imperialist Japan", "an unknown name keeps no article");
  const event = declarationEvent({ player: "Soviet Union", target: "Poland", language: "fr" });
  assert.equal(event.title, "Déclaration de guerre : l'Union soviétique contre la Pologne");
  assert.match(event.description, /^Sur ordre de son gouvernement, l'Union soviétique déclare la guerre à la Pologne\./);
});

test("the engine's events keep their words: no narrator rewrite, no interface translator", () => {
  const events = [{ source: "engine", title: "Bataille de Białołęka : prise", description: "L'Union soviétique attaque Białołęka.", impacts: {} }];
  const changed = applyNarration(events, { events: [{ index: 0, title: "Prise de Białystok", description: "L'Union soviétique prend Białystok." }] });
  assert.equal(changed, 0);
  assert.equal(events[0].title, "Bataille de Białołęka : prise");
  assert.deepEqual(engineEventTextProps({ source: "engine" }), { "data-no-translate": "" });
  assert.deepEqual(engineEventTextProps({ source: "ai" }), {});
  assert.match(read("time.jsx"), /<div \{\.\.\.engineText\} style=\{\{ color: "rgba\(255,255,255,0\.94\)"/);
});

// ——— 3. Une seule déclaration de guerre ———

test("the answer's war told in another event than its record: that event announces it, no second declaration", () => {
  const world = { polityOverrides: { Poland: { name: "Poland", aliases: [] }, "Soviet Union": { name: "Soviet Union", aliases: [] } }, wars: [] };
  const events = [
    { title: "Déclaration de guerre de l'Union soviétique contre la Pologne", description: "L'Union soviétique a officiellement déclaré la guerre à la Pologne." },
    { title: "Réaction polonaise et mobilisation partielle", description: "La Pologne mobilise." },
  ];
  const warUpdates = [{ id: "soviet-polish-war", op: "start", actors: ["Soviet Union"], opponents: ["Poland"], eventIndexes: [1] }];
  const { started, announced } = planPlayerWars({
    actions: [{ id: "a", status: "planned", title: "Déclarer la guerre à la Pologne." }],
    world, player: "Soviet Union", warUpdates, events, date: "1936-01-02", language: "fr",
  });
  assert.deepEqual(started, [], "the engine adds no declaration of its own");
  assert.deepEqual(announced.map(({ id, index }) => ({ id, index })), [{ id: "soviet-polish-war", index: 0 }]);
  assert.match(read("..", "AI", "gameplay.js"), /that event announces the war, and the engine adds no second declaration/);
});

// ——— 4. L'interface bloquée après un tour ———

test("a panel order waits for what keeps the game busy, and says what it is", async () => {
  beginSimulation("createInteractive");
  assert.equal(isSimulationBusy(), true);
  assert.deepEqual(busyReasons(), ["createInteractive"]);
  assert.equal(describeBusy(busyReasons(), "fr"), "l'événement interactif");
  const seen = [];
  let ticks = 0;
  const done = await waitUntilIdle({ stepMs: 1, onWait: (reasons) => seen.push(...reasons), sleep: async () => { ticks += 1; if (ticks === 3) endSimulation("createInteractive"); } });
  assert.equal(done, true);
  assert.equal(isSimulationBusy(), false);
  assert.ok(seen.includes("createInteractive"));
  // A task that never ends: the wait gives up and says so.
  const stuck = await waitUntilIdle({ waitMs: 3, stepMs: 1, isBusy: () => true, reasons: () => ["held-turn"], sleep: async () => {} });
  assert.equal(stuck, false);
  assert.equal(describeBusy(["held-turn"], "fr"), "le tour retenu au tableau des Projets");
  // Named from the caller when no label is given.
  const named = () => { beginSimulation(); const reasons = busyReasons(); endSimulation(); return reasons; };
  assert.equal(named().length, 1);
  assert.equal(isSimulationBusy(), false);
});

// ——— 5 et 6. Blocus, Jev, français des onglets ———

test("the Fronts panel speaks French: labels, engine notes, the posture sentence, sea zones by name", () => {
  const w = frontsPanelWords("fr");
  assert.deepEqual([w.tabs.land, w.tabs.air, w.tabs.sea], ["Terre", "Air", "Mer"]);
  assert.equal(w.airWings, "Escadres aériennes");
  assert.equal(w.missions.escort, "Escorte des convois");
  assert.equal(w.prepare, "Préparer");
  const zoneName = (id) => (id === "20228" ? "Mer Baltique, large de Gdynia" : id);
  assert.equal(panelNoteText("navalOps — Soviet Union sent 2 fleet(s) on blockade in sea zone 20228.", { language: "fr", zoneName }), "2 flotte(s) en blocus : Mer Baltique, large de Gdynia.");
  // 9. « Le front vient de percer » : il passe en percée.
  assert.equal(panelNoteText("frontOps — Soviet Union's front against Poland now breakthrough (axis Rivne).", { language: "fr" }), "Le front contre la Pologne passe en percée, axe Rovno.");
  assert.equal(panelNoteText("frontOps — Soviet Union's front against Poland now hold.", { language: "fr" }), "Le front contre la Pologne tient la ligne.");
  assert.equal(panelNoteText("airOps — Soviet Union sent 3 chasse wing(s) on superiority.", { language: "fr" }), "3 escadre(s) de chasse en supériorité aérienne.");
  assert.equal(panelNoteText("navalOps — the enemy dominates every sea zone off Memel: no landing.", { language: "fr" }), "L'ennemi tient toutes les eaux au large de Memel : pas de débarquement.");
  assert.equal(panelNoteText("navalOps — Soviet Union sent 2 fleet(s) on blockade in sea zone 20228.", { language: "en", zoneName: () => "Baltic Sea, off Gdynia" }), "Soviet Union sent 2 fleet(s) on blockade in Baltic Sea, off Gdynia.");
  const panel = read("fronts.jsx");
  assert.match(panel, /<div data-no-translate="" style=\{\{/, "the panel is out of the translator's way");
  assert.doesNotMatch(panel, />Air wings<|>Convoy escort<|>Prepare<|Free fleets: /);
  assert.match(panel, /\{w\.jevLine\(jev\.decisions\?\.length \?\? 0/, "Jev's decisions are visible");
});

test("Jev's choices and the blockade are visible: Statistics, the Fronts panel, an event", () => {
  assert.equal(jevChoiceText("Hold the line against Soviet Union", "fr"), "Tenir la ligne face à l'Union soviétique");
  assert.equal(jevChoiceText("Attack toward Rivne (2 enemy divisions there)", "fr"), "Attaquer vers Rovno (2 division(s) ennemie(s))");
  assert.equal(jevChoiceText("Recruit nothing and keep the stockpile", "fr"), "Ne rien recruter et garder la réserve");
  const world = { hoi: { series: "1936", armies: { Poland: { divisions: [] } }, lastLocalDecisions: { ms: 12995, decisions: [
    { polity: "Poland", question: "q", choice: "Hold the line against Soviet Union", ms: 2518 },
    { polity: "France", question: "q", choice: "Recruit nothing and keep the stockpile", ms: 1743 },
  ] } } };
  assert.deepEqual(militaryStats(world, "Poland").localDecisions, [{ question: "q", choice: "Hold the line against Soviet Union", ms: 2518 }]);
  const gameplay = read("..", "AI", "gameplay.js");
  assert.match(gameplay, /title: language === "fr" \? `Blocus de \$\{places\}` : `Blockade of \$\{places\}`/);
  assert.match(gameplay, /if \(already\.has\(`\$\{blockade\.owner\}\|\$\{blockade\.zoneId\}`\)\) continue;/, "one event when a blockade starts");
});

// ——— 7. Les zones de mer ———

test("sea zones are named by sea or gulf; lakes and reservoirs are not the sea, the Caspian is", () => {
  assert.equal(seaAt(19, 55.5).fr, "mer Baltique");
  assert.equal(seaAt(26, 60).fr, "golfe de Finlande");
  assert.equal(seaAt(34, 43.5).fr, "mer Noire");
  assert.equal(seaAt(51, 42).fr, "mer Caspienne");
  assert.equal(seaAt(-30, 40).fr, "Atlantique Nord");
  assert.equal(seaAt(-170, 58).fr, "mer de Béring", "across the antimeridian");
  assert.equal(seaZoneLabel({ name: { fr: "mer Baltique", en: "Baltic Sea" } }, { language: "fr", coastName: "Gdynia" }), "Mer Baltique, large de Gdynia");
  assert.ok(SEA_BOXES.every(([, fr, en, box]) => fr && en && box.length === 4));
  const zones = {
    1: { center: [-30, 40], cells: 50000, neighbours: [2] },
    2: { center: [19, 55.5], cells: 3000, neighbours: [1] },
    3: { center: [51, 42], cells: 5000, neighbours: [] }, // the Caspian, apart
    4: { center: [108, 53], cells: 400, neighbours: [] }, // Baikal
    5: { center: [27.5, 58.7], cells: 60, neighbours: [] }, // Lake Peipus, inside the Baltic's box
  };
  const out = classifySeaZones(zones);
  assert.equal(out[1].lake, undefined);
  assert.equal(out[3].lake, undefined, "the Caspian is kept");
  assert.equal(out[3].name.fr, "mer Caspienne");
  assert.equal(out[4].lake, true, "Baikal is a lake");
  assert.equal(out[5].lake, true, "too small for the Baltic");
  assert.match(read("..", "..", "..", "server", "worldMap.js"), /zones = Object\.fromEntries\(Object\.entries\(zones\)\.filter\(\(\[, zone\]\) => !zone\?\.lake\)\);/);
});

// ——— 8. La caméra ———

test("a world-map state is framed by its own box, never by the stale archive one (the jump to Hungary)", () => {
  const stock = new Map([["imp-rgb-AA7700", [[17, 46], [22, 48]]]]); // Hungary: the archive before the re-alignment
  const regions = [
    { id: "imp-rgb-AA7700", lng: 24.87, lat: 51.4 }, // the primed record: a centre only
    ...worldMapStateRegions({ "imp-rgb-AA7700": { lng: 24.87, lat: 51.4, areaKm2: 39759 }, other: { lng: 1, lat: 1 } }),
  ];
  const merged = withDrawnRegionBounds(stock, regions);
  const [[x0, y0], [x1, y1]] = merged.get("imp-rgb-AA7700");
  assert.ok(x0 < 24.87 && x1 > 24.87 && y0 < 51.4 && y1 > 51.4, "around Rivne");
  assert.ok(x0 > 22, "not in Hungary");
  // A battle frames its state (regionControlOps), not the countries its text names.
  const bounds = deriveEventFocusBounds(
    { title: "Bataille de Rovno : prise", impacts: { regionControlOps: [{ op: "control", regionId: "imp-rgb-AA7700" }] } },
    { regionBounds: merged },
  );
  assert.deepEqual(bounds[0].map(Math.round), [x0, y0].map(Math.round));
});
