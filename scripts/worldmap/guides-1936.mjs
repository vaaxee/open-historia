// Carte mondiale : compléments de lignes guides pour 1936, que ni la carte de
// 1938, ni celle de 1914, ni les frontières d'aujourd'hui ne tracent. Sans eux,
// une province pourrait chevaucher ces frontières.
//
// Tracés à la main, à quelques kilomètres près (les côtes sont celles de
// Natural Earth : les contours ici débordent en mer exprès) :
//   - Ville libre de Dantzig (1920-1939), sans Gdynia (polonaise) ;
//   - zone internationale de Tanger (1923-1956) ;
//   - Ifni (espagnol depuis 1934) ;
//   - Zara (Zadar, italienne 1920-1947) et Lagosta (Lastovo), italienne aussi ;
//   - l'isthme de Carélie finlandais jusqu'à la Sestra (la carte de 1938 met la
//     frontière beaucoup trop au nord ; le bord nord de ce tracé, à 60,62° N,
//     coupe la Finlande sans rien changer à son pays) ;
// et, pris dans Natural Earth, la république de Touva (Tannu Touva).

export const GUIDES_1936 = Object.freeze([
  {
    name: "Danzig",
    polygon: [[18.56, 54.47], [18.9, 54.52], [19.33, 54.42], [19.36, 54.36], [19.27, 54.2], [19.1, 54.07], [18.97, 53.97],
      [18.8, 54.02], [18.77, 54.12], [18.55, 54.17], [18.45, 54.26], [18.42, 54.33], [18.49, 54.41], [18.56, 54.47]],
  },
  { name: "Tangier", polygon: [[-5.97, 35.84], [-5.97, 35.62], [-5.6, 35.62], [-5.52, 35.72], [-5.5, 35.92], [-5.97, 35.84]] },
  { name: "Ifni", polygon: [[-10.45, 29.62], [-9.98, 29.64], [-9.88, 29.35], [-10.02, 29.08], [-10.45, 29.08], [-10.45, 29.62]] },
  { name: "Zara", polygon: [[15.14, 44.07], [15.32, 44.05], [15.37, 44.14], [15.22, 44.2], [15.14, 44.13], [15.14, 44.07]] },
  {
    name: "Karelia",
    polygon: [[28.3, 60.1], [29.97, 60.13], [30.12, 60.21], [30.27, 60.32], [30.45, 60.42], [30.7, 60.52], [31.02, 60.62], [28.3, 60.62], [28.3, 60.1]],
  },
  { name: "Lagosta", polygon: [[16.7, 42.7], [16.98, 42.7], [16.98, 42.82], [16.7, 42.82], [16.7, 42.7]] },
]);

// Le nom de la région admin-1 de Natural Earth prise telle quelle.
export const GUIDES_1936_ADMIN1 = Object.freeze([{ name: "Tuva", admin1: "Tuva" }]);
