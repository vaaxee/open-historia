# Couche HOI4 — fork Open Historia

Ce fork ajoute sous la narration d'Open Historia une couche de gestion façon Hearts of Iron IV : ressources, production, puis technologies, focus, armées et fronts. Principe : **l'IA raconte, le moteur compte**.

## État : phase 2

| Élément | Fichier | Statut |
| --- | --- | --- |
| Moteur économie / production | `src/runtime/hoi/engine.js` | Fait, fonctions pures |
| Valeurs de départ 1936 et 1912, base neutre | `src/runtime/hoi/presets.js` | Fait |
| Opérations IA `economyOps` | `src/runtime/hoi/economyOps.js` | Fait, bornées |
| Moteur de recherche | `src/runtime/hoi/research.js` | Fait (phase 2) |
| Arbre de recherche : validation, équipements, installation | `src/runtime/hoi/techTree.js` | Fait (phase 2) |
| Arbres de secours 1936 et 1912 | `src/runtime/hoi/techTreePresets.js` | Fait (phase 2) |
| Arbre écrit par l'IA | `gameplay.js` (`generateHoiTechTree`, `ensureHoiTechTree`), tâche `hoiTechTree` | Fait (phase 2) |
| Tests de la couche | `src/runtime/hoi/*.test.js`, `src/Game/AI/economyOpsWiring.test.js` | 53 tests, passent |
| Activation au lancement | case « HOI4 layer » à l'étape de la difficulté (`libraryBar.jsx`) | Fait |
| Bloc `[ÉCONOMIE]` dans le tour | `promptContext.js` (`economySummary`) → `gameplay.js` (`[Economy Layer]`) | Fait, avec la recherche |
| Application dans le tour | `applySimulationResult` : `economyOps` puis `advanceHoiLayer` | Fait |
| Panneau « Production » | `src/Game/GameUI/production.jsx`, 4ᵉ bouton du dock | Fait, réaffectation des usines |
| Panneau « Recherche » | `src/Game/GameUI/research.jsx`, 5ᵉ bouton du dock | Fait (phase 2) |

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

**L'arbre.** Au chargement d'une partie HOI4 qui n'en a pas (nouvelle partie, ou partie de la phase 1), une seule requête `hoiTechTree` demande à l'IA un arbre de 25 à 45 techs en cinq branches : infanterie, artillerie, blindés, aviation, industrie. Le modèle utilisé se choisit dans les réglages de l'IA, sous « HOI4 tech tree ». Si l'IA ne répond pas ou si son arbre est inutilisable (moins de 12 techs après validation), l'arbre de secours de la série est installé : 27 techs pour 1936, 22 pour 1912. Pour une autre époque sans réponse de l'IA, la partie reste sans technologies, et le prochain chargement réessaie.

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

## Vérifier chez soi

```bash
npm install
node --test src/runtime/hoi/*.test.js   # la couche seule
npm test                                # toute la suite du projet
npm run dev                             # lancer le jeu
```

## Limites connues

- Le nombre d'usines ne change pas encore (pas de construction ni de destruction) : ce sera la phase 3.
- Les techs débloquent des équipements et des bonus, pas encore de bâtiments (phase 3).
- Les opérations du Game Master ne passent pas par `economyOps`.
- Une partie ordinaire déjà en cours ne peut pas encore activer la couche.
- Le joueur ne voit que sa propre recherche ; celle des autres pays n'apparaît qu'en nombre de techs, dans le bloc `[ÉCONOMIE]`.
- Rien n'est écrit depuis les panneaux pendant un saut en cours : le panneau le dit, et il faut réessayer après.

## Feuille de route

- **Phase 3 : construction.** Les usines civiles construisent des usines militaires, des usines civiles et des bâtiments débloqués par les techs (raffineries, aciéries, etc.) ; bombardements et sabotages détruisent des usines ; nouvelle opération `economyOps` pour les dégâts.
- **Ensuite :** activation de la couche sur une partie existante, focus nationaux, armées et fronts.

## Licence

Open Historia est sous AGPL-3.0. Ce fork l'est aussi. Usage perso : aucune contrainte. Si la version est hébergée pour d'autres, son code source doit être publié.
