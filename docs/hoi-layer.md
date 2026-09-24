# Couche HOI4 — fork Open Historia

Ce fork ajoute sous la narration d'Open Historia une couche de gestion façon Hearts of Iron IV : ressources, production, puis technologies, focus, armées et fronts. Principe : **l'IA raconte, le moteur compte**.

## État : phase 1

| Élément | Fichier | Statut |
| --- | --- | --- |
| Moteur économie / production | `src/runtime/hoi/engine.js` | Fait, fonctions pures |
| Valeurs de départ 1936 et 1912, base neutre | `src/runtime/hoi/presets.js` | Fait |
| Opérations IA `economyOps` | `src/runtime/hoi/economyOps.js` | Fait, bornées |
| Tests de la couche | `src/runtime/hoi/*.test.js`, `src/Game/AI/economyOpsWiring.test.js` | 35 tests, passent |
| Activation au lancement | case « HOI4 layer » à l'étape de la difficulté (`libraryBar.jsx`) | Fait |
| Bloc `[ÉCONOMIE]` dans le tour | `promptContext.js` (`economySummary`) → `gameplay.js` (`[Economy Layer]`) | Fait |
| Application dans le tour | `applySimulationResult` : `economyOps` puis `advanceHoiLayer` | Fait |
| Panneau « Production » | `src/Game/GameUI/production.jsx`, 4ᵉ bouton du dock | Fait, lecture seule |

La couche est **inerte** tant qu'une partie n'a pas de `world.hoi` : une partie Open Historia ordinaire ne change pas. Elle ne voit ni le bloc `[ÉCONOMIE]`, ni `economyOps` dans l'outil du tour (26 363 caractères, comme avant), ni le bouton Production.

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
| `line` | réaffecter les usines militaires d'une ligne, ou en ouvrir une | borné par les usines militaires libres ; une nouvelle ligne seulement pour un équipement du catalogue ; les usines ajoutées font baisser l'efficacité |

Un pays inconnu est refusé. Chaque valeur ramenée dans ses bornes ou refusée est notée dans le reçu d'application, que l'IA lit au tour suivant.

## Vérifier chez soi

```bash
npm install
node --test src/runtime/hoi/*.test.js   # la couche seule
npm test                                # toute la suite du projet
npm run dev                             # lancer le jeu
```

## Limites connues de la phase 1

- Le panneau Production est en lecture seule : le joueur ne réaffecte pas encore ses usines lui-même.
- Le nombre d'usines ne change pas encore (pas de construction ni de destruction d'usines).
- Les opérations du Game Master ne passent pas par `economyOps`.
- Une partie déjà en cours ne peut pas encore activer la couche.

## Prochaine étape : phase 2

- Réaffectation des usines par le joueur depuis le panneau Production.
- Construction d'usines par les usines civiles, et bombardements.
- Activation de la couche sur une partie existante.
- Technologies.

## Licence

Open Historia est sous AGPL-3.0. Ce fork l'est aussi. Usage perso : aucune contrainte. Si la version est hébergée pour d'autres, son code source doit être publié.
