// Couche HOI4, phase 3 — une icône par type de bâtiment, sur la carte.
//
// Dessinées ici en blanc sur fond transparent, puis ajoutées à la carte comme
// images SDF : MapLibre les teinte alors à la couleur du propriétaire
// (icon-color) et leur met un halo sombre, comme les glyphes des autres
// structures. Pas de fichier image à charger, pas de police qui manque un signe.
//
// Les clés sont celles de HOI_BUILDING_TYPES[type].icon (runtime/hoi/buildings.js).

const SIZE = 48; // pixels ; affichée à pixelRatio 2, soit 24 px à l'écran
const PIXEL_RATIO = 2;

export const buildingIconId = (icon) => `hoi-building:${icon}`;

// Chaque dessin reçoit un contexte 48×48 déjà rempli en blanc (fillStyle) et
// tracé en blanc (strokeStyle).
const DRAW = {
  // Complexe industriel : un bâtiment, deux cheminées.
  industry: (c) => {
    c.fillRect(6, 24, 36, 18);
    c.fillRect(10, 8, 6, 18);
    c.fillRect(22, 13, 6, 13);
    c.beginPath(); c.moveTo(30, 24); c.lineTo(42, 16); c.lineTo(42, 24); c.fill();
  },
  // Usine civile : toit en dents de scie.
  factory: (c) => {
    c.beginPath();
    c.moveTo(5, 42); c.lineTo(5, 22); c.lineTo(17, 14); c.lineTo(17, 22); c.lineTo(29, 14); c.lineTo(29, 22);
    c.lineTo(41, 14); c.lineTo(43, 42); c.closePath(); c.fill();
  },
  // Usine militaire : un obus debout.
  arms: (c) => {
    c.beginPath(); c.moveTo(24, 4); c.quadraticCurveTo(34, 14, 33, 26); c.lineTo(15, 26); c.quadraticCurveTo(14, 14, 24, 4); c.fill();
    c.fillRect(15, 28, 18, 12);
    c.fillRect(13, 41, 22, 4);
  },
  // Raffinerie : un derrick.
  refinery: (c) => {
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(12, 44); c.lineTo(24, 5); c.lineTo(36, 44);
    c.moveTo(16, 32); c.lineTo(32, 32); c.moveTo(19, 22); c.lineTo(29, 22); c.stroke();
    c.fillRect(8, 42, 32, 4);
  },
  // Raffinerie synthétique : une cornue.
  synthetic: (c) => {
    c.beginPath(); c.arc(20, 30, 12, 0, Math.PI * 2); c.fill();
    c.lineWidth = 5; c.beginPath(); c.moveTo(28, 21); c.lineTo(42, 8); c.stroke();
  },
  // Aciérie : une enclume.
  steel: (c) => {
    c.beginPath();
    c.moveTo(4, 16); c.lineTo(38, 16); c.quadraticCurveTo(44, 16, 44, 22); c.lineTo(32, 26); c.lineTo(30, 32);
    c.lineTo(34, 40); c.lineTo(14, 40); c.lineTo(18, 32); c.lineTo(16, 26); c.quadraticCurveTo(6, 24, 4, 16); c.fill();
  },
  // Mine : un pic.
  mine: (c) => {
    c.lineWidth = 5; c.lineCap = "round";
    c.beginPath(); c.moveTo(14, 42); c.lineTo(34, 14); c.stroke();
    c.beginPath(); c.moveTo(8, 18); c.quadraticCurveTo(28, 2, 44, 18); c.lineTo(40, 20); c.quadraticCurveTo(28, 10, 12, 20); c.closePath(); c.fill();
  },
  // Fort : une tour crénelée.
  fort: (c) => {
    c.fillRect(10, 18, 28, 26);
    for (const x of [10, 20, 30]) c.fillRect(x, 8, 8, 12);
  },
  // Radar : une parabole sur son pied.
  radar: (c) => {
    c.beginPath(); c.ellipse(22, 20, 16, 9, -0.6, 0, Math.PI); c.fill();
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(22, 20); c.lineTo(34, 8); c.moveTo(24, 26); c.lineTo(24, 42); c.moveTo(14, 44); c.lineTo(34, 44); c.stroke();
  },
  // Aérodrome : un avion vu de dessus.
  airfield: (c) => {
    c.beginPath();
    c.moveTo(24, 4); c.lineTo(27, 18); c.lineTo(44, 26); c.lineTo(44, 30); c.lineTo(27, 26); c.lineTo(26, 38); c.lineTo(32, 42);
    c.lineTo(32, 45); c.lineTo(24, 42); c.lineTo(16, 45); c.lineTo(16, 42); c.lineTo(22, 38); c.lineTo(21, 26); c.lineTo(4, 30);
    c.lineTo(4, 26); c.lineTo(21, 18); c.closePath(); c.fill();
  },
  // Port : une ancre.
  port: (c) => {
    c.lineWidth = 4; c.lineCap = "round";
    c.beginPath(); c.arc(24, 9, 4, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(24, 13); c.lineTo(24, 43); c.moveTo(15, 20); c.lineTo(33, 20); c.stroke();
    c.beginPath(); c.arc(24, 28, 15, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  },
};

export const BUILDING_ICON_KEYS = Object.freeze(Object.keys(DRAW));

const rasterize = (icon) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#ffffff";
  DRAW[icon](context);
  const { data } = context.getImageData(0, 0, SIZE, SIZE);
  return { width: SIZE, height: SIZE, data: new Uint8Array(data.buffer) };
};

// Ajoute les icônes manquantes à la carte. Sans effet si elles y sont déjà ; à
// rappeler après un changement de style, qui efface les images.
export const ensureBuildingIcons = (map) => {
  if (!map?.addImage || !map?.hasImage) return;
  for (const icon of BUILDING_ICON_KEYS) {
    const id = buildingIconId(icon);
    if (map.hasImage(id)) continue;
    const image = rasterize(icon);
    if (!image) continue;
    try {
      map.addImage(id, image, { sdf: true, pixelRatio: PIXEL_RATIO });
    } catch {
      // Style en cours de rechargement : le prochain appel les ajoutera.
    }
  }
};
