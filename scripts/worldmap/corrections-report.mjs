#!/usr/bin/env node
// Carte mondiale (phase 5, étape C) : le rapport lisible (Markdown) d'une
// correction à 1936 (corrections-1936.json, écrit par correct-1936.mjs).
//
//   node scripts/worldmap/corrections-report.mjs <scenarioId> > rapport.md

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";

const scenarioId = process.argv[2];
const report = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "scenarios", scenarioId, "corrections-1936.json"), "utf8"));
const out = [];
const say = (line = "") => out.push(line);

say(`# Correction de « ${scenarioId} » au 1er janvier 1936`);
say();
say("## Points de contrôle");
say();
for (const group of report.checks) {
  say(`**${group.group}** : ${group.items.map((i) => `${i.ok ? "✓" : "✗"} ${i.name}${i.ok ? "" : ` (${i.got}, attendu ${i.expected})`}`).join(" · ")}`);
  say();
}
const origin = (rules) => [...new Set(rules.map((r) => (r.startsWith("frontières inchangées") ? "frontières d'aujourd'hui, inchangées depuis 1936" : r.startsWith("carte de 1938") ? "carte de 1938" : r)))].join(" ; ");
say(`## Toutes les différences avec la conversion, en Europe et en Méditerranée (${report.differences.length})`);
say();
say("Chaque ligne : ce que disait le scénario WW2+ → ce qui est appliqué maintenant, la surface, d'où vient la correction, les provinces. À trancher : garder la correction (par défaut) ou revenir au scénario WW2+.");
say();
say("| WW2+ → corrigé | Surface | D'après | Provinces |");
say("|---|---:|---|---|");
for (const d of report.differences) {
  say(`| ${d.from} → **${d.to}** | ${Math.round(d.km2).toLocaleString("fr-FR")} km² | ${origin(d.rules)} | ${d.provinces.slice(0, 8).join(", ")}${d.provinces.length > 8 ? `, … (${d.provinces.length})` : ""} |`);
}
say();
say(`Hors d'Europe et de la Méditerranée : ${report.changedOutsideEuropeMed} provinces corrigées (sud de Sakhaline et Kouriles, Touva, Côte française des Somalis).`);
say();
process.stdout.write(out.join("\n"));
