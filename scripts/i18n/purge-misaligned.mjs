// Drops, from a saved language pack (server/data/lang/<code>.json), every
// translation that belongs to another string (src/runtime/translationCheck.js):
// the pairs left by answers one string short, before the translator refused
// them. Dropped strings are simply translated again when next shown.
//
//   node scripts/i18n/purge-misaligned.mjs fr            lists what it would drop
//   node scripts/i18n/purge-misaligned.mjs fr --write    drops them (a .bak is kept)
//
// OH_DATA_DIR points at another data folder (as for the server).

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { misalignedEntries, misalignedReason } from "../../src/runtime/translationCheck.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const language = process.argv[2] || "fr";
const write = process.argv.includes("--write");
const dataDir = process.env.OH_DATA_DIR || path.join(here, "..", "..", "server", "data");
const file = path.join(dataDir, "lang", `${language}.json`);

const pack = JSON.parse(fs.readFileSync(file, "utf8"));
const dropped = misalignedEntries(pack, language);
const reasons = {};
for (const source of dropped) {
  const reason = misalignedReason(source, pack[source], language);
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}
console.log(`${file}: ${Object.keys(pack).length} entries, ${dropped.length} misaligned`);
for (const [reason, count] of Object.entries(reasons)) console.log(`  ${count}  ${reason}`);
if (!write) {
  for (const source of dropped.slice(0, 10)) console.log(`  - ${source.slice(0, 70).replace(/\s+/g, " ")}\n    => ${String(pack[source]).slice(0, 70).replace(/\s+/g, " ")}`);
  console.log("Nothing written (add --write).");
} else {
  fs.copyFileSync(file, `${file}.bak`);
  for (const source of dropped) delete pack[source];
  fs.writeFileSync(file, JSON.stringify(pack));
  console.log(`Written; the previous pack is at ${file}.bak`);
}
