// Couche HOI4 — les arbres de focus nationaux (phase 8).
//
// Un arbre par grande puissance de 1936 et pour la Pologne ; les autres pays ont
// l'arbre générique (économie, armée, diplomatie). Un focus :
//   id, name: { fr, en }, days, x, y          (x : colonne, y : rang, pour le panneau)
//   requires   : les focus à avoir finis, tous
//   requiresAny: au moins l'un de ceux-là
//   excludes   : les focus qu'il ferme (et qui le ferment)
//   ideology   : l'idéologie au pouvoir qu'il demande, s'il en demande une
//   effects    : ce que le moteur applique à la fin (focus.js applyFocusEffects) :
//     { type: "factories", civilian, military }      usines
//     { type: "production", value, days }            modificateur de production
//     { type: "research", value }                    recherches en cours avancées
//     { type: "divisions", template, count }         divisions levées, équipées
//     { type: "manpower", amount }                   main-d'œuvre
//     { type: "stock", resource, amount }            ressources
//     { type: "stability", delta } / { type: "warSupport", delta }
//     { type: "ideology", ideology, delta }          popularité d'un courant
//     { type: "opinion", target, delta }             relations (opinions du moteur)
//     { type: "claim", states: [noms d'états] }      revendications
// Les noms d'états sont ceux du scénario hoi4-states-copy-copy-2.

const f = (id, fr, en, days, x, y, effects, extra = {}) => Object.freeze({ id, name: Object.freeze({ fr, en }), days, x, y, effects: Object.freeze(effects), requires: [], requiresAny: [], excludes: [], ...extra });

const GENERIC = [
  f("gen-industry", "Effort industriel", "Industrial effort", 70, 0, 0, [{ type: "factories", civilian: 1 }]),
  f("gen-infrastructure", "Routes et chemins de fer", "Roads and railways", 70, 0, 1, [{ type: "production", value: 0.05, days: 365 }], { requires: ["gen-industry"] }),
  f("gen-arms", "Arsenaux", "Arsenals", 70, 0, 2, [{ type: "factories", military: 1 }], { requires: ["gen-infrastructure"] }),
  f("gen-research", "Universités techniques", "Technical universities", 70, 1, 0, [{ type: "research", value: 0.15 }]),
  f("gen-army", "Réforme de l'armée", "Army reform", 70, 2, 0, [{ type: "divisions", template: "infanterie", count: 2 }, { type: "warSupport", delta: 5 }]),
  f("gen-conscription", "Conscription", "Conscription", 70, 2, 1, [{ type: "manpower", amount: 50000 }], { requires: ["gen-army"] }),
  f("gen-air", "Aviation nationale", "National air force", 70, 2, 2, [{ type: "divisions", template: "chasse", count: 1 }], { requires: ["gen-conscription"] }),
  f("gen-unity", "Unité nationale", "National unity", 70, 3, 0, [{ type: "stability", delta: 8 }]),
  f("gen-neutrality", "Neutralité", "Neutrality", 70, 3, 1, [{ type: "stability", delta: 5 }, { type: "warSupport", delta: -5 }], { requires: ["gen-unity"], excludes: ["gen-alignment"] }),
  f("gen-alignment", "Rechercher un protecteur", "Seek a protector", 70, 4, 1, [{ type: "warSupport", delta: 5 }], { requires: ["gen-unity"], excludes: ["gen-neutrality"] }),
];

const TREES = {
  Germany: [
    f("ger-rearmament", "Réarmement", "Rearmament", 70, 1, 0, [{ type: "factories", military: 2 }, { type: "warSupport", delta: 5 }]),
    f("ger-four-year-plan", "Plan de quatre ans", "Four Year Plan", 70, 0, 1, [{ type: "factories", civilian: 2 }, { type: "production", value: 0.1, days: 180 }], { requires: ["ger-rearmament"] }),
    f("ger-autarky", "Autarcie", "Autarky", 70, 0, 2, [{ type: "stock", resource: "acier", amount: 400 }, { type: "stock", resource: "petrole", amount: 200 }], { requires: ["ger-four-year-plan"] }),
    f("ger-rhineland", "Remilitariser la Rhénanie", "Remilitarise the Rhineland", 70, 1, 1, [{ type: "warSupport", delta: 10 }, { type: "stability", delta: 5 }], { requires: ["ger-rearmament"] }),
    f("ger-luftwaffe", "Luftwaffe", "Luftwaffe", 70, 2, 1, [{ type: "divisions", template: "chasse", count: 2 }, { type: "divisions", template: "bombardement", count: 1 }], { requires: ["ger-rearmament"] }),
    f("ger-panzer", "Divisions blindées", "Panzer divisions", 70, 2, 2, [{ type: "divisions", template: "blindes", count: 2 }, { type: "research", value: 0.15 }], { requires: ["ger-luftwaffe"] }),
    f("ger-anschluss", "Anschluss", "Anschluss", 70, 1, 2, [{ type: "claim", states: ["Vienna"] }, { type: "warSupport", delta: 5 }], { requires: ["ger-rhineland"] }),
    f("ger-danzig", "Dantzig ou la guerre", "Danzig or war", 70, 1, 3, [{ type: "claim", states: ["Gdańsk"] }, { type: "opinion", target: "Poland", delta: -30 }, { type: "warSupport", delta: 10 }], { requires: ["ger-anschluss"], excludes: ["ger-poland-pact"] }),
    f("ger-poland-pact", "Pacte avec la Pologne", "Pact with Poland", 70, 2, 3, [{ type: "opinion", target: "Poland", delta: 30 }, { type: "stability", delta: 5 }], { requires: ["ger-anschluss"], excludes: ["ger-danzig"] }),
    f("ger-axis", "Axe Rome-Berlin", "Rome-Berlin Axis", 70, 3, 1, [{ type: "opinion", target: "Italy", delta: 40 }], { requires: ["ger-rearmament"] }),
    f("ger-anti-comintern", "Pacte anti-Komintern", "Anti-Comintern Pact", 70, 3, 2, [{ type: "opinion", target: "Imperialist Japan", delta: 40 }, { type: "opinion", target: "Soviet Union", delta: -30 }], { requires: ["ger-axis"] }),
  ],
  "Soviet Union": [
    f("sov-five-year", "Deuxième plan quinquennal", "Second Five-Year Plan", 70, 0, 0, [{ type: "factories", civilian: 2 }]),
    f("sov-heavy", "Industrie lourde", "Heavy industry", 70, 0, 1, [{ type: "factories", military: 2 }], { requires: ["sov-five-year"] }),
    f("sov-urals", "Industrialiser l'Oural", "Industrialise the Urals", 70, 0, 2, [{ type: "factories", civilian: 2 }, { type: "production", value: 0.1, days: 180 }], { requires: ["sov-heavy"] }),
    f("sov-purge", "Grande Purge", "Great Purge", 70, 1, 0, [{ type: "ideology", ideology: "communist", delta: 5 }, { type: "stability", delta: 10 }, { type: "research", value: -0.05 }]),
    f("sov-army-reform", "Réforme de l'Armée rouge", "Red Army reform", 70, 1, 1, [{ type: "divisions", template: "infanterie", count: 4 }, { type: "research", value: 0.1 }], { requires: ["sov-purge"] }),
    f("sov-deep-battle", "Bataille en profondeur", "Deep battle", 70, 1, 2, [{ type: "divisions", template: "blindes", count: 2 }], { requires: ["sov-army-reform"] }),
    f("sov-vvs", "Aviation soviétique", "Soviet air force", 70, 2, 1, [{ type: "divisions", template: "chasse", count: 2 }], { requires: ["sov-purge"] }),
    f("sov-collective", "Sécurité collective", "Collective security", 70, 3, 0, [{ type: "opinion", target: "France", delta: 30 }, { type: "opinion", target: "United Kingdom", delta: 20 }], { excludes: ["sov-baltic"] }),
    f("sov-baltic", "Revendiquer les Pays baltes", "Claim the Baltics", 70, 4, 0, [{ type: "claim", states: ["Tallinn", "Riga", "Tartu"] }, { type: "warSupport", delta: 10 }], { excludes: ["sov-collective"] }),
    f("sov-finland", "Sécuriser Léningrad", "Secure Leningrad", 70, 4, 1, [{ type: "claim", states: ["Karelian Isthmus", "Vyborg"] }, { type: "opinion", target: "Finland", delta: -30 }], { requires: ["sov-baltic"] }),
  ],
  France: [
    f("fra-popular-front", "Front populaire", "Popular Front", 70, 0, 0, [{ type: "ideology", ideology: "democratic", delta: 5 }, { type: "stability", delta: -5 }, { type: "factories", civilian: 1 }], { excludes: ["fra-national-union"] }),
    f("fra-national-union", "Union nationale", "National Union", 70, 1, 0, [{ type: "stability", delta: 10 }, { type: "warSupport", delta: 5 }], { excludes: ["fra-popular-front"] }),
    f("fra-nationalisation", "Nationaliser l'armement", "Nationalise the arms industry", 70, 0, 1, [{ type: "factories", military: 2 }], { requiresAny: ["fra-popular-front", "fra-national-union"] }),
    f("fra-maginot", "Prolonger la ligne Maginot", "Extend the Maginot Line", 70, 1, 1, [{ type: "warSupport", delta: 5 }, { type: "production", value: -0.05, days: 180 }], { requiresAny: ["fra-popular-front", "fra-national-union"] }),
    f("fra-armee", "Armée moderne", "Modern army", 70, 1, 2, [{ type: "divisions", template: "blindes", count: 1 }, { type: "divisions", template: "infanterie", count: 2 }], { requires: ["fra-maginot"] }),
    f("fra-air", "Plan V de l'armée de l'Air", "Air force Plan V", 70, 2, 1, [{ type: "divisions", template: "chasse", count: 2 }], { requiresAny: ["fra-popular-front", "fra-national-union"] }),
    f("fra-entente", "Entente cordiale", "Entente Cordiale", 70, 3, 0, [{ type: "opinion", target: "United Kingdom", delta: 40 }]),
    f("fra-little-entente", "Petite Entente", "Little Entente", 70, 3, 1, [{ type: "opinion", target: "Czechoslovakia", delta: 30 }, { type: "opinion", target: "Poland", delta: 20 }], { requires: ["fra-entente"] }),
    f("fra-empire", "Mobiliser l'Empire", "Mobilise the Empire", 70, 2, 2, [{ type: "manpower", amount: 100000 }], { requires: ["fra-air"] }),
  ],
  "United Kingdom": [
    f("uk-rearm", "Livre blanc de la défense", "Defence white paper", 70, 0, 0, [{ type: "factories", military: 2 }]),
    f("uk-shadow", "Usines fantômes", "Shadow factories", 70, 0, 1, [{ type: "factories", civilian: 1 }, { type: "factories", military: 1 }], { requires: ["uk-rearm"] }),
    f("uk-radar", "Radar", "Radar", 70, 1, 1, [{ type: "research", value: 0.2 }], { requires: ["uk-rearm"] }),
    f("uk-raf", "Expansion de la RAF", "RAF expansion", 70, 1, 2, [{ type: "divisions", template: "chasse", count: 2 }], { requires: ["uk-radar"] }),
    f("uk-navy", "Home Fleet", "Home Fleet", 70, 2, 0, [{ type: "divisions", template: "flotte", count: 2 }]),
    f("uk-appeasement", "Apaisement", "Appeasement", 70, 3, 0, [{ type: "stability", delta: 5 }, { type: "warSupport", delta: -5 }], { excludes: ["uk-guarantees"] }),
    f("uk-guarantees", "Garanties aux petits pays", "Guarantees", 70, 4, 0, [{ type: "warSupport", delta: 10 }, { type: "opinion", target: "Poland", delta: 30 }], { excludes: ["uk-appeasement"] }),
    f("uk-commonwealth", "Défense du Commonwealth", "Commonwealth defence", 70, 3, 1, [{ type: "manpower", amount: 100000 }], { requiresAny: ["uk-appeasement", "uk-guarantees"] }),
  ],
  "United States": [
    f("usa-new-deal", "Second New Deal", "Second New Deal", 70, 0, 0, [{ type: "factories", civilian: 2 }, { type: "stability", delta: 5 }]),
    f("usa-tva", "Grands travaux", "Public works", 70, 0, 1, [{ type: "production", value: 0.1, days: 365 }], { requires: ["usa-new-deal"] }),
    f("usa-neutrality", "Lois de neutralité", "Neutrality Acts", 70, 1, 0, [{ type: "stability", delta: 5 }, { type: "warSupport", delta: -5 }], { excludes: ["usa-arsenal"] }),
    f("usa-arsenal", "Arsenal de la démocratie", "Arsenal of Democracy", 70, 2, 0, [{ type: "factories", military: 3 }], { excludes: ["usa-neutrality"] }),
    f("usa-navy", "Marine à deux océans", "Two-ocean navy", 70, 3, 0, [{ type: "divisions", template: "flotte", count: 3 }]),
    f("usa-air", "Air Corps", "Air Corps", 70, 3, 1, [{ type: "divisions", template: "chasse", count: 2 }, { type: "divisions", template: "bombardement", count: 1 }], { requires: ["usa-navy"] }),
    f("usa-draft", "Service sélectif", "Selective service", 70, 2, 1, [{ type: "manpower", amount: 200000 }, { type: "warSupport", delta: 5 }], { requires: ["usa-arsenal"] }),
    f("usa-research", "Laboratoires nationaux", "National laboratories", 70, 1, 1, [{ type: "research", value: 0.2 }], { requires: ["usa-neutrality"] }),
  ],
  Italy: [
    f("ita-ethiopia", "Achever l'Éthiopie", "Finish Ethiopia", 70, 0, 0, [{ type: "claim", states: ["Addis Ababa"] }, { type: "warSupport", delta: 5 }]),
    f("ita-autarky", "Autarcie italienne", "Italian autarky", 70, 1, 0, [{ type: "factories", civilian: 1 }, { type: "stock", resource: "acier", amount: 150 }]),
    f("ita-arms", "Industrie de guerre", "War industry", 70, 1, 1, [{ type: "factories", military: 2 }], { requires: ["ita-autarky"] }),
    f("ita-mare-nostrum", "Mare Nostrum", "Mare Nostrum", 70, 2, 0, [{ type: "divisions", template: "flotte", count: 2 }]),
    f("ita-albania", "Protectorat d'Albanie", "Albanian protectorate", 70, 0, 1, [{ type: "claim", states: ["Tirana"] }], { requires: ["ita-ethiopia"] }),
    f("ita-axis", "L'Axe", "The Axis", 70, 3, 0, [{ type: "opinion", target: "Germany", delta: 40 }], { excludes: ["ita-stresa"] }),
    f("ita-stresa", "Front de Stresa", "Stresa Front", 70, 4, 0, [{ type: "opinion", target: "France", delta: 30 }, { type: "opinion", target: "United Kingdom", delta: 30 }], { excludes: ["ita-axis"] }),
    f("ita-nice", "Revendiquer Nice", "Claim Nice", 70, 3, 1, [{ type: "claim", states: ["Nice"] }, { type: "opinion", target: "France", delta: -20 }], { requires: ["ita-axis"] }),
    f("ita-regia", "Regia Aeronautica", "Regia Aeronautica", 70, 2, 1, [{ type: "divisions", template: "chasse", count: 1 }, { type: "divisions", template: "bombardement", count: 1 }], { requires: ["ita-mare-nostrum"] }),
  ],
  "Imperialist Japan": [
    f("jap-kwantung", "Armée du Guandong", "Kwantung Army", 70, 0, 0, [{ type: "divisions", template: "infanterie", count: 3 }, { type: "warSupport", delta: 5 }]),
    f("jap-north-china", "Chine du Nord", "North China", 70, 0, 1, [{ type: "claim", states: ["Beijing"] }, { type: "opinion", target: "Kuomintang China", delta: -30 }], { requires: ["jap-kwantung"], excludes: ["jap-strike-north"] }),
    f("jap-strike-north", "Frapper au nord", "Strike north", 70, 1, 1, [{ type: "opinion", target: "Soviet Union", delta: -30 }, { type: "divisions", template: "blindes", count: 1 }], { requires: ["jap-kwantung"], excludes: ["jap-north-china"] }),
    f("jap-industry", "Industrie de Mandchourie", "Manchurian industry", 70, 2, 0, [{ type: "factories", civilian: 1 }, { type: "factories", military: 1 }]),
    f("jap-navy", "Flotte combinée", "Combined Fleet", 70, 3, 0, [{ type: "divisions", template: "flotte", count: 2 }]),
    f("jap-carriers", "Aéronavale", "Naval aviation", 70, 3, 1, [{ type: "divisions", template: "chasse", count: 2 }, { type: "research", value: 0.1 }], { requires: ["jap-navy"] }),
    f("jap-anti-comintern", "Pacte anti-Komintern", "Anti-Comintern Pact", 70, 4, 0, [{ type: "opinion", target: "Germany", delta: 40 }]),
    f("jap-resources", "Ressources du Sud", "Southern resources", 70, 2, 1, [{ type: "stock", resource: "petrole", amount: 200 }, { type: "stock", resource: "caoutchouc", amount: 100 }], { requires: ["jap-industry"] }),
  ],
  "Kuomintang China": [
    f("chn-unity", "Unifier la Chine", "Unify China", 70, 0, 0, [{ type: "stability", delta: 10 }]),
    f("chn-united-front", "Front uni", "United Front", 70, 0, 1, [{ type: "ideology", ideology: "communist", delta: 5 }, { type: "warSupport", delta: 15 }], { requires: ["chn-unity"], excludes: ["chn-bandit"] }),
    f("chn-bandit", "Écraser les communistes", "Crush the communists", 70, 1, 1, [{ type: "ideology", ideology: "communist", delta: -8 }, { type: "stability", delta: -5 }], { requires: ["chn-unity"], excludes: ["chn-united-front"] }),
    f("chn-german-advisors", "Conseillers allemands", "German advisors", 70, 2, 0, [{ type: "divisions", template: "infanterie", count: 3 }, { type: "research", value: 0.1 }]),
    f("chn-industry", "Industrialiser le Sichuan", "Industrialise Sichuan", 70, 3, 0, [{ type: "factories", civilian: 2 }]),
    f("chn-arsenals", "Arsenaux de Hanyang", "Hanyang arsenals", 70, 3, 1, [{ type: "factories", military: 2 }], { requires: ["chn-industry"] }),
    f("chn-manpower", "Mobilisation de masse", "Mass mobilisation", 70, 2, 1, [{ type: "manpower", amount: 300000 }], { requires: ["chn-german-advisors"] }),
  ],
  Poland: [
    f("pol-cop", "Région industrielle centrale", "Central Industrial Region", 70, 0, 0, [{ type: "factories", civilian: 1 }, { type: "factories", military: 1 }]),
    f("pol-cop-2", "Étendre le COP", "Expand the COP", 70, 0, 1, [{ type: "factories", military: 1 }, { type: "production", value: 0.1, days: 180 }], { requires: ["pol-cop"] }),
    f("pol-sanation", "Sanacja", "Sanation", 70, 1, 0, [{ type: "stability", delta: 8 }, { type: "ideology", ideology: "authoritarian", delta: 5 }], { excludes: ["pol-democracy"] }),
    f("pol-democracy", "Rendre le pouvoir au Sejm", "Restore the Sejm", 70, 2, 0, [{ type: "ideology", ideology: "democratic", delta: 15 }, { type: "stability", delta: -5 }], { excludes: ["pol-sanation"] }),
    f("pol-army", "Modernisation de l'armée", "Army modernisation", 70, 1, 1, [{ type: "divisions", template: "infanterie", count: 3 }, { type: "divisions", template: "artillerie", count: 1 }], { requiresAny: ["pol-sanation", "pol-democracy"] }),
    f("pol-armour", "Brigade blindée", "Armoured brigade", 70, 1, 2, [{ type: "divisions", template: "blindes", count: 1 }], { requires: ["pol-army"] }),
    f("pol-intermarium", "Intermarium", "Intermarium", 70, 3, 0, [{ type: "opinion", target: "Romania", delta: 30 }, { type: "opinion", target: "Lithuania", delta: 20 }], { excludes: ["pol-balance"] }),
    f("pol-balance", "Équilibre entre les voisins", "Balance between neighbours", 70, 4, 0, [{ type: "opinion", target: "Germany", delta: 15 }, { type: "opinion", target: "Soviet Union", delta: 15 }], { excludes: ["pol-intermarium"] }),
    f("pol-french-alliance", "Alliance française", "French alliance", 70, 3, 1, [{ type: "opinion", target: "France", delta: 40 }, { type: "warSupport", delta: 5 }], { requiresAny: ["pol-intermarium", "pol-balance"] }),
  ],
};

export const GENERIC_FOCUS_TREE = Object.freeze(GENERIC);
export const FOCUS_TREES = Object.freeze(Object.fromEntries(Object.entries(TREES).map(([polity, tree]) => [polity, Object.freeze(tree)])));
