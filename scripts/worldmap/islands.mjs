// Carte mondiale : les noms des îles.
//
// Une province faite d'une île entière (ou de quelques îles entières) porte le
// nom de l'île (Bornholm, Sylt, Pantelleria…), pas celui de la ville la plus
// proche, souvent d'un autre pays (Ystad, Tønder, Kélibia). Sur une grande île
// découpée en plusieurs provinces, une province sans ville prend le nom de la
// ville la plus proche SUR LA MÊME ÎLE, sinon celui de l'île.
//
// D'où viennent les noms d'îles, dans cet ordre :
//   1. Natural Earth, régions géographiques : un contour d'île (« Island ») qui
//      couvre la moitié d'une terre (la Grande-Bretagne, la Sardaigne…) ;
//   2. ISLANDS ci-dessous : un point sur chaque île d'Europe et de Méditerranée
//      que Natural Earth ne nomme pas (vérifiés sur la carte : le rapport de la
//      génération, islands-report.json, dit ce que chaque point a nommé) ;
//      Natural Earth, points d'îles ;
//   3. pour une province faite de plusieurs îles : l'archipel (« Island group »,
//      « Archipelago ») de Natural Earth.
// Noms anglais ou locaux, comme ceux des villes (GeoNames).

// [nom, longitude, latitude] — la plus grande d'abord quand deux îles se
// touchent sur la trame à 0,05° (la première garde l'île).
export const ISLANDS = Object.freeze([
  // Baltique, mer du Nord
  ["Bornholm", 14.92, 55.13], ["Sylt", 8.3, 54.9], ["Föhr", 8.53, 54.72], ["Amrum", 8.35, 54.64], ["Pellworm", 8.64, 54.52],
  ["Fehmarn", 11.15, 54.46], ["Rügen", 13.4, 54.42], ["Hiddensee", 13.1, 54.55], ["Usedom", 14.0, 53.95], ["Wolin", 14.55, 53.9],
  ["Poel", 11.44, 53.99], ["Heligoland", 7.89, 54.18], ["Borkum", 6.7, 53.59], ["Juist", 7.0, 53.68], ["Norderney", 7.2, 53.71],
  ["Langeoog", 7.53, 53.75], ["Spiekeroog", 7.72, 53.77], ["Wangerooge", 7.9, 53.79], ["Texel", 4.8, 53.08], ["Vlieland", 4.97, 53.26],
  ["Terschelling", 5.3, 53.4], ["Ameland", 5.76, 53.45], ["Schiermonnikoog", 6.2, 53.48], ["Rømø", 8.53, 55.13], ["Fanø", 8.41, 55.4],
  ["Læsø", 11.0, 57.26], ["Anholt", 11.56, 56.71], ["Samsø", 10.6, 55.86], ["Funen", 10.4, 55.33], ["Zealand", 11.85, 55.45],
  ["Lolland", 11.4, 54.77], ["Falster", 11.95, 54.8], ["Møn", 12.3, 54.97], ["Als", 9.9, 54.98], ["Langeland", 10.78, 54.9],
  ["Ærø", 10.38, 54.87], ["Öland", 16.6, 56.7], ["Gotland", 18.5, 57.45], ["Fårö", 19.15, 57.93], ["Orust", 11.7, 58.2],
  ["Tjörn", 11.62, 58.0], ["Åland", 19.95, 60.2], ["Hailuoto", 24.72, 65.02], ["Saaremaa", 22.5, 58.4], ["Hiiumaa", 22.6, 58.85],
  ["Muhu", 23.25, 58.6], ["Vormsi", 23.25, 59.0], ["Kotlin", 29.75, 60.01], ["Solovetsky Islands", 35.7, 65.08],
  // Norvège, Arctique, Atlantique Nord
  ["Hinnøya", 16.0, 68.55], ["Senja", 17.4, 69.3], ["Andøya", 15.95, 69.1], ["Langøya", 15.0, 68.72], ["Kvaløya", 18.6, 69.7],
  ["Ringvassøya", 19.2, 69.95], ["Sørøya", 22.4, 70.6], ["Magerøya", 25.8, 71.0], ["Vestvågøy", 13.8, 68.2], ["Austvågøy", 14.5, 68.35],
  ["Moskenesøya", 13.05, 67.95], ["Flakstadøya", 13.3, 68.08], ["Hitra", 8.85, 63.55], ["Frøya", 8.7, 63.72], ["Smøla", 8.0, 63.4],
  ["Averøya", 7.6, 63.05], ["Karmøy", 5.25, 59.25], ["Stord", 5.45, 59.8], ["Bømlo", 5.2, 59.75], ["Sotra", 5.0, 60.3],
  ["Spitsbergen", 16.0, 78.5], ["Nordaustlandet", 22.5, 79.8], ["Bear Island", 19.0, 74.45], ["Jan Mayen", -8.5, 71.0],
  ["Iceland", -18.5, 64.9], ["Streymoy", -7.0, 62.1], ["Eysturoy", -6.9, 62.2], ["Vágar", -7.25, 62.08], ["Suðuroy", -6.85, 61.5],
  ["Sandoy", -6.8, 61.83], ["Kolguyev", 49.0, 69.1],
  // Îles Britanniques
  ["Isle of Wight", -1.3, 50.67], ["Anglesey", -4.35, 53.27], ["Isle of Man", -4.52, 54.23], ["Jersey", -2.13, 49.21],
  ["Guernsey", -2.58, 49.45], ["Alderney", -2.2, 49.71], ["Isles of Scilly", -6.32, 49.93], ["Arran", -5.23, 55.58], ["Islay", -6.2, 55.78],
  ["Jura", -5.92, 55.93], ["Mull", -5.95, 56.45], ["Skye", -6.2, 57.3], ["Lewis and Harris", -6.6, 58.1], ["North Uist", -7.3, 57.6],
  ["South Uist", -7.32, 57.25], ["Tiree", -6.88, 56.5], ["Coll", -6.55, 56.64], ["Orkney Mainland", -3.1, 59.0],
  ["Shetland Mainland", -1.25, 60.3], ["Achill", -10.0, 53.95], ["Aran Islands", -9.72, 53.12],
  // France
  ["Corsica", 9.05, 42.15], ["Ushant", -5.1, 48.46], ["Belle-Île", -3.18, 47.33], ["Groix", -3.46, 47.64], ["Noirmoutier", -2.25, 46.98],
  ["Île d'Yeu", -2.35, 46.71], ["Île de Ré", -1.42, 46.2], ["Oléron", -1.3, 45.92], ["Porquerolles", 6.2, 43.0],
  // Italie, Malte
  ["Sicily", 14.2, 37.5], ["Sardinia", 9.0, 40.0], ["Elba", 10.25, 42.77], ["Capraia", 9.83, 43.05], ["Giglio", 10.9, 42.36],
  ["Montecristo", 10.31, 42.33], ["Ischia", 13.9, 40.73], ["Capri", 14.24, 40.55], ["Procida", 14.02, 40.76], ["Ponza", 12.96, 40.9],
  ["Ustica", 13.18, 38.71], ["Lipari", 14.95, 38.48], ["Vulcano", 14.96, 38.39], ["Salina", 14.84, 38.56], ["Stromboli", 15.21, 38.79],
  ["Filicudi", 14.57, 38.57], ["Alicudi", 14.35, 38.54], ["Panarea", 15.07, 38.64], ["Favignana", 12.33, 37.93], ["Levanzo", 12.34, 38.0],
  ["Marettimo", 12.06, 37.97], ["Pantelleria", 11.95, 36.78], ["Lampedusa", 12.58, 35.51],
  ["San Pietro", 8.28, 39.14], ["Sant'Antioco", 8.43, 39.03], ["La Maddalena", 9.4, 41.23], ["Caprera", 9.46, 41.2],
  ["Asinara", 8.27, 41.07], ["Tremiti Islands", 15.5, 42.12], ["Malta", 14.44, 35.88], ["Gozo", 14.25, 36.04],
  // Espagne, Portugal, Atlantique
  ["Majorca", 2.95, 39.62], ["Minorca", 4.1, 39.95], ["Ibiza", 1.43, 38.98], ["Formentera", 1.45, 38.7], ["Cabrera", 2.93, 39.15],
  ["Tenerife", -16.6, 28.28], ["Gran Canaria", -15.6, 27.95], ["Lanzarote", -13.63, 29.04], ["Fuerteventura", -14.0, 28.4],
  ["La Palma", -17.85, 28.68], ["La Gomera", -17.23, 28.1], ["El Hierro", -18.0, 27.75], ["Madeira", -16.95, 32.75],
  ["Porto Santo", -16.33, 33.07], ["São Miguel", -25.45, 37.78], ["Terceira", -27.22, 38.72], ["Pico", -28.3, 38.47],
  ["Faial", -28.7, 38.58], ["São Jorge", -28.05, 38.65], ["Flores", -31.2, 39.45], ["Santa Maria", -25.1, 36.97],
  ["Graciosa", -28.02, 39.05], ["Corvo", -31.1, 39.7],
  // Adriatique
  ["Krk", 14.6, 45.08], ["Cres", 14.4, 44.95], ["Lošinj", 14.45, 44.57], ["Rab", 14.75, 44.77], ["Pag", 14.95, 44.5],
  ["Dugi Otok", 15.05, 44.0], ["Ugljan", 15.1, 44.08], ["Pašman", 15.3, 43.95], ["Brač", 16.65, 43.32], ["Hvar", 16.75, 43.15],
  ["Šolta", 16.3, 43.38], ["Vis", 16.15, 43.05], ["Korčula", 16.9, 42.95], ["Lastovo", 16.88, 42.76], ["Mljet", 17.55, 42.75],
  // Grèce, Turquie
  ["Crete", 24.9, 35.25], ["Euboea", 23.8, 38.55], ["Corfu", 19.85, 39.6], ["Paxos", 20.17, 39.2], ["Lefkada", 20.65, 38.72],
  ["Kefalonia", 20.55, 38.25], ["Ithaca", 20.7, 38.4], ["Zakynthos", 20.8, 37.78], ["Kythira", 23.0, 36.25], ["Aegina", 23.5, 37.72],
  ["Salamis", 23.47, 37.94], ["Hydra", 23.45, 37.34], ["Spetses", 23.15, 37.26], ["Skyros", 24.55, 38.85], ["Skiathos", 23.47, 39.16],
  ["Skopelos", 23.7, 39.12], ["Alonissos", 23.85, 39.18], ["Thasos", 24.7, 40.68], ["Samothrace", 25.55, 40.47], ["Lemnos", 25.25, 39.9],
  ["Lesbos", 26.3, 39.2], ["Chios", 26.0, 38.4], ["Samos", 26.8, 37.72], ["Ikaria", 26.15, 37.6], ["Fourni", 26.47, 37.58], ["Patmos", 26.55, 37.32],
  ["Leros", 26.84, 37.15], ["Kalymnos", 26.97, 36.98], ["Kos", 27.15, 36.85], ["Nisyros", 27.16, 36.59], ["Tilos", 27.38, 36.44],
  ["Symi", 27.83, 36.6], ["Rhodes", 28.0, 36.2], ["Karpathos", 27.15, 35.6], ["Kasos", 26.92, 35.39], ["Astypalaia", 26.35, 36.58],
  ["Gavdos", 24.08, 34.84], ["Andros", 24.85, 37.85], ["Tinos", 25.15, 37.6], ["Mykonos", 25.35, 37.45], ["Syros", 24.93, 37.45],
  ["Kea", 24.33, 37.62], ["Kythnos", 24.42, 37.4], ["Serifos", 24.48, 37.15], ["Sifnos", 24.7, 36.98], ["Milos", 24.42, 36.7],
  ["Paros", 25.15, 37.05], ["Naxos", 25.5, 37.05], ["Ios", 25.3, 36.72], ["Amorgos", 25.9, 36.83], ["Santorini", 25.43, 36.4],
  ["Anafi", 25.77, 36.36], ["Folegandros", 24.92, 36.62], ["Imbros", 25.85, 40.17], ["Tenedos", 26.05, 39.83],
  ["Marmara Island", 27.6, 40.62],
  // Méditerranée orientale et méridionale
  ["Cyprus", 33.2, 35.05], ["Djerba", 10.88, 33.8], ["Kerkennah", 11.18, 34.72],
]);

// Une « île » : une terre d'un seul tenant plus petite que ceci (la
// Grande-Bretagne en fait 209 000 km², l'Europe continentale bien plus).
export const ISLAND_MAX_KM2 = 300_000;
// Une province est « faite d'îles entières » quand chacune de ses îles lui
// appartient à 90 % au moins, et que ces îles font 90 % de sa terre.
const WHOLE = 0.9;
// Une île qui fait la moitié de la province lui donne son nom ; sinon l'archipel.
const DOMINANT = 0.5;
// Un archipel plus vaste que ceci n'est pas un nom de province (« British Isles »).
const GROUP_MAX_KM2 = 20_000;
// Une île que la trame soude au continent (Rügen, Fehmarn…) : son point nomme
// la province qui le contient si elle est petite, sans ville, et centrée près du point.
const ATTACHED_MAX_KM2 = 2_000;
// Le centre de la province à moins de 0,6 × √surface du point (une province de
// 1 300 km² : 22 km), pour qu'une province du continent ne prenne pas le nom
// d'une île voisine.
const ATTACHED_REACH = 0.6;
// En dessous, une terre est nommée d'après la liste avant Natural Earth.
const LIST_FIRST_KM2 = 5_000;

// « BRITISH ISLES », « Shetland Is. » → « British Isles », « Shetland Islands ».
export const tidyName = (name) => {
  let out = String(name ?? "").trim().replace(/\bIs\.$/, "Islands").replace(/\bI\.$/, "Island");
  if (out && out === out.toUpperCase()) out = out.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  return out;
};

// labels : province de chaque case ; comp/compKm2 : terres d'un seul tenant
// (lib/refine.mjs landComponents) ; islandRaster/groupRaster : contours
// d'îles et d'archipels de Natural Earth (numéros dans islandNames/groupNames) ;
// points : [nom, lng, lat] des points d'îles de Natural Earth.
// provinces[l - 1] : { name, city, empty } ; nearestCityOn(comp, [lng, lat]) :
// la ville la plus proche sur cette terre, ou "".
export const nameIslands = ({
  N, land, labels, comp, compKm2, cellNear, islandRaster, islandNames, groupRaster, groupNames, groupKm2, points, provinces, nearestCityOn,
}) => {
  const count = provinces.length;
  // Cases de chaque province par terre ; cases de chaque terre.
  const perProvince = Array.from({ length: count + 1 }, () => new Map());
  const compCells = new Map();
  const polyCells = new Map(); // contour d'île → cases de terre
  const compIsland = new Map(); // terre → Map(numéro de contour d'île → cases)
  const provinceGroup = Array.from({ length: count + 1 }, () => new Map());
  for (let c = 0; c < N; c += 1) {
    if (!land[c]) continue;
    const k = comp[c]; const l = labels[c];
    compCells.set(k, (compCells.get(k) ?? 0) + 1);
    if (islandRaster[c]) {
      polyCells.set(islandRaster[c], (polyCells.get(islandRaster[c]) ?? 0) + 1);
      if (!compIsland.has(k)) compIsland.set(k, new Map());
      const m = compIsland.get(k); m.set(islandRaster[c], (m.get(islandRaster[c]) ?? 0) + 1);
    }
    if (!l) continue;
    const m = perProvince[l]; m.set(k, (m.get(k) ?? 0) + 1);
    if (groupRaster[c]) provinceGroup[l].set(groupRaster[c], (provinceGroup[l].get(groupRaster[c]) ?? 0) + 1);
  }
  const isIsland = (k) => compKm2[k] < ISLAND_MAX_KM2;

  // Le nom de chaque île.
  const compName = new Map(); const source = new Map(); const attached = [];
  // Les petites terres d'abord d'après la liste (les contours de Natural Earth
  // y sont approximatifs : Texel sous le nom de Vlieland), les grandes d'après
  // Natural Earth (la Grande-Bretagne, que la trame soude à Anglesey et à Wight).
  for (const [name, lng, lat] of ISLANDS) {
    const c = cellNear(lng, lat);
    const k = c >= 0 ? comp[c] : 0;
    if (!k || !isIsland(k) || compKm2[k] > LIST_FIRST_KM2 || compName.has(k)) continue;
    compName.set(k, name); source.set(k, "liste");
  }
  for (const [k, votes] of compIsland) {
    if (compName.has(k) || !isIsland(k)) continue;
    const [best, n] = [...votes].sort((a, b) => b[1] - a[1])[0];
    // Le contour couvre la moitié de cette terre, et cette terre la moitié du
    // contour (un éclat de côte ne prend pas le nom de Chypre).
    if (n >= compCells.get(k) * 0.5 && n >= polyCells.get(best) * 0.5) { compName.set(k, tidyName(islandNames[best])); source.set(k, "Natural Earth (contour)"); }
  }
  for (const [name, lng, lat] of ISLANDS) {
    const c = cellNear(lng, lat);
    const k = c >= 0 ? comp[c] : 0;
    if (!k || !isIsland(k)) { attached.push({ name, lng, lat, cell: c, reason: k ? "soudée au continent sur la trame" : "pas de terre à 4 cases" }); continue; }
    if (compName.get(k) === name) continue;
    if (compName.has(k)) { attached.push({ name, lng, lat, cell: c, reason: `même terre que ${compName.get(k)}` }); continue; }
    compName.set(k, name); source.set(k, "liste");
  }
  for (const [name, lng, lat] of points) {
    const c = cellNear(lng, lat);
    const k = c >= 0 ? comp[c] : 0;
    if (!k || !isIsland(k) || compName.has(k)) continue;
    compName.set(k, tidyName(name)); source.set(k, "Natural Earth (point)");
  }

  // Les îles soudées au continent (ou à une autre île) sur la trame.
  const attachedName = new Map(); const unmatched = []; const conflicts = [];
  for (const a of attached) {
    const l = a.cell >= 0 ? labels[a.cell] : 0;
    const p = l ? provinces[l - 1] : null;
    const farKm = p ? 111.32 * Math.hypot((p.center[0] - a.lng) * Math.cos((a.lat * Math.PI) / 180), p.center[1] - a.lat) : Infinity;
    if (!p || p.empty || p.city || p.areaKm2 > ATTACHED_MAX_KM2 || farKm > ATTACHED_REACH * Math.sqrt(p.areaKm2)) { unmatched.push({ ...a, province: p?.name ?? "" }); continue; }
    if (attachedName.has(l)) { conflicts.push({ name: a.name, keptName: attachedName.get(l) }); continue; }
    attachedName.set(l, a.name);
  }
  const renamed = [];
  for (let l = 1; l <= count; l += 1) {
    const p = provinces[l - 1];
    if (!p || p.empty) continue;
    const cells = perProvince[l];
    const total = [...cells.values()].reduce((a, b) => a + b, 0);
    if (!total) continue;
    const [home] = [...cells].sort((a, b) => b[1] - a[1])[0];
    if (attachedName.has(l)) {
      renamed.push({ id: l, name: attachedName.get(l), before: p.name, source: "liste (île soudée au continent sur la trame)", km2: p.areaKm2, center: p.center, country: p.country, island: attachedName.get(l) });
      p.name = attachedName.get(l); p.island = true;
      continue;
    }
    if (!isIsland(home)) continue;
    const whole = [...cells].filter(([k, n]) => isIsland(k) && n >= compCells.get(k) * WHOLE);
    const wholeCells = whole.reduce((a, [, n]) => a + n, 0);
    const before = p.name;
    let name = ""; let from = "";
    if (wholeCells >= total * WHOLE) {
      const [top, topCells] = whole.sort((a, b) => b[1] - a[1])[0];
      // La plus grande île nommée (un îlot sans nom ne cache pas l'île voisine).
      const named = whole.find(([k]) => compName.has(k));
      if (named && (topCells >= total * DOMINANT || named[1] >= total * DOMINANT || whole.length === 1 || !compName.has(top))) {
        name = compName.get(named[0]); from = source.get(named[0]) ?? "";
      }
      if (!name) {
        const group = [...provinceGroup[l]].sort((a, b) => b[1] - a[1])[0];
        if (group && group[1] >= total * 0.5 && groupKm2[group[0]] <= GROUP_MAX_KM2) { name = tidyName(groupNames[group[0]]); from = "Natural Earth (archipel)"; }
        else if (compName.has(top)) { name = compName.get(top); from = source.get(top); }
      }
    } else if (!p.city && compName.has(home) && compKm2[home] <= LIST_FIRST_KM2 && cells.get(home) >= compCells.get(home) * 0.5) {
      // Sans ville, et la plus grande part de son île (Sylt, dont un bout est
      // chez la voisine) : le nom de l'île.
      name = compName.get(home); from = source.get(home);
    } else if (!p.city) {
      // Une partie d'une plus grande île, sans ville : la ville de l'île la plus
      // proche, sinon le nom de l'île.
      name = nearestCityOn(l, home, p.anchor ?? p.center) || compName.get(home) || "";
      from = name && name === compName.get(home) ? source.get(home) : "ville de la même île";
    }
    if (!name || name === p.name) {
      renamed.push({ id: l, name: p.name, before, source: name ? from : "", km2: p.areaKm2, center: p.center, country: p.country, island: compName.get(home) ?? "" });
      continue;
    }
    p.name = name; p.island = true;
    renamed.push({ id: l, name, before, source: from, km2: p.areaKm2, center: p.center, country: p.country, island: compName.get(home) ?? "" });
  }
  return { provinces: renamed, conflicts, unmatched, named: compName.size };
};
