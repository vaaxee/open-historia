#!/usr/bin/env node
// Carte mondiale : le rapport lisible (Markdown) des noms d'îles, en Europe et
// en Méditerranée (islands-report.json, écrit par build.mjs, étape attributes).
//
//   node scripts/worldmap/islands-report.mjs > iles.md

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";

const OUT = path.join(DATA_DIR, "worldmap", "v1");
const report = JSON.parse(fs.readFileSync(path.join(OUT, "islands-report.json"), "utf8"));
const inEuropeMed = ([lng, lat]) => lng >= -32 && lng <= 45 && lat >= 27 && lat <= 72;
const rows = report.provinces.filter((p) => inEuropeMed(p.center)).sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
const out = [];
const say = (line = "") => out.push(line);

say("# Noms des provinces insulaires (Europe et Méditerranée)");
say();
say(`${rows.length} provinces sur des îles, dont ${rows.filter((p) => p.name !== p.before).length} renommées.`);
say();
say("| Pays | Province | Avant | D'après | Île | Surface |");
say("|---|---|---|---|---|---:|");
for (const p of rows) {
  say(`| ${p.country || "?"} | **${p.name}** | ${p.before === p.name ? "" : p.before} | ${p.source || "sa ville"} | ${p.island} | ${Math.round(p.km2).toLocaleString("fr-FR")} km² |`);
}
say();
const unmatched = report.unmatched.filter((u) => inEuropeMed([u.lng, u.lat]) && !/même terre/.test(u.reason));
if (unmatched.length) {
  say("## Îles de la liste restées sans province à leur nom");
  say();
  say("Soudées au continent sur la trame et comprises dans une province qui a sa ville (le nom de la ville reste) :");
  say();
  say(unmatched.map((u) => `${u.name} (${u.province})`).join(", "));
  say();
}
process.stdout.write(out.join("\n"));
