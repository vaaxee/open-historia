// Phase 12 (étape D) — l'éditeur au pinceau : les opérations, le brouillon de
// l'outil, l'écriture avec sauvegarde, la retouche Donetsk / Canton / Peiping.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { applyBrushEdits, provincesNamed } from "../../../server/worldMapBrushEdits.js";
import { brushDraftOps, brushProvince, getBrush, setBrushMode, startBrush, stopBrush } from "./brushStore.js";
import { applyBrushToScenario } from "../../../server/worldMapBrush.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

// Six provinces : 1-3 dans « a » (Ruritania), 4-5 dans « b » (Borduria), 6 la mer.
const scenario = () => ({
  version: 1,
  states: ["a", "a", "a", "b", "b", ""],
  stateInfo: { a: { name: "Alpha", provinces: 3 }, b: { name: "Beta", provinces: 2 } },
  stateOwners: { a: "Ruritania", b: "Borduria" },
  capitals: { Ruritania: { city: "Strelsau", state: "a", stateName: "Alpha", province: 2 } },
});
const provinces = [
  { id: 1, name: "One", city: "", population: 10 }, { id: 2, name: "Two", city: "Strelsau", population: 900 },
  { id: 3, name: "Three", city: "Zenda", population: 300 }, { id: 4, name: "Four", city: "", population: 5 },
  { id: 5, name: "Five", city: "Szohod", population: 400 }, { id: 6, name: "Sea", city: "", population: 0 },
];

test("a new state, painted provinces, counts kept right; the old state keeps the rest", () => {
  const { scenario: out, changed, notes } = applyBrushEdits(scenario(), [
    { op: "newState", name: "Zenda Hills", owner: "Ruritania" },
    { op: "assign", state: "brush-zenda-hills", provinces: [3, 1] },
  ], { provinces });
  assert.deepEqual(out.states, ["brush-zenda-hills", "a", "brush-zenda-hills", "b", "b", ""]);
  assert.equal(out.stateInfo["brush-zenda-hills"].provinces, 2);
  assert.equal(out.stateInfo.a.provinces, 1);
  assert.equal(out.stateOwners["brush-zenda-hills"], "Ruritania");
  assert.deepEqual(changed.provinces.sort(), [1, 3]);
  assert.ok(notes.every((note) => note.kind === "adjusted"));
  assert.deepEqual(scenario().states, ["a", "a", "a", "b", "b", ""], "the input is left alone");
});

test("refusals: sea provinces, unknown states, a capital in another country's state, unknown ops", () => {
  const { scenario: out, notes } = applyBrushEdits(scenario(), [
    { op: "assign", state: "a", provinces: [6, 99] },
    { op: "assign", state: "nowhere", provinces: [1] },
    { op: "capital", polity: "Ruritania", state: "b" },
    { op: "newState", name: "Alpha", owner: "" },
    { op: "paint" },
  ], { provinces });
  assert.deepEqual(out.states, scenario().states);
  assert.equal(notes.filter((note) => note.kind === "dropped").length, 6);
  assert.match(notes.map((note) => note.text).join("\n"), /not land of any state[\s\S]*no province 99[\s\S]*does not belong to Ruritania/);
});

test("capitals: set on the most populous province, or the one given; a capital whose province moves follows it", () => {
  const set = applyBrushEdits(scenario(), [{ op: "capital", polity: "Borduria", state: "b" }], { provinces }).scenario;
  assert.deepEqual(set.capitals.Borduria, { city: "Szohod", state: "b", stateName: "Beta", province: 5 });
  const named = applyBrushEdits(scenario(), [{ op: "capital", polity: "Borduria", state: "b", province: 4, city: "Bordograd" }], { provinces }).scenario;
  assert.equal(named.capitals.Borduria.city, "Bordograd");
  const moved = applyBrushEdits(scenario(), [
    { op: "newState", id: "capital-district", name: "Capital District", owner: "Ruritania" },
    { op: "assign", state: "capital-district", provinces: [2] },
  ], { provinces }).scenario;
  assert.deepEqual(moved.capitals.Ruritania, { city: "Strelsau", state: "capital-district", stateName: "Capital District", province: 2 });
  assert.equal(applyBrushEdits(scenario(), [{ op: "rename", state: "a", name: "Ruritania Proper" }]).scenario.stateInfo.a.name, "Ruritania Proper");
  assert.deepEqual(provincesNamed(["two", "Five"], provinces, { state: "a", states: scenario().states }), [2]);
});

test("the tool's draft: the brush store and the operations it sends", () => {
  startBrush();
  brushProvince(3); brushProvince(1); brushProvince(3);
  assert.deepEqual(getBrush().provinces, [1]);
  setBrushMode("capital"); brushProvince(4);
  assert.deepEqual([getBrush().provinces, getBrush().capital], [[1, 4], 4]);
  setBrushMode("paint"); brushProvince(4);
  assert.equal(getBrush().capital, 0, "unpainting the capital's province drops it");
  stopBrush();
  brushProvince(2);
  assert.deepEqual(getBrush().provinces, [], "no brush open, no painting");
  assert.deepEqual(brushDraftOps({ name: "Peiping", owner: "Hebei-Chahar", provinces: [7, 8], capital: 8, capitalOf: "Hebei-Chahar" }), [
    { op: "newState", id: "brush-peiping", name: "Peiping", owner: "Hebei-Chahar" },
    { op: "assign", state: "brush-peiping", provinces: [7, 8] },
    { op: "capital", polity: "Hebei-Chahar", state: "brush-peiping", province: 8 },
  ]);
  assert.deepEqual(brushDraftOps({ target: "a", rename: "Alpha Minor" }), [{ op: "rename", state: "a", name: "Alpha Minor" }]);
  assert.deepEqual(brushDraftOps({ name: "Nameless" }), [], "a new state needs an owner");
});

test("the server writes after a backup (and only then); a dry run writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-brush-"));
  const worldMapDir = path.join(dir, "worldmap", "v1");
  const scenarioDir = path.join(dir, "scenarios", "test-scenario");
  fs.mkdirSync(worldMapDir, { recursive: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  const scenarioFile = path.join(scenarioDir, "provinces.v1.json");
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario()));
  fs.writeFileSync(path.join(worldMapDir, "provinces.json"), JSON.stringify(provinces));
  fs.writeFileSync(path.join(worldMapDir, "supply-test-scenario.json"), "{\"states\":{}}");
  const ops = [{ op: "assign", state: "b", provinces: [3] }];
  const dry = applyBrushToScenario({ scenarioFile, ops, dryRun: true, regenerate: false, worldMapDir, dataDir: dir });
  assert.equal(dry.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(scenarioFile, "utf8")).states[2], "a");
  assert.equal(fs.existsSync(path.join(scenarioDir, "backups")), false);
  const done = applyBrushToScenario({ scenarioFile, ops, regenerate: false, worldMapDir, dataDir: dir });
  assert.equal(JSON.parse(fs.readFileSync(scenarioFile, "utf8")).states[2], "b");
  assert.deepEqual(fs.readdirSync(done.backup).sort(), ["provinces.v1.json", "supply-test-scenario.json"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(done.backup, "provinces.v1.json"), "utf8")).states[2], "a");
  assert.equal(applyBrushToScenario({ scenarioFile: path.join(dir, "missing.json"), ops }).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the 1936 retouch: Donetsk split in four, Peiping and Canton with their capitals", (t) => {
  const edits = JSON.parse(read("scripts", "worldmap", "edits", "1936-donetsk-canton-peiping.json"));
  const data = process.env.OH_DATA_DIR || path.join(root, "..", "open-historia", "server", "data");
  const scenarioFile = path.join(data, "scenarios", edits.scenario, "provinces.v1.json");
  const provincesFile = path.join(data, "worldmap", "v1", "provinces.json");
  if (!fs.existsSync(scenarioFile) || !fs.existsSync(provincesFile)) return t.skip("no world-map data here");
  const input = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
  if (input.stateInfo?.["brush-peiping"]) return t.skip("already applied to these data");
  const { scenario: out, notes } = applyBrushEdits(input, edits.ops, { provinces: JSON.parse(fs.readFileSync(provincesFile, "utf8")) });
  assert.deepEqual(notes.filter((note) => note.kind === "dropped"), []);
  const count = (state) => out.states.filter((s) => s === state).length;
  assert.deepEqual([count("brush-zhytomyr"), count("brush-poltava"), count("brush-kharkiv"), count("imp-rgb-6666BB")], [9, 4, 12, 5]);
  assert.equal(out.capitals["Hebei-Chahar"].city, "Peiping");
  assert.equal(out.capitals["Guangdong Clique"].city, "Canton");
  assert.equal(out.capitals.Mengjiang.city, "Kalgan", "Kalgan's province stays in Mengjiang's state");
  assert.equal(out.stateInfo["imp-rgb-550055"].name, "Kalgan");
  assert.equal(out.stateInfo["imp-rgb-335577"].name, "Changsha");
});

test("wired: the route, the tool, the map click and its highlight", () => {
  assert.match(read("server", "server.js"), /registerWorldMapBrushRoutes\(app, jsonParser\);/);
  const cheats = read("src", "Game", "GameUI", "cheats.jsx");
  assert.match(cheats, /tools: \["edit-feature", "add-feature", "clear-features", "brush"\]/);
  assert.match(cheats, /fetch\("\/api\/worldmap\/brush"/);
  const layer = read("src", "Game", "Map", "WorldMapLayer.jsx");
  assert.match(layer, /if \(getBrush\(\)\.painting\) \{ if \(data\.scenario\?\.states\?\.\[province - 1\]\) brushProvince\(province\); return; \}/);
  assert.match(layer, /id="worldmap-brush"/);
  assert.match(read("src", "Game", "Map", "mapLayerOrder.js"), /"worldmap-brush",\r?\n\s+"worldmap-province-lines"/);
});
