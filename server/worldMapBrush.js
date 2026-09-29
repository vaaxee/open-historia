/*! Phase 12 (étape D) — l'éditeur au pinceau, côté serveur. */
// POST /api/worldmap/brush { ops, dryRun? } : applique des retouches
// (server/worldMapBrushEdits.js) au scénario de la partie active sur la
// carte mondiale. Sauvegarde d'abord provinces.v1.json et les fichiers qui en
// découlent (ravitaillement, zones de mer) dans <scénario>/backups/brush-<date>/,
// écrit, puis refait ces fichiers (scripts/worldmap/supply-states.mjs, seas.mjs).
// Les contours des états (states.v1.geojson) se refont seuls à la lecture.

import fs from "fs";
import path from "path";
import url from "url";
import { execFileSync } from "child_process";
import { DATA_DIR } from "./dataDir.js";
import { WORLD_MAP_DIR, activeGameWorldMapFile } from "./worldMap.js";
import { applyBrushEdits } from "./worldMapBrushEdits.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, "..", "scripts", "worldmap");

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};

// Applique `ops` au fichier `scenarioFile`. `regenerate` : refaire le
// ravitaillement et les zones de mer (faux dans les tests). Renvoie
// { ok, notes, changed, backup }.
export const applyBrushToScenario = ({
  scenarioFile, ops, regenerate = true, dryRun = false, worldMapDir = WORLD_MAP_DIR, dataDir = DATA_DIR,
}) => {
  if (!scenarioFile || !fs.existsSync(scenarioFile)) return { ok: false, error: "no world-map scenario for the active game" };
  const scenarioId = path.basename(path.dirname(scenarioFile));
  const input = readJson(scenarioFile);
  if (!input) return { ok: false, error: "the scenario file cannot be read" };
  const provinces = readJson(path.join(worldMapDir, "provinces.json"), []);
  const { scenario, notes, changed } = applyBrushEdits(input, ops, { provinces: Array.isArray(provinces) ? provinces : provinces?.provinces ?? [] });
  const touched = changed.provinces.length + changed.states.length;
  if (dryRun || !touched) return { ok: true, dryRun, notes, changed, backup: null };
  const backup = path.join(path.dirname(scenarioFile), "backups", `brush-${stamp()}`);
  fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(scenarioFile, path.join(backup, path.basename(scenarioFile)));
  for (const derived of [`supply-${scenarioId}.json`, `seas-${scenarioId}.json`]) {
    const file = path.join(worldMapDir, derived);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backup, derived));
  }
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const regenerated = [];
  if (regenerate) {
    for (const script of ["supply-states.mjs", "seas.mjs"]) {
      try {
        execFileSync(process.execPath, [path.join(SCRIPTS, script), scenarioId], { env: { ...process.env, OH_DATA_DIR: dataDir }, stdio: "pipe", timeout: 10 * 60 * 1000 });
        regenerated.push(script);
      } catch (error) {
        notes.push({ kind: "dropped", text: `brush — ${script} failed: ${String(error?.message ?? error).slice(0, 200)}` });
      }
    }
  }
  return { ok: true, dryRun: false, notes, changed, backup, regenerated };
};

export const registerWorldMapBrushRoutes = (app, jsonParser) => {
  app.post("/api/worldmap/brush", jsonParser, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : null;
    if (!ops || !ops.length) return res.status(400).json({ ok: false, error: "ops: a non-empty list" });
    const result = applyBrushToScenario({ scenarioFile: activeGameWorldMapFile(), ops, dryRun: Boolean(req.body?.dryRun) });
    return res.status(result.ok ? 200 : 409).json(result);
  });
};
