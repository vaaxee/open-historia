#!/usr/bin/env node
// Carte mondiale (phase 5, étape C) : la liste des doutes d'une conversion,
// lisible (Markdown), regroupée par paire de pays et par région.
//
//   node scripts/worldmap/conversion-report.mjs <scenarioId> > rapport.md

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";

const scenarioId = process.argv[2];
const dir = path.join(DATA_DIR, "scenarios", scenarioId);
const { doubts, threshold } = JSON.parse(fs.readFileSync(path.join(dir, "conversion-v1.json"), "utf8"));
const out = [];
const say = (line = "") => out.push(line);
const place = ([lng, lat]) => `${lat.toFixed(1)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(1)}° ${lng >= 0 ? "E" : "O"}`;
const zone = ([lng, lat]) => {
  if (lat > 35 && lng > -25 && lng < 45) return "Europe";
  if (lat > 55 && lng >= 45) return "Russie et Sibérie";
  if (lng > -170 && lng < -30) return lat > 15 ? "Amérique du Nord" : "Amérique latine";
  if (lat > -40 && lat <= 37 && lng > -20 && lng < 52) return "Afrique et Moyen-Orient";
  if (lng >= 52 && lng < 100 && lat <= 55) return "Asie centrale et du Sud";
  if (lng >= 100 && lat >= 10) return "Asie orientale";
  if (lng >= 90 && lat < 10) return "Asie du Sud-Est et Océanie";
  return "Ailleurs";
};

say(`# Conversion de « ${scenarioId} » : les doutes`);
say();
say(`Seuil : une province est « partagée » si moins de ${Math.round(threshold * 100)} % de sa surface va à un seul pays dans l'ancienne carte.`);
say();

say(`## Provinces partagées (${doubts.mixed.length})`);
say();
say("Par paire de pays (le premier est celui retenu) :");
say();
const pairs = new Map();
for (const d of doubts.mixed) {
  const key = `${d.owner} / ${d.other || "?"}`;
  if (!pairs.has(key)) pairs.set(key, []);
  pairs.get(key).push(d);
}
for (const [key, list] of [...pairs].sort((a, b) => b[1].length - a[1].length)) {
  say(`- **${key}** : ${list.length} — ${list.slice(0, 6).map((d) => `${d.name} (${d.share} / ${d.otherShare} %)`).join(", ")}${list.length > 6 ? ", …" : ""}`);
}
say();

say(`## Rendues au propriétaire de leur morceau (${doubts.corrected.length})`);
say();
say("Provinces dont l'ancienne carte disait un autre pays, mais dont le morceau (même pays en 1938 et aujourd'hui) appartient à au moins 75 % à un seul pays :");
say();
const moves = new Map();
for (const d of doubts.corrected) {
  const key = `${d.from} → ${d.owner}`;
  if (!moves.has(key)) moves.set(key, []);
  moves.get(key).push(d);
}
for (const [key, list] of [...moves].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
  say(`- **${key}** : ${list.length} — ${list.slice(0, 5).map((d) => d.name).join(", ")}${list.length > 5 ? ", …" : ""}`);
}
if (moves.size > 25) say(`- … et ${moves.size - 25} autres paires`);
say();

say(`## Grandes provinces hors de l'ancienne carte (${doubts.outside.length})`);
say();
say(`Rattachées à la province la plus proche ; ${doubts.outsideAuto.length} îlots de moins de 2 000 km² l'ont été d'office et ne sont pas listés.`);
say();
const zones = new Map();
for (const d of doubts.outside) {
  const z = zone(d.center);
  if (!zones.has(z)) zones.set(z, []);
  zones.get(z).push(d);
}
for (const [z, list] of [...zones].sort((a, b) => b[1].length - a[1].length)) {
  const owners = new Map();
  for (const d of list) owners.set(d.owner, (owners.get(d.owner) ?? 0) + 1);
  say(`- **${z}** : ${list.length} — attribuées à ${[...owners].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} (${n})`).join(", ")}`);
}
say();

if (doubts.forced.length) {
  say(`## Données d'office à un petit pays (${doubts.forced.length})`);
  say();
  for (const d of doubts.forced) say(`- ${d.name} (${place(d.center)}) : ${d.previous} → **${d.owner}** (${d.share} % de la province)`);
  say();
}
if (doubts.missingCountries.length) {
  say(`## Pays sans aucune province (${doubts.missingCountries.length})`);
  say();
  for (const d of doubts.missingCountries) say(`- ${d.owner} (${d.areaKm2} km²)`);
  say();
}

say(`## États en plusieurs morceaux (${doubts.splitStates.length})`);
say();
say("États (anciennes régions) dont les provinces forment plusieurs morceaux de plus de 2 000 km² :");
say();
const byOwner = new Map();
for (const d of doubts.splitStates) byOwner.set(d.owner, [...(byOwner.get(d.owner) ?? []), d]);
for (const [owner, list] of [...byOwner].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  say(`- **${owner}** : ${list.length} — ${list.slice(0, 5).map((d) => `${d.name} (${d.parts} morceaux)`).join(", ")}${list.length > 5 ? ", …" : ""}`);
}
say();

say(`## Anciennes régions sans province (${doubts.emptyStates.length})`);
say();
const lost = new Map();
for (const d of doubts.emptyStates) lost.set(d.owner, (lost.get(d.owner) ?? 0) + 1);
say(`Trop petites pour garder une province à elles ; leur surface est allée aux voisines. Par pays : ${[...lost].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} (${n})`).join(", ")}.`);
say();
process.stdout.write(out.join("\n"));
