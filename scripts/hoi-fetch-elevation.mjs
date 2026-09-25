#!/usr/bin/env node
// Couche HOI4, phase 4 — télécharge une fois les tuiles d'altitude Terrarium.
//
//   node scripts/hoi-fetch-elevation.mjs
//
// Source : le jeu de données public « Terrain Tiles » d'AWS (Mapzen), sans clé :
//   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/4/{x}/{y}.png
// 256 tuiles au zoom 4, environ 25 Mo, rangées dans server/data/hoi-elevation/.
// Les tuiles déjà là ne sont pas retéléchargées. Le serveur, lui, ne télécharge
// jamais rien : il lit ce dossier s'il existe (server/hoiElevation.js).
//
// Données : Terrain Tiles, © Mapzen et contributeurs (SRTM, GMTED, ETOPO1…),
// licence de réutilisation ouverte : https://github.com/tilezen/joerd/blob/master/docs/attribution.md

import fs from "fs";
import path from "path";
import { ELEVATION_ZOOM, tilePath } from "../server/hoiElevation.js";

const BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const n = 2 ** ELEVATION_ZOOM;
let fetched = 0; let skipped = 0; let bytes = 0;

for (let x = 0; x < n; x += 1) {
  for (let y = 0; y < n; y += 1) {
    const target = tilePath(x, y);
    if (fs.existsSync(target)) { skipped += 1; continue; }
    const response = await fetch(`${BASE}/${ELEVATION_ZOOM}/${x}/${y}.png`);
    if (!response.ok) throw new Error(`tile ${x}/${y}: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    fetched += 1;
    bytes += buffer.length;
  }
  process.stdout.write(`\r${x + 1}/${n} colonnes`);
}
console.log(`\n${fetched} tuiles téléchargées (${(bytes / 1e6).toFixed(1)} Mo), ${skipped} déjà là.`);
