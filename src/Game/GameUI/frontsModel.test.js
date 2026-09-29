import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { applyPlayerFrontOp, frontsPanelModel, panelMap } from "./frontsModel.js";
import { getFrontDraw, startFrontDraw, stopFrontDraw, toggleFrontDrawState } from "../Map/frontDrawStore.js";
import { applyFrontOp } from "../../runtime/hoi/fronts.js";
import { templatesFor } from "../../runtime/hoi/armies.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", ...parts), "utf8");
const info = {
  pskov: { neighbours: ["riga", "minsk"] },
  minsk: { neighbours: ["pskov", "vilnius"] },
  riga: { neighbours: ["pskov", "vilnius"] },
  vilnius: { neighbours: ["minsk", "riga", "kaunas"] },
  kaunas: { neighbours: ["vilnius"] },
};
const stateOwners = { pskov: "Soviet Union", minsk: "Soviet Union", riga: "Latvia", vilnius: "Poland", kaunas: "Lithuania" };
const stateNames = { pskov: "Pskov", minsk: "Minsk", riga: "Riga", vilnius: "Vilnius", kaunas: "Kaunas" };
const inf = (id, extra = {}) => ({ id, template: "infanterie", men: 10000, equipment: { fusils: 220, artillerie: 8 }, organisation: 100, stateId: "minsk", ...extra });
const world = () => ({
  wars: [{ id: "w", status: "active", sideA: ["Soviet Union"], sideB: ["Poland"] }],
  hoi: {
    series: "1936",
    armies: { "Soviet Union": { divisions: [inf("s1"), inf("s2"), { ...inf("t1"), template: "blindes" }, { ...inf("air"), template: "chasse" }] }, Poland: { divisions: [] } },
    fronts: [],
  },
});

test("the panel: enemies at war, free divisions by template, and no front yet", () => {
  const w = world();
  const model = frontsPanelModel(w, "Soviet Union", panelMap(w, { info, stateOwners, stateNames }));
  assert.equal(model.owner, "Soviet Union");
  assert.deepEqual(model.enemies, [{ name: "Poland", hasFront: false }]);
  assert.deepEqual(model.free, { infanterie: 2, blindes: 1 }, "land divisions only");
  assert.deepEqual(model.fronts, []);
  assert.equal(frontsPanelModel(w, "Atlantis", null), null);
});

test("the player's orders: open on the whole border or on a drawn line, send divisions, set posture and axis, redraw, close", () => {
  const map = panelMap(world(), { info, stateOwners, stateNames });
  let w = world();
  const refusedLine = applyPlayerFrontOp(w, { polity: "Soviet Union", op: "create", enemy: "Poland", sector: ["pskov"] }, map);
  assert.equal(refusedLine.note.kind, "dropped", "Pskov does not touch Poland");
  assert.equal(refusedLine.world, w, "nothing written");
  w = applyPlayerFrontOp(w, { polity: "Soviet Union", op: "create", enemy: "Poland", sector: ["minsk"] }, map).world;
  const frontId = w.hoi.fronts[0].id;
  w = applyPlayerFrontOp(w, { polity: "Soviet Union", op: "assign", frontId, count: 5, template: "infanterie" }, map).world;
  w = applyPlayerFrontOp(w, { polity: "Soviet Union", op: "posture", frontId, posture: "breakthrough", axis: "vilnius" }, map).world;
  const model = frontsPanelModel(w, "Soviet Union", map);
  assert.deepEqual(model.fronts[0].ownStates, [{ id: "minsk", name: "Minsk" }]);
  assert.deepEqual(model.fronts[0].targets, [{ id: "vilnius", name: "Vilnius" }]);
  assert.equal(model.fronts[0].posture, "breakthrough");
  assert.equal(model.fronts[0].axis, "vilnius");
  assert.equal(model.fronts[0].divisionIds.length, 2);
  assert.deepEqual(model.free, { blindes: 1 });
  const redrawn = applyPlayerFrontOp(w, { polity: "Soviet Union", op: "sector", frontId, sector: [] }, map);
  assert.match(redrawn.note.text, /redrawn \(the whole border\)/);
  const closed = applyPlayerFrontOp(w, { polity: "Soviet Union", op: "disband", frontId }, map).world;
  assert.equal(closed.hoi.fronts.length, 0);
  assert.deepEqual(frontsPanelModel(closed, "Soviet Union", map).free, { infanterie: 2, blindes: 1 });
});

test("a redrawn line must still touch the enemy", () => {
  const map = panelMap(world(), { info, stateOwners, stateNames });
  const opened = applyFrontOp({ op: "create", polity: "Soviet Union", enemy: "Poland" }, {
    armies: world().hoi.armies, fronts: [], atWar: () => true, templates: templatesFor("1936"), map,
  });
  const redraw = applyFrontOp({ op: "sector", polity: "Soviet Union", enemy: "Poland", sector: ["pskov"] }, {
    armies: opened.armies, fronts: opened.fronts, atWar: () => true, templates: templatesFor("1936"), map,
  });
  assert.match(redraw.note.text, /touches no state of Poland/);
});

test("drawing on the map: a click adds a state, a second click takes it away, closing clears it", () => {
  startFrontDraw(["minsk"]);
  toggleFrontDrawState("pskov");
  assert.deepEqual(getFrontDraw(), { drawing: true, sector: ["minsk", "pskov"] });
  toggleFrontDrawState("minsk");
  assert.deepEqual(getFrontDraw().sector, ["pskov"]);
  stopFrontDraw();
  toggleFrontDrawState("riga");
  assert.deepEqual(getFrontDraw(), { drawing: false, sector: [] }, "no drawing, no change");
});

test("wired: the dock button with armies, the map click while drawing, the drawn states on the map", () => {
  const chat = read("GameUI", "chat.jsx");
  assert.match(chat, /\{hasArmies && \(\r?\n\s+<Fronts hovered=\{hoveredFronts\}/);
  // Phase 8 : Focus et Politique, deux lanceurs de plus avec world.hoi.
  assert.match(chat, /width: dockWidthFor\(\(hasProduction \? 4 : 0\) \+ \(hasArmies \? 1 : 0\)\)/);
  assert.match(read("GameUI", "search.jsx"), /besideDockLeftFor\(\(hasProduction \? 4 : 0\) \+ \(hasArmies \? 1 : 0\)\)/);
  const layer = read("Map", "WorldMapLayer.jsx");
  assert.match(layer, /if \(!getFrontDraw\(\)\.drawing\) return;/);
  assert.match(layer, /if \(stateId\) toggleFrontDrawState\(stateId\);/);
  assert.match(read("Map", "ArmiesLayer.jsx"), /id="worldmap-front-draw"/);
  assert.match(read("GameUI", "fronts.jsx"), /const result = await updateHoiWorld\(\(current\) => \{/, "written through the same guarded write as Production");
});
