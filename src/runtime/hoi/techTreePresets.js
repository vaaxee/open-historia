// Couche HOI4 — arbres de recherche de secours, écrits à la main (phase 2).
//
// L'arbre d'une partie est normalement écrit par l'IA, une fois (tâche
// hoiTechTree, gameplay.js). Quand elle ne répond pas — pas de clé, quota épuisé,
// réponse inutilisable — une partie 1936 ou 1912 démarre avec l'un de ceux-ci.
// Même format que la réponse de l'IA, et même validation (techTree.js).
//
// Effets possibles (bornés par techTree.js) :
//   unlock      un nouvel équipement : equipment, label, unitCost, resources
//   efficiency  + plafond d'efficacité des lignes (value 0,01 à 0,05)
//   extraction  + extraction d'une ressource (value 0,05 à 0,3)
//   cost        − coût unitaire d'un équipement (value 0,05 à 0,25)
//   building    un type de bâtiment devient constructible (phase 3)

const unlock = (equipment, label, unitCost, resources) => ({ type: "unlock", equipment, label, unitCost, resources });
const res = (entries) => Object.entries(entries).map(([resource, amount]) => ({ resource, amount }));
const efficiency = (value) => ({ type: "efficiency", value });
const extraction = (resource, value) => ({ type: "extraction", resource, value });
const cost = (equipment, value) => ({ type: "cost", equipment, value });
// Phase 3 : un type de bâtiment (buildings.js) que la tech rend constructible.
const building = (id) => ({ type: "building", building: id });

const tech = (id, name, branch, year, days, requires, effects) => ({ id, name, branch, year, days, requires, effects });

export const HOI_FALLBACK_TECH_TREES = Object.freeze({
  1936: Object.freeze({
    techs: Object.freeze([
      // Infanterie
      tech("armes_infanterie_1", "Armes d'infanterie améliorées", "infanterie", 1936, 120, [], [cost("fusils", 0.1)]),
      tech("armes_antichars", "Armes antichars", "infanterie", 1937, 150, ["armes_infanterie_1"], [unlock("antichars", "canons antichars", 2, res({ acier: 1 }))]),
      tech("fusil_semi_auto", "Fusil semi-automatique", "infanterie", 1939, 180, ["armes_infanterie_1"], [unlock("fusils_semi_auto", "fusils semi-automatiques", 0.7, res({ acier: 1 }))]),
      tech("pistolet_mitrailleur", "Pistolet-mitrailleur", "infanterie", 1940, 180, ["fusil_semi_auto"], [cost("fusils_semi_auto", 0.1)]),
      tech("armes_infanterie_2", "Armes d'infanterie modernes", "infanterie", 1942, 240, ["pistolet_mitrailleur"], [cost("fusils", 0.1), cost("fusils_semi_auto", 0.1)]),
      // Artillerie
      tech("artillerie_1", "Artillerie améliorée", "artillerie", 1936, 120, [], [cost("artillerie", 0.1)]),
      tech("antiaerien", "Artillerie antiaérienne", "artillerie", 1937, 150, ["artillerie_1"], [unlock("antiaerien", "canons antiaériens", 3, res({ acier: 2 }))]),
      tech("obusier_lourd", "Obusier lourd", "artillerie", 1938, 180, ["artillerie_1"], [unlock("artillerie_lourde", "artillerie lourde", 6, res({ acier: 3 }))]),
      tech("artillerie_2", "Conduite de tir", "artillerie", 1940, 210, ["obusier_lourd"], [cost("artillerie", 0.1), cost("artillerie_lourde", 0.1)]),
      tech("automoteurs", "Canons automoteurs", "artillerie", 1941, 240, ["obusier_lourd", "char_moyen"], [unlock("canons_automoteurs", "canons automoteurs", 12, res({ acier: 3, chrome: 1 }))]),
      // Blindés
      tech("char_leger_2", "Char léger amélioré", "blindes", 1936, 150, [], [cost("chars", 0.1)]),
      tech("char_moyen", "Char moyen", "blindes", 1938, 210, ["char_leger_2"], [unlock("chars_moyens", "chars moyens", 12, res({ acier: 3, chrome: 1 }))]),
      tech("moteurs_blindes", "Moteurs et suspensions", "blindes", 1939, 180, ["char_moyen"], [efficiency(0.02)]),
      tech("char_lourd", "Char lourd", "blindes", 1940, 240, ["char_moyen"], [unlock("chars_lourds", "chars lourds", 20, res({ acier: 4, chrome: 2 }))]),
      tech("char_moyen_2", "Char moyen amélioré", "blindes", 1942, 270, ["moteurs_blindes"], [cost("chars_moyens", 0.15)]),
      // Aviation
      tech("chasseur_monoplan", "Chasseur monoplan", "aviation", 1936, 150, [], [unlock("chasseurs_monoplans", "chasseurs monoplans", 26, res({ aluminium: 2, caoutchouc: 1 }))]),
      tech("bombardier_tactique", "Bombardier tactique", "aviation", 1937, 180, [], [unlock("bombardiers_tactiques", "bombardiers tactiques", 28, res({ aluminium: 2, caoutchouc: 1 }))]),
      tech("chasseur_avance", "Chasseur avancé", "aviation", 1940, 240, ["chasseur_monoplan"], [unlock("chasseurs_avances", "chasseurs avancés", 32, res({ aluminium: 3, caoutchouc: 1 }))]),
      tech("bombardier_lourd", "Bombardier lourd", "aviation", 1940, 270, ["bombardier_tactique"], [unlock("bombardiers_lourds", "bombardiers lourds", 45, res({ aluminium: 4, caoutchouc: 1 }))]),
      tech("radar", "Radar", "aviation", 1939, 210, ["chasseur_monoplan"], [cost("chasseurs_monoplans", 0.1), building("radar")]),
      // Industrie
      tech("rationalisation", "Rationalisation industrielle", "industrie", 1936, 150, [], [efficiency(0.03)]),
      tech("prospection", "Prospection minière", "industrie", 1936, 120, [], [extraction("acier", 0.1)]),
      tech("raffinage", "Raffinage moderne", "industrie", 1937, 150, ["prospection"], [extraction("petrole", 0.15)]),
      tech("aluminium", "Électrolyse de l'aluminium", "industrie", 1938, 180, ["prospection"], [extraction("aluminium", 0.15)]),
      tech("acierie_moderne", "Aciérie moderne", "industrie", 1937, 180, ["prospection"], [extraction("acier", 0.1), building("acierie")]),
      tech("travail_chaine", "Travail à la chaîne", "industrie", 1938, 180, ["rationalisation"], [efficiency(0.03)]),
      tech("caoutchouc_synthetique", "Caoutchouc synthétique", "industrie", 1939, 210, ["raffinage"], [extraction("caoutchouc", 0.2), building("raffinerie_synthetique")]),
      tech("production_masse", "Production de masse", "industrie", 1941, 240, ["travail_chaine"], [efficiency(0.03)]),
    ]),
  }),
  1912: Object.freeze({
    techs: Object.freeze([
      // Infanterie
      tech("fusil_chargeur", "Fusil à chargeur amélioré", "infanterie", 1910, 120, [], [cost("fusils", 0.1)]),
      tech("mitrailleuse_legere", "Mitrailleuse légère", "infanterie", 1914, 180, ["fusil_chargeur"], [unlock("mitrailleuses_legeres", "mitrailleuses légères", 2.5, res({ acier: 1 }))]),
      tech("mortier_tranchee", "Mortier de tranchée", "infanterie", 1915, 150, ["fusil_chargeur"], [unlock("mortiers", "mortiers de tranchée", 1.5, res({ acier: 1 }))]),
      tech("lance_flammes", "Lance-flammes", "infanterie", 1915, 180, ["mortier_tranchee"], [unlock("lance_flammes", "lance-flammes", 3, res({ acier: 1, petrole: 1 }))]),
      // Artillerie
      tech("tir_rapide", "Artillerie à tir rapide", "artillerie", 1910, 120, [], [cost("artillerie", 0.1)]),
      tech("artillerie_lourde", "Artillerie lourde de campagne", "artillerie", 1913, 210, ["tir_rapide"], [unlock("artillerie_lourde", "artillerie lourde", 7, res({ acier: 3, charbon: 1 }))]),
      tech("fusees_obus", "Fusées d'obus améliorées", "artillerie", 1914, 150, ["tir_rapide"], [cost("obus", 0.15)]),
      tech("obus_chimiques", "Obus chimiques", "artillerie", 1915, 180, ["fusees_obus"], [unlock("obus_chimiques", "obus chimiques", 0.6, res({ acier: 1, charbon: 2 }))]),
      // Blindés
      tech("automitrailleuses", "Automobiles blindées", "blindes", 1912, 150, [], [unlock("automitrailleuses", "automitrailleuses", 6, res({ acier: 2, caoutchouc: 1 }))]),
      tech("chenilles", "Tracteur à chenilles", "blindes", 1915, 180, ["automitrailleuses"], [efficiency(0.02)]),
      tech("char_primitif", "Char d'assaut", "blindes", 1916, 240, ["chenilles"], [unlock("chars_assaut", "chars d'assaut", 15, res({ acier: 4, petrole: 1 }))]),
      tech("char_leger", "Char léger à tourelle", "blindes", 1917, 240, ["char_primitif"], [unlock("chars_legers", "chars légers", 10, res({ acier: 3, petrole: 1 }))]),
      // Aviation
      tech("reconnaissance", "Avion de reconnaissance", "aviation", 1911, 150, [], [unlock("avions_reconnaissance", "avions de reconnaissance", 12, res({ acier: 1, caoutchouc: 1 }))]),
      tech("moteur_rotatif", "Moteur rotatif", "aviation", 1913, 150, ["reconnaissance"], [cost("avions_reconnaissance", 0.1)]),
      tech("chasseur_1915", "Chasseur armé", "aviation", 1915, 210, ["moteur_rotatif"], [unlock("chasseurs_armes", "chasseurs armés", 16, res({ acier: 1, caoutchouc: 1 }))]),
      tech("bombardier_1916", "Bombardier", "aviation", 1916, 240, ["reconnaissance"], [unlock("bombardiers_biplans", "bombardiers biplans", 24, res({ acier: 2, caoutchouc: 1 }))]),
      // Industrie
      tech("organisation_travail", "Organisation scientifique du travail", "industrie", 1911, 150, [], [efficiency(0.03)]),
      tech("acieries", "Aciéries Martin-Siemens", "industrie", 1910, 120, [], [extraction("acier", 0.1), building("acierie")]),
      tech("charbonnages", "Charbonnages modernes", "industrie", 1910, 120, [], [extraction("charbon", 0.1)]),
      tech("petrole", "Forage pétrolier", "industrie", 1912, 150, ["charbonnages"], [extraction("petrole", 0.15)]),
      tech("haber_bosch", "Procédé Haber-Bosch", "industrie", 1913, 180, ["charbonnages"], [cost("obus", 0.15)]),
      tech("economie_guerre", "Économie de guerre", "industrie", 1915, 210, ["organisation_travail"], [efficiency(0.03)]),
    ]),
  }),
});
