// Phase 12 (étape D) — appliquer une retouche au pinceau hors du jeu.
//   node scripts/worldmap/brush.mjs <scenarioId> <edits.json> [--dry]
// <edits.json> : { ops: [...] } (server/worldMapBrushEdits.js). Sauvegarde
// d'abord (<scénario>/backups/brush-<date>/), puis refait le ravitaillement et
// les zones de mer. OH_DATA_DIR désigne un autre dossier de données.
import fs from "fs";
import path from "path";
import url from "url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const DATA = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
process.env.OH_DATA_DIR = DATA;
const { applyBrushToScenario } = await import("../../server/worldMapBrush.js");

const [scenarioId, editsFile] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const dryRun = process.argv.includes("--dry");
if (!scenarioId || !editsFile) {
  console.error("usage: node scripts/worldmap/brush.mjs <scenarioId> <edits.json> [--dry]");
  process.exit(2);
}
const { ops = [] } = JSON.parse(fs.readFileSync(editsFile, "utf8"));
const result = applyBrushToScenario({
  scenarioFile: path.join(DATA, "scenarios", scenarioId, "provinces.v1.json"),
  ops, dryRun, worldMapDir: path.join(DATA, "worldmap", "v1"), dataDir: DATA,
});
if (!result.ok) { console.error(result.error); process.exit(1); }
for (const note of result.notes) console.log(`${note.kind === "dropped" ? "✗" : "·"} ${note.text}`);
console.log(`${dryRun ? "(essai) " : ""}${result.changed.provinces.length} province(s), ${result.changed.states.length} état(s) touchés.`);
if (result.backup) console.log(`sauvegarde : ${result.backup}`);
if (result.regenerated?.length) console.log(`refait : ${result.regenerated.join(", ")}`);
