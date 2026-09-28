# Couche HOI4 — fork Open Historia

Ce fork ajoute sous la narration d'Open Historia une couche de gestion façon Hearts of Iron IV : ressources, production, puis technologies, focus, armées et fronts. Principe : **l'IA raconte, le moteur compte**.

## État : phase 4

| Élément | Fichier | Statut |
| --- | --- | --- |
| Moteur économie / production | `src/runtime/hoi/engine.js` | Fait, fonctions pures |
| Valeurs de départ 1936 et 1912, base neutre | `src/runtime/hoi/presets.js` | Fait |
| Opérations IA `economyOps` | `src/runtime/hoi/economyOps.js` | Fait, bornées |
| Moteur de recherche | `src/runtime/hoi/research.js` | Fait (phase 2) |
| Arbre de recherche : validation, équipements, installation | `src/runtime/hoi/techTree.js` | Fait (phase 2) |
| Arbres de secours 1936 et 1912 | `src/runtime/hoi/techTreePresets.js` | Fait (phase 2) |
| Arbre écrit par l'IA | `gameplay.js` (`generateHoiTechTree`, `ensureHoiTechTree`), tâche `hoiTechTree` | Fait (phase 2) |
| Tests de la couche | `src/runtime/hoi/*.test.js`, `src/Game/AI/economyOpsWiring.test.js` | 72 tests, passent |
| Activation au lancement | case « HOI4 layer » à l'étape de la difficulté (`libraryBar.jsx`) | Fait |
| Bloc `[ÉCONOMIE]` dans le tour | `promptContext.js` (`economySummary`) → `gameplay.js` (`[Economy Layer]`) | Fait, avec la recherche |
| Application dans le tour | `applySimulationResult` : `economyOps` puis `advanceHoiLayer` | Fait |
| Panneau « Production » | `src/Game/GameUI/production.jsx`, 4ᵉ bouton du dock | Fait, réaffectation des usines |
| Panneau « Recherche » | `src/Game/GameUI/research.jsx`, 5ᵉ bouton du dock | Fait (phase 2) |
| Bâtiments et construction | `src/runtime/hoi/buildings.js`, `constructionOps.js` | Fait (phase 3) |
| Icônes des bâtiments sur la carte | `src/Game/Map/buildingIcons.js`, `MarkersLayer.jsx` | Fait (phase 3) |
| Fiche au clic | `src/Game/Selection/Features.jsx` | Fait (phase 3), stats du bâtiment |
| Section « Construction » | `src/Game/GameUI/construction.jsx`, dans le panneau Production | Fait (phase 3), sites par province (phase 4) |
| Provinces : génération, terrain, cache | `server/hoiProvinceGen.js`, `hoiTerrain.js`, `hoiElevation.js`, `hoiProvinces.js` | Fait (phase 4) |
| Provinces dans le jeu : carte, emplacements, choix sur la carte | `src/Game/Map/ProvincesLayer.jsx`, `hoiProvinceStore.js`, `src/runtime/hoi/provinces.js` | Fait (phase 4) |

La couche est **inerte** tant qu'une partie n'a pas de `world.hoi` : une partie Open Historia ordinaire ne change pas. Elle ne voit ni le bloc `[ÉCONOMIE]`, ni `economyOps` dans l'outil du tour (26 363 caractères, comme avant), ni les boutons Production et Recherche, et ne déclenche jamais la tâche `hoiTechTree`.

## Activer la couche

Nouvelle partie → choisir un pays → à l'étape de la difficulté, cocher **HOI4 layer (economy & production)**.

- La série de valeurs de départ suit la date de départ : **1912** pour 1900–1925, **1936** pour 1926–1950, base neutre partout ailleurs.
- 1936 détaille l'Allemagne, la France, le Royaume-Uni, l'URSS, les États-Unis, l'Italie, le Japon et la Chine nationaliste.
- 1912 détaille les empires allemand, britannique, russe, austro-hongrois et ottoman, la France, l'Italie, les États-Unis et le Japon.
- Un pays est reconnu par son nom sur la carte (`world.ownerCodes`) ou un alias : « Germany » en 1936, « German Empire » en 1911.
- Tous les autres pays, y compris une faction créée par le joueur, reçoivent une petite économie neutre.

## Ce que fait le moteur à chaque saut

1. Il applique d'abord les `economyOps` des événements du tour (voir plus bas).
2. Il calcule le nombre de jours entre l'ancienne et la nouvelle date du jeu (6 h à 1 an, ou saut auto).
3. Il découpe les longs sauts en tranches de 30 jours maximum.
4. Pour chaque nation : extraction des ressources, consommation par les lignes de production, production d'équipement, montée de l'efficacité, expiration des modificateurs (grève, bonus).
5. Une pénurie réduit la production au prorata de la ressource la plus manquante ; un stock ne devient jamais négatif.
6. Il écrit un rapport (`world.hoi.lastReport`), que le bloc `[ÉCONOMIE]` du tour suivant résume.

Tous les réglages d'équilibrage sont dans `HOI_TUNING` (`engine.js`) et `ECONOMY_OP_LIMITS` (`economyOps.js`). Les valeurs de départ sont dans `presets.js`.

## Ce que l'IA peut faire : `economyOps`

Un événement peut porter `impacts.economyOps`, sur **n'importe quel pays suivi**, rivaux compris.

| Opération | Effet | Garde-fous |
| --- | --- | --- |
| `modifier` | grève, contrat, sabotage, blocus : production ± pendant une durée | −50 % à +50 % ; 1 à 365 jours (30 par défaut) ; même `label` = remplace, ne s'additionne pas ; 8 au plus par pays ; refusé sans date valide |
| `stock` | don, saisie, achat ponctuel d'une ressource | au plus max(25 % du stock, 1 mois d'extraction, 5) ; jamais sous zéro |
| `line` | réaffecter les usines militaires d'une ligne, ou en ouvrir une | borné par les usines militaires libres ; une nouvelle ligne seulement pour un équipement de base ou débloqué par une tech que ce pays a acquise ; les usines ajoutées font baisser l'efficacité |
| `research` | plans volés, défection, coopération : avance sur une tech | tech disponible pour ce pays ; au plus 25 % de son coût ; ne la termine jamais d'un coup |

Un pays inconnu est refusé. Chaque valeur ramenée dans ses bornes ou refusée est notée dans le reçu d'application, que l'IA lit au tour suivant. Le joueur, dans le panneau Production, passe par la même opération `line` et les mêmes bornes.

## Les technologies (phase 2)

**L'arbre.** Au chargement d'une partie HOI4 qui n'en a pas (nouvelle partie, ou partie de la phase 1), une seule requête `hoiTechTree` demande à l'IA un arbre de 25 à 45 techs en cinq branches : infanterie, artillerie, blindés, aviation, industrie. Le modèle utilisé se choisit dans les réglages de l'IA, sous « HOI4 tech tree ». Si l'IA ne répond pas ou si son arbre est inutilisable (moins de 12 techs après validation), l'arbre de secours de la série est installé : 28 techs pour 1936, 22 pour 1912. Pour une autre époque sans réponse de l'IA, la partie reste sans technologies, et le prochain chargement réessaie.

**La validation** (`techTree.js`), qui s'applique à l'arbre de l'IA comme à ceux de secours :
- identifiants uniques et branches connues ;
- années ramenées entre 25 ans avant et 15 ans après le départ ;
- coûts entre 30 et 720 jours ;
- prérequis existants et sans boucle ;
- ressources de la partie seulement ;
- au plus 60 techs.

**Les effets d'une tech**, tous bornés :

| Effet | Bornes |
| --- | --- |
| Nouvel équipement (`unlock`) | coût 0,1 à 60 ; 1 à 3 ressources |
| Plafond d'efficacité des lignes (`efficiency`) | +1 à +5 % par tech, +9 % au total |
| Extraction d'une ressource (`extraction`) | +5 à +30 % ; sur une ressource que le pays n'extrait pas encore, value × 10 par mois |
| Coût d'un équipement (`cost`) | −5 à −25 % par tech, jamais sous la moitié du coût d'origine |

**La recherche** (`research.js`) :
- **Emplacements** : 1, plus un à 10, 20 et 30 usines civiles, soit 4 au plus.
- **Coût** : il est en jours de travail. Une tech en avance sur son époque coûte 50 % de plus par année d'avance, jusqu'à ×3.
- **Arrêter** une recherche garde son avancement.
- **Au départ**, un pays détaillé de la série reçoit les techs antérieures à l'année de la partie ; les autres pays, celles d'au moins 3 ans plus tôt. Ces techs n'ont pas d'effet chiffré, car les valeurs de départ en tiennent déjà compte.

**Qui choisit** : le moteur choisit seul pour tous les pays sauf le joueur. Il prend d'abord ce qui touche ce que le pays produit, puis l'industrie, puis la tech la moins chère. Le joueur choisit dans le panneau Recherche ; un emplacement laissé vide ne cherche rien.

**Dans le tour** : le bloc `[ÉCONOMIE]` indique les recherches en cours, les techs acquises au dernier saut, les équipements débloqués, et ceux qui ne le sont **pas encore**, que l'IA ne doit pas faire apparaître.

## Les bâtiments (phase 3)

**Ce qu'est un bâtiment.** Une structure de la carte qui porte `building` : type, niveau, état (0 à 100 %), chantier en cours. Le propriétaire est celui de la structure.

| Type | Effet par niveau | Niveau max | Coût (points) |
| --- | --- | --- | --- |
| Complexe industriel (de départ) | ses usines civiles et militaires | 1 | — |
| Usine civile | +1 usine civile | 5 | 10 800 |
| Usine militaire | +1 usine militaire | 5 | 7 200 |
| Raffinerie | +3 pétrole par mois | 3 | 6 000 |
| Raffinerie synthétique | +2 caoutchouc par mois | 3 | 8 000 |
| Aciérie | +4 acier par mois | 3 | 7 000 |
| Mine | +3 d'une ressource par mois | 3 | 4 000 |
| Fort, radar, aérodrome, port | niveau lu par l'IA (pas encore de combat) | 3 à 5 | 1 500 à 4 000 |

Un bâtiment produit au prorata de son état, et plus rien sous 25 %. Les techs peuvent réserver la raffinerie, la raffinerie synthétique, l'aciérie, le radar et l'aérodrome ; les usines, mines, forts et ports sont toujours constructibles.

**L'installation**, une fois par partie au chargement :
- les usines de départ des pays détaillés deviennent des complexes industriels dans leurs vrais bassins industriels (Paris, Lille, Lyon, Saint-Étienne ; la Ruhr, Berlin, Hambourg, Munich ; Détroit, Pittsburgh…), bombardables ;
- les autres pays gardent leurs usines abstraites ;
- les structures déjà sur la carte reçoivent un type, niveau 1, sans effet économique pour ce qui était déjà compté.

**La construction.**
- Chaque usine civile donne 5 points par jour ; 20 % des usines civiles vont aux biens de consommation (`BUILDING_TUNING`).
- 15 usines au plus travaillent sur un même chantier (75 points par jour).
- Les réparations passent d'elles-mêmes et en premier : une réparation complète coûte la moitié du coût d'un niveau, par niveau.
- Le joueur bâtit dans la section Construction du panneau Production : sur un bassin industriel de son pays, une ville que le scénario place lui-même dans une de ses régions, ou une de ses structures. Il peut aussi agrandir, réordonner et annuler.
- Les pays gérés par le moteur agrandissent une usine, ou en bâtissent une à côté de leurs complexes, un chantier à la fois.

**L'IA.**
- Une structure qu'elle raconte (« une raffinerie ouvre à Leuna ») reçoit un type d'après son nom et entre dans la file de chantiers de son propriétaire : jamais de bâtiment offert.
- Un bombardement ou un sabotage est une `economyOps` `damage` : cible = nom exact de la structure, de 10 à 50 % d'état.
- Un `markerOps` « damaged » ou « destroyed » devient un état chiffré (60 % au plus, ou 0).
- Le bloc `[ÉCONOMIE]` décrit les bâtiments, les chantiers, les dégâts et ce qui a été terminé.

## Les provinces (phase 4)

Les régions restent les États (les transferts de territoire de l'IA ne changent pas) ; chacune est découpée en provinces, qui portent le terrain, les emplacements de construction et les voisinages des futurs fronts.

- **Génération, sur le serveur** : `server/hoiProvinceGen.js`. Graines sur les plus grandes villes, complétées au plus loin, 3 passes de Lloyd, cellules de Voronoï coupées au contour de la région. Plus fin près des villes, plus grossier dans le vide : 10 000 km² en moyenne au départ, réglable dans `PROVINCE_TUNING`.
- **Noms** : la ville principale de la province, sinon « Région – n ». Quand la région n'a qu'un code pour nom (« Province #114499 », cas de tout le scénario WW2+), sa plus grande ville en tient lieu, sinon la ville la plus proche ; les noms restent uniques sur la carte.
- **Cache** : `server/hoiProvinces.js` écrit `server/data/hoi-provinces/<clé>.json`, refait seulement quand les régions, les villes, les tuiles d'altitude ou les réglages changent. Servi par `GET /api/hoi/provinces`. Scénario WW2+ : 6 963 provinces, 6 s la première fois, 8,5 Mo. Chaque province porte aussi son propriétaire de départ (celui de sa région) et un point où bâtir (sa ville, sinon un point intérieur).
- **Terrain** : `server/hoiTerrain.js`, à partir de l'**altitude réelle** (moyenne, relief, maximum sur une grille de points de la province), de la latitude et de quelques zones (déserts, marais). Sans les tuiles, une règle simple par zones prend le relais. Emplacements : urbain 5, plaine 3, forêt et colline 2, le reste 1, plus 1 par tranche de 200 000 habitants.

### Données d'altitude

Tuiles téléchargées une fois, à la main, par `node scripts/hoi-fetch-elevation.mjs` (256 images PNG, zoom 4, environ 18 Mo, dans `server/data/hoi-elevation/`, non versionnées). Le serveur ne télécharge jamais rien.

> **Source** : Terrain Tiles d'Amazon Web Services (format Terrarium), © Mapzen et contributeurs, à partir de SRTM, GMTED2010, ETOPO1 et d'autres jeux de données publics. Licence ouverte, attribution détaillée : <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.

### Recalage du scénario WW2+

La carte du scénario WW2+ (`server/data/scenarios/hoi4-states-copy-copy-2/`) venait d'une image de HOI4 étalée entre 65° S et 65° N : Paris tombait en mer et Berlin en Suède. `scripts/hoi-georeference.mjs` la recale sur les frontières actuelles de la carte de base, en trois temps :

1. une cinquantaine de pays au territoire stable depuis 1936, mesurés en cinq points (centre, bords) : polynôme de degré 3 ;
2. une correction locale par pays (gaussienne, σ = 5°) ;
3. un affinage par les **côtes** et les **frontières restées les mêmes depuis 1936** (États-Unis–Canada, France–Suisse, Espagne–Portugal…) : 12 passes où chaque point de côte ou de frontière du scénario est tiré vers le même genre de point sur la carte réelle, lissées en un champ de correction (σ = 1°).

Vérification sur 43 villes du monde entier : 39 tombent dans leur pays ; les 4 autres sont à moins de 12 km du leur, là où les contours en pixels de HOI4 s'écartent de la réalité (Istanbul et Rio de Janeiro au bord de l'eau, Montréal et Toronto contre la frontière). Écart moyen restant aux côtes : 0,16°. Relancer le script repart toujours des contours d'origine.

```bash
node --max-old-space-size=6144 scripts/hoi-georeference.mjs hoi4-states-copy-copy-2           # mesure seulement
node --max-old-space-size=6144 scripts/hoi-georeference.mjs hoi4-states-copy-copy-2 --apply   # réécrit, avec sauvegarde
```

Copies d'origine, à côté des fichiers : `regions.geojson.avant-recalage-2026-09-25T12-26-55-267Z`, `regions.coarse.geojson.avant-recalage-…` et `regions.coarse.geojson.stamp.avant-recalage-…`. Pour revenir en arrière, les renommer sans le suffixe.

Au chargement d'une partie, un complexe industriel de départ revient aux vraies coordonnées de son bassin si ce point est chez son pays ; tout autre bâtiment qui ne tombe pas sur une terre de son propriétaire est ramené au point le plus proche de son territoire (`snapHoiBuildingsToTerritory` dans `gameplay.js`).

### Dans le jeu

- **Carte** (`src/Game/Map/ProvincesLayer.jsx`) : les limites des provinces, fines, à partir du zoom 5, sous les frontières des États. Chargées une fois par partie (`hoiProvinceStore.js`).
- **Propriétaire** : celui de la région, changements de la partie compris (`regionOwnershipOverrides`) ; un transfert de région par l'IA emporte donc ses provinces.
- **Construction** : le site d'un chantier est une province du joueur, choisie dans la liste (nom · emplacements pris/total) ou avec « Choisir sur la carte » : ses provinces s'éclairent, celle sous la souris aussi, un clic la choisit, Échap annule. Sous la liste : terrain, emplacements libres, côte.
- **Emplacements** (`src/runtime/hoi/provinces.js`) : usines, aciéries, raffineries et mines en prennent un par niveau (un chantier compte déjà) ; le complexe de départ en prend un ; forts, radars, aérodromes et ports aucun. Une province pleine refuse une usine neuve ou un agrandissement ; un port demande une province côtière. Les bâtiments déjà en trop restent.
- **Fiche d'un bâtiment** : sa province, son terrain, ses emplacements pris.

### Performances

- Découpage en tuiles par la carte (MapLibre, fait une fois, dans un fil à part) : environ 0,1 s pour les 7 000 provinces ; une vue de la France à zoom 6, environ 13 000 points de contour.
- Quatre fois plus fin (≈ 2 500 km²) : 0,27 s et 53 000 points, sans souci pour l'affichage. La limite est plutôt le fichier (8,5 Mo aujourd'hui, environ 34 Mo quatre fois plus fin), chargé à l'ouverture de la partie. Deux fois plus fin reste raisonnable : `targetKm2: 5000` dans `PROVINCE_TUNING`.

## La carte mondiale unique (phase 5, en cours)

Modèle de HOI4 : une seule carte de provinces, géographiquement juste, commune à tous les scénarios ; un scénario ne fera plus qu'attribuer les provinces à des pays et à des états. La génération par scénario de la phase 4 sera retirée une fois la bascule faite.

### Étape A : la carte (faite, poussée)

Générée une fois, hors du jeu et hors du dépôt, dans `server/data/worldmap/` :

```bash
node scripts/worldmap/fetch-sources.mjs                         # sources, ≈ 35 Mo
node scripts/hoi-fetch-elevation.mjs --zoom 5                   # altitude, ≈ 65 Mo
node --max-old-space-size=12000 scripts/worldmap/build.mjs      # ≈ 6 minutes
node scripts/worldmap/render.mjs -11 35 31 61 europe.png 1800   # un aperçu
```

- **Trame de travail** : 0,05° (≈ 5 km), de 58° S à 84° N (sans l'Antarctique).
- **Graines** : environ 13 000, plus serrées là où vivent les gens. Les villes de GeoNames servent, sans les quartiers : une « ville » à moins de 10 km d'une ville deux fois plus peuplée lui ajoute sa population.
- **Croissance** : chaque province s'étend au moindre coût. Le relief freine, les fleuves freinent, et un bruit rend les bordures irrégulières.
- **Très grands fleuves** : ils sont infranchissables, donc ils font frontière. Ce sont le Rhin, le Danube, la Vistule, l'Oder, l'Elbe, le Dniepr, le Don, la Volga, la Loire, le Nil, le Tigre, l'Euphrate, le Mississippi, le Saint-Laurent, le Yangzi, le Fleuve Jaune, le Mékong, l'Amazone, le Paraná, le Congo, le Niger, le Gange et l'Indus.
- **Lignes guides** : des « murs » que les provinces ne franchissent pas.
  - Les frontières d'aujourd'hui (Natural Earth) en sont toujours.
  - Celles de 1938, 1914 et 1200 (historical-basemaps) n'en deviennent que si elles ne doublent pas, à moins de 30 km, une frontière déjà tracée, et si elles ne sont pas schématiques (un trait droit de plus de 120 km).
  - Elles sont ondulées d'environ 25 km, l'ordre de grandeur de leur imprécision.
- **Retouches** (`scripts/worldmap/lib/refine.mjs`) :
  - une petite île (moins de 3 000 km²) n'est jamais coupée, sauf par une frontière d'aujourd'hui ;
  - les poussières d'îles de même histoire se regroupent par archipel ;
  - une province en lanière rejoint sa voisine, sauf à travers un mur ou un très grand fleuve ;
  - les numéros sont refaits selon une courbe de Hilbert.
- **Contours** : les limites sont suivies en arcs partagés (ni trou ni chevauchement), lissées puis rendues irrégulières. Les côtes sont découpées sur Natural Earth 10 m.
- **Sorties** (`server/data/worldmap/v1/`) :
  - `provinces.geojson` ;
  - `provinces.json` : nom, ville, terrain, emplacements, côte, surface, population, point où bâtir, altitude, état par défaut ;
  - `adjacency.json` : voisines, « terre » ou « fleuve » ;
  - `states-default.json` : découpage mondial par défaut en états, d'après l'admin-1 de Natural Earth ;
  - `meta.json`.
- **Numéros** : les provinces terrestres vont de 1 à n (≈ 13 100). Les numéros de 20 000 à 29 999 sont réservés aux zones maritimes.
- **Noms** : la plus grande ville de la province ; sinon la ville la plus proche du même pays (« Ville – n »).
- **Noms d'îles** (`scripts/worldmap/islands.mjs`) : une province faite d'une île entière porte le nom de l'île (Bornholm, Sylt, Pantelleria, Madeira…), pas celui de la ville la plus proche, souvent d'un autre pays (Ystad, Tønder, Kélibia).
  - Les noms viennent de Natural Earth (contours et points d'îles, archipels) et d'une liste de ≈ 200 îles d'Europe et de Méditerranée, chacune repérée par un point.
  - Une province sans ville qui détient la plus grande part d'une petite île prend son nom ; sur une grande île découpée, une province sans ville prend la ville la plus proche de la même île et du même pays.
  - Une île que la trame soude au continent (Rügen, Djerba…) garde le nom de la ville de sa province.
  - Le rapport : `node scripts/worldmap/islands-report.mjs > iles.md` (les 239 provinces insulaires d'Europe et de Méditerranée).

### Étape B : le rendu (en cours)

- **Tuiles** : `node --max-old-space-size=12000 scripts/worldmap/tiles.mjs` écrit les tuiles vectorielles dans `server/data/worldmap/v1/tiles/` (≈ 27 600 tuiles, 47 Mo, zooms 0 à 8, 1 minute).
  - Deux couches : `provinces` (id = numéro de province) et `arcs` (les 33 500 limites entre deux provinces a et b, coupées à la côte, repérées quand elles longent un très grand fleuve).
  - `arcs-index.json` en donne la liste sans géométrie.
- **Serveur** : `server/worldMap.js` sert `/api/worldmap/status`, les tuiles (204 si vide) et une liste fermée de fichiers de `v1/`.
- **Jeu** : `src/Game/Map/WorldMapLayer.jsx` colorie chaque province par « feature-state ». La géométrie ne change jamais.
  - Une limite devient frontière d'état ou de pays quand ses deux provinces n'ont pas le même état ou le même propriétaire (`src/runtime/worldmap/borders.js`).
  - Ce ne sont donc que les frontières déduites des voisinages : une conquête ne fera que recolorier.
- **Aperçu** : `?worldmap=today` dans l'adresse, ou `localStorage["oh:worldmap"] = "today"`, colorie la carte avec les pays d'aujourd'hui (Natural Earth). Elle couvre alors l'ancienne carte politique ; noms, villes et unités restent au-dessus. Pour l'enlever : `localStorage.removeItem("oh:worldmap")`.
- **Pas encore** :
  - le site web, où `/api` n'existe que dans la page et où les tuiles devront passer par une copie accessible aux workers ;
  - les lacs de moins de 300 km², qui sont des terres.

### Étape C : les scénarios (en cours)

- **Format** : `provinces.v1.json` dans le dossier du scénario.
  - Contenu : `mapVersion`, `owners[]` et `states[]` (l'élément k est la province k + 1), `stateInfo{}` (nom de chaque état).
  - Pas de géométrie.
- **Conversion** : `node --max-old-space-size=8192 scripts/worldmap/convert-scenario.mjs <scénario>`.
  - Chaque province prend la région de l'ancien scénario qui couvre la plus grande part de sa surface ; son propriétaire devient celui de la province, la région devient son état.
  - Les états gardent donc les identifiants des anciennes régions : les changements de territoire d'une partie (`regionOwnershipOverrides`, par région) s'appliquent tels quels à la nouvelle carte.
  - Correctif « morceaux » : les provinces voisines de même pays en 1938 et aujourd'hui forment un morceau, qui prend le propriétaire qui y tient au moins 75 % de la surface.
  - Les îlots hors de l'ancienne carte prennent la province attribuée la plus proche.
  - Les doutes vont dans `conversion-v1.json`, lisibles avec `scripts/worldmap/conversion-report.mjs`.
- **Noms de pays** : le serveur réunit les provinces de chaque propriétaire (`POST /api/worldmap/surfaces`, `server/worldMapSurfaces.js`, sur une trame à 0,1°). Le moteur de noms du jeu les place et les courbe sur ces formes, dans un travailleur à part (`vnext/worldMapLabelsWorker.js`).
- **Aperçu** : `?worldmap=scenario` (ou `localStorage["oh:worldmap"] = "scenario"`) montre le scénario actif converti, avec les changements de la partie. `today` montre les pays d'aujourd'hui.
- **Lacs** : ceux de plus de 300 km² sont de l'eau (Léman, Constance, Balaton, Garde).
- **Correction à une date** : `node --max-old-space-size=8192 scripts/worldmap/correct-1936.mjs <scénario>`.
  - Garde la conversion brute dans `provinces.v1.converted.json`, en repart toujours, et écrit `provinces.v1.json` et `corrections-1936.json` (points de contrôle et différences en Europe et en Méditerranée).
  - En Europe et en Méditerranée, chaque province prend le pays de la carte de 1938, rapporté au pays du scénario.
  - La correction remet ensuite l'Autriche, la Tchécoslovaquie entière (Sudètes, Teschen, sud de la Slovaquie, Ruthénie), Djibouti, le Maroc espagnol (d'après 1914) et le sud de Sakhaline.
  - Les compléments 1936 (`scripts/worldmap/guides-1936.mjs`, tracés à la main à quelques km près) donnent Dantzig ville libre, Tanger zone internationale, Ifni, Zara et Lagosta italiennes, et Touva (d'après Natural Earth). Ce sont aussi des lignes guides de la carte : aucune province ne les chevauche.
  - Une province qui change de pays quitte son ancien état.
- **Propriétaires de départ** : `stateOwners` donne le propriétaire de chaque état au départ. Une partie qui recopie le scénario ne change donc rien ; seul ce qui en diffère compte.
- **Mer** : une nappe opaque (`worldmap-sea`) sous les provinces recouvre l'ancienne carte politique, dont les côtes mal calées dépassaient en mer (les zones pâles au large de l'Espagne, du Maroc, de la Crimée…).
- **Noms des états** : recalculés après la correction (l'IA les lit ; « Province #BBBBBB » ne lui disait rien) : la ville la plus peuplée de l'état, sinon sa région admin-1, rendus uniques.
- **Nouveaux pays** (`NEW_OWNERS` dans `correct-1936.mjs`) : la Ville libre de Dantzig et la Zone internationale de Tanger ont couleur, nom sur la carte, alias, étiquette, note historique pour l'IA et drapeau (`scripts/worldmap/flags-1936.mjs`, dessinés en PNG ; celui de Tanger est simplifié).
- **WW2+ 1936** : l'ancien scénario donne à la Pologne ses frontières d'après 1945 (Poméranie, Silésie, sud de la Prusse-Orientale) ; la correction à 1936 le répare, sans toucher au scénario d'origine.

### Étape E : l'IA sur la nouvelle carte

- **Parties sur la carte mondiale** : une nouvelle partie créée d'un scénario converti (`provinces.v1.json`) porte `worldMap: "v1"` (`game-instance.json`, posé par `createGame`). Les parties d'avant ne l'ont pas et restent sur l'ancienne carte ; rien n'est migré.
- **Régions = états** : pour ces parties, `/api/runtime/json/regionsGeojson` sert les états de la carte mondiale (`server/worldMapStates.js`) : la réunion de leurs provinces, sur la trame à 0,1°, avec numéro, nom et propriétaire de départ. Le fichier `states.v1.geojson` est écrit une fois à côté du scénario et refait quand le scénario ou la carte changent.
  - Tout ce qui lit les régions passe donc aux états sans autre changement : transferts et contrôle de territoire (`regionTransfers`, `regionControlOps`), recherche des lieux, description de la carte et dossiers de pays dans les prompts, clics sur la carte.
- **Départ d'une partie** : `regionOwnershipOverrides` reçoit le propriétaire de chaque état (les anciennes régions sans province en sortent, les morceaux détachés en 1936 y entrent) ; les nouveaux pays reçoivent leur fiche (`world.polityOverrides`, `ownerCodes`, `colors.json`, `flags.json`, `tags.json`).
- **Affichage** : la carte mondiale s'affiche d'elle-même dans ces parties (`/api/worldmap/status` renvoie `game: true`) ; `?worldmap=off` la cache.

### Phase 6, étape 1 : le récit ne dit que ce que le moteur applique

Constat de départ (partie de test, janvier 1936) : l'IA écrivait « Lituanie » au lieu de « Lithuania » (transfert, guerre et discussions refusés), prenait Vilnius (polonais) pour la capitale lituanienne, et le récit d'une « reddition » restait alors que le moteur avait tout refusé ; un tour de repli présentait l'ordre du joueur comme accompli.

1. **Noms de pays** (`src/runtime/polityExonyms.js`) : avant toute validation (`validateGeneratedWorldChanges`), chaque nom de pays d'une réponse (transferts, contrôle, revendications, discussions, unités, combattants, guerres, relations, accords) est ramené au nom exact de la carte : alias du pays, code, puis une table de noms en français, allemand, espagnol, italien et russe translittéré ; un nom générique va au seul pays dont le nom finit ainsi (« Japon » → « Imperialist Japan »). Un nom inconnu reste tel quel. Le reçu dit chaque traduction.
2. **Vrai propriétaire** (`src/Game/AI/territoryOwnerCheck.js`) : un transfert (ou un contrôle) dont le perdant désigné ne tient pas la région est refusé, avec le vrai propriétaire indiqué au modèle — jamais corrigé en silence, et sans liste d'autres régions. Le lieu est cherché sur toute la carte (nom, alias d'époque, ville) avant la passe sémantique, pour que « Vilnius » ne devienne jamais une région lituanienne.
3. **Tours de repli** (`src/Game/AI/fallbackWording.js`) : l'ordre du joueur est cité comme un ordre « NOT carried out » et reste en file (`clearActions: false`).
4. **Alias d'époque et capitales** : `scripts/worldmap/aliases-1936.mjs` (Vilnius → Wilno, Saint-Pétersbourg → Leningrad, Kaliningrad → Königsberg, Pékin → Peiping…) donne des alias aux états, que l'IA voit dans la liste des régions (« Vilnius [also Wilno / Vilna] »). `scripts/worldmap/capitals-1936.mjs` donne la capitale de chaque pays ; la correction vérifie qu'elle tombe chez lui et l'écrit dans `provinces.v1.json` (`capitals`) ; `/api/worldmap/capitals` la sert, et le résumé du monde la donne à l'IA avec qui la tient.
5. **Garde-fou sans requête** (`src/Game/AI/claimGuard.js`) : un événement dont les opérations territoriales ont été refusées et qui annonce une prise, une chute, une annexion, une cession ou une capitulation (anglais, français, allemand, espagnol, italien) est réécrit en tentative par le moteur, dans sa langue ; enacté en partie, il garde son texte et le moteur ajoute quelle partie n'a pas eu lieu ; une capitulation sans aucune opération est aussi réécrite. Le reçu du tour suivant dit « This did NOT happen ». Pas pour les éditions du maître du jeu.
6. **Récit après validation** (`src/Game/AI/validatedNarration.js`, tâche `validatedNarration`) : une fois un segment validé, une requête de plus réécrit les titres et descriptions à partir de ce que le moteur a appliqué et de ce qu'il a refusé ; rien d'autre ne change, et une réécriture qui ferait annoncer une prise sans opération derrière est refusée. Réglage « Write the story after validation » (Réglages → IA), activé par défaut ; il passe par le budget de requêtes du saut.

### Sources et licences

| Source | Usage | Licence |
|---|---|---|
| Natural Earth 10 m | terres, îles, lacs, fleuves, frontières d'aujourd'hui, admin-1, noms d'îles et d'archipels | domaine public |
| GeoNames `cities15000` | graines, noms, population | CC BY 4.0 |
| historical-basemaps (aourednik) | lignes guides 1200, 1914, 1938 | GPL-3.0 |
| Terrain Tiles (AWS, Mapzen), zoom 5 | relief, terrain | ouverte, attribution Mapzen : <https://github.com/tilezen/joerd/blob/master/docs/attribution.md> |

Rien n'est repris de la carte de HOI4, propriété de Paradox.

## Vérifier chez soi

```bash
npm install
node --test src/runtime/hoi/*.test.js   # la couche seule
node --test scripts/worldmap/*.test.js  # la carte mondiale (tracé, retouches)
npm test                                # toute la suite du projet
npm run dev                             # lancer le jeu
```

## Limites connues

- Les forts, radars, aérodromes et ports n'ont pas encore d'effet en jeu : leur niveau est seulement lu par l'IA, en attendant les armées et les fronts.
- Les emplacements ne bornent que les chantiers du joueur : ceux que l'IA lance passent encore sans vérification.
- Les provinces n'existent que sur les scénarios à régions en GeoJSON (WW2+) ; la carte de base garde la liste de sites.
- Sur une carte dont le scénario ne fournit pas ses villes (tuiles vectorielles), la liste des sites se limite aux bassins industriels du pays et à ses propres structures.
- Un changement de propriétaire d'une région ne transfère pas encore les bâtiments qui s'y trouvent.
- Les opérations du Game Master ne passent pas par `economyOps`.
- Une partie ordinaire déjà en cours ne peut pas encore activer la couche.
- Le joueur ne voit que sa propre recherche ; celle des autres pays n'apparaît qu'en nombre de techs, dans le bloc `[ÉCONOMIE]`.
- Rien n'est écrit depuis les panneaux pendant un saut en cours : le panneau le dit, et il faut réessayer après.

## Feuille de route

- **Ensuite :** activation de la couche sur une partie existante, focus nationaux, armées et fronts.

## Licence

Open Historia est sous AGPL-3.0. Ce fork l'est aussi. Usage perso : aucune contrainte. Si la version est hébergée pour d'autres, son code source doit être publié.
