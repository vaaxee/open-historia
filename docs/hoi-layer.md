# Couche HOI4 — fork Open Historia

Ce fork ajoute sous la narration d'Open Historia une couche de gestion façon Hearts of Iron IV : ressources, production, puis technologies, focus, armées et fronts. Principe : **l'IA raconte, le moteur compte**.

## État : phase 0

| Élément | Fichier | Statut |
| --- | --- | --- |
| Moteur économie / production | `src/runtime/hoi/engine.js` | Fait, fonctions pures |
| Tests du moteur | `src/runtime/hoi/engine.test.js` | 9 tests, passent |
| Branchement dans le tour | `src/Game/AI/gameplay.js`, dans `applySimulationResult` | Fait, une ligne |
| Données de la couche | `world.hoi` dans `world.json` | Format défini |
| Activation d'une partie | `enableHoiLayer(world, …)` | Fonction prête, pas encore d'interface |
| Bloc `[ÉCONOMIE]` dans le prompt | `buildEconomyPromptBlock` | Fonction prête, branchée en phase 1 |

La couche est **inerte** tant qu'une partie n'a pas de `world.hoi` : une partie Open Historia ordinaire ne change pas.

## Ce que fait le moteur à chaque saut

1. Il calcule le nombre de jours entre l'ancienne et la nouvelle date du jeu (6 h à 1 an, ou saut auto).
2. Il découpe les longs sauts en tranches de 30 jours maximum.
3. Pour chaque nation : extraction des ressources, consommation par les lignes de production, production d'équipement, montée de l'efficacité, expiration des modificateurs (grève, bonus).
4. Une pénurie réduit la production au prorata de la ressource la plus manquante ; un stock ne devient jamais négatif.
5. Un modificateur, même proposé par l'IA, reste borné entre −50 % et +50 %.
6. Il écrit un rapport (`world.hoi.lastReport`) que le prompt lira en phase 1.

Tous les réglages d'équilibrage sont dans `HOI_TUNING`, en haut de `engine.js`.

## Vérifier chez soi

```bash
npm install
node --test src/runtime/hoi/engine.test.js   # moteur seul
npm test                                     # toute la suite du projet
npm run dev                                  # lancer le jeu
```

## Prochaine étape : phase 1

- Écran ou commande pour activer la couche au lancement d'une partie, avec des valeurs de départ par pays.
- Injection du bloc `[ÉCONOMIE]` dans le message du tour (modèle : `buildPendingUnitOrdersText`).
- Nouvel impact IA `economyOps` (grèves, contrats, sabotages), borné, avec refus notés dans le reçu d'application.
- Premier panneau « Production » dans `src/Game/GameUI/`.

## Licence

Open Historia est sous AGPL-3.0. Ce fork l'est aussi. Usage perso : aucune contrainte. Si la version est hébergée pour d'autres, son code source doit être publié.
