#!/usr/bin/env node
// Carte mondiale unique (phase 5, étape A) — télécharge une fois les données
// sources, hors du dépôt, dans server/data/worldmap/sources/.
//
//   node scripts/worldmap/fetch-sources.mjs            # tout ce qui manque
//   node scripts/worldmap/fetch-sources.mjs --list     # la liste, sans rien télécharger
//
// Un fichier déjà là n'est pas retéléchargé. Le jeu, lui, ne télécharge jamais
// rien. Licences et attributions : docs/hoi-layer.md, section « Carte mondiale ».

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../server/dataDir.js";

export const SOURCES_DIR = path.join(DATA_DIR, "worldmap", "sources");

const NE = "https://naciscdn.org/naturalearth/10m";
const HB = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson";

// [fichier, adresse, taille annoncée en octets, rôle, licence]
export const SOURCES = [
  ["ne_10m_land.zip", `${NE}/physical/ne_10m_land.zip`, 3269070, "terres (côtes)", "Natural Earth, domaine public"],
  ["ne_10m_minor_islands.zip", `${NE}/physical/ne_10m_minor_islands.zip`, 314932, "petites îles", "Natural Earth, domaine public"],
  ["ne_10m_lakes.zip", `${NE}/physical/ne_10m_lakes.zip`, 2349685, "lacs", "Natural Earth, domaine public"],
  ["ne_10m_rivers_lake_centerlines.zip", `${NE}/physical/ne_10m_rivers_lake_centerlines.zip`, 2079507, "fleuves", "Natural Earth, domaine public"],
  ["ne_10m_admin_0_countries.zip", `${NE}/cultural/ne_10m_admin_0_countries.zip`, 4930492, "frontières d'aujourd'hui (lignes guides)", "Natural Earth, domaine public"],
  ["ne_10m_admin_1_states_provinces.zip", `${NE}/cultural/ne_10m_admin_1_states_provinces.zip`, 14909524, "découpage mondial par défaut des états", "Natural Earth, domaine public"],
  ["ne_10m_geography_regions_polys.zip", `${NE}/physical/ne_10m_geography_regions_polys.zip`, 2038519, "îles et archipels nommés (contours)", "Natural Earth, domaine public"],
  ["ne_10m_geography_regions_points.zip", `${NE}/physical/ne_10m_geography_regions_points.zip`, 87372, "îles et archipels nommés (points)", "Natural Earth, domaine public"],
  ["cities15000.zip", "https://download.geonames.org/export/dump/cities15000.zip", 3359527, "villes (graines, noms)", "GeoNames, CC BY 4.0"],
  // Phase 7 (ravitaillement) : les voies ferrées d'aujourd'hui, base de l'infrastructure.
  ["ne_10m_railroads.zip", `${NE}/cultural/ne_10m_railroads.zip`, 15116579, "voies ferrées (ravitaillement, phase 7)", "Natural Earth, domaine public"],
  ["world_1200.geojson", `${HB}/world_1200.geojson`, 1.1e6, "lignes guides 1200", "historical-basemaps, GPL-3.0"],
  ["world_1914.geojson", `${HB}/world_1914.geojson`, 1.3e6, "lignes guides 1912-1914", "historical-basemaps, GPL-3.0"],
  ["world_1938.geojson", `${HB}/world_1938.geojson`, 1.6e6, "lignes guides 1936-1938", "historical-basemaps, GPL-3.0"],
];

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} Mo`;

if (process.argv.includes("--list")) {
  for (const [file, url, size, role, licence] of SOURCES) console.log(`${file.padEnd(38)} ${mb(size).padStart(8)}  ${role} — ${licence}\n  ${url}`);
  console.log(`Total : ${mb(SOURCES.reduce((sum, [, , size]) => sum + size, 0))}`);
  process.exit(0);
}

fs.mkdirSync(SOURCES_DIR, { recursive: true });
let bytes = 0;
for (const [file, url] of SOURCES) {
  const target = path.join(SOURCES_DIR, file);
  if (fs.existsSync(target)) { console.log(`déjà là : ${file}`); continue; }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${file} : HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, buffer);
  bytes += buffer.length;
  console.log(`téléchargé : ${file} (${mb(buffer.length)})`);
}
console.log(`Total téléchargé : ${mb(bytes)}`);
