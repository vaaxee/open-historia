// Test G — la liste des temps du dernier tour (ou du n-ième avant), lue dans
// DATA/logs/turn-profile.jsonl (server/turnProfileLog.js).
//   node scripts/hoi/turn-profile-report.mjs [n]
// OH_DATA_DIR : un autre dossier de données.
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
process.env.OH_DATA_DIR ||= path.join(here, "..", "..", "server", "data");
const { readTurnProfiles } = await import("../../server/turnProfileLog.js");

const back = Math.max(1, Number(process.argv[2]) || 1);
const all = readTurnProfiles({ limit: 200 });
const turns = all.filter((entry) => entry.kind === "turn");
const turn = turns[turns.length - back];
if (!turn) { console.log("Aucun tour relevé."); process.exit(0); }
const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(`Tour du ${turn.startedAt} — ${s(turn.totalMs)} au total (${turn.outcome}).`);
console.log("\nDans l'ordre :");
for (const step of turn.steps) {
  const extra = Object.entries(step).filter(([key]) => !["step", "ms", "at"].includes(key)).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("/") : value}`).join(" ");
  console.log(`  +${s(step.at).padStart(7)}  ${s(step.ms).padStart(7)}  ${step.step}${extra ? `  (${extra})` : ""}`);
}
console.log("\nCumul par étape :");
for (const row of turn.summary) console.log(`  ${s(row.ms).padStart(7)}  ×${row.count}  ${row.step}`);
const since = Date.parse(turn.startedAt);
const translations = all.filter((entry) => entry.kind === "translation" && Date.parse(entry.receivedAt) >= since);
const batches = translations.flatMap((entry) => entry.batches ?? []);
if (batches.length) console.log(`\nTraductions depuis ce tour : ${batches.length} lot(s), ${s(batches.reduce((sum, row) => sum + row.ms, 0))}, ${batches.reduce((sum, row) => sum + row.strings, 0)} textes.`);
