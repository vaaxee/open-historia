# Couche HOI4 — fork Open Historia

Ce fork ajoute sous la narration d'Open Historia une couche de gestion façon Hearts of Iron IV : ressources, production, puis technologies, focus, armées et fronts. Principe : **l'IA raconte, le moteur compte**.

## État : phase 3

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
| Section « Construction » | `src/Game/GameUI/construction.jsx`, dans le panneau Production | Fait (phase 3) |

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

## Vérifier chez soi

```bash
npm install
node --test src/runtime/hoi/*.test.js   # la couche seule
npm test                                # toute la suite du projet
npm run dev                             # lancer le jeu
```

## Limites connues

- Les forts, radars, aérodromes et ports n'ont pas encore d'effet en jeu : leur niveau est seulement lu par l'IA, en attendant les armées et les fronts.
- Le lieu d'un chantier se choisit dans une liste ; le clic sur la carte viendra avec sa refonte visuelle.
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
