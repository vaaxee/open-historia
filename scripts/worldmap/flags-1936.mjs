// Carte mondiale : les drapeaux des pays que la correction de 1936 ajoute
// (correct-1936.mjs, NEW_OWNERS), dessinés ici en petites images PNG
// (120 × 80), rendues comme adresses data: (le format de flags.json).
//
//   Dantzig : rouge, deux croix blanches l'une sous l'autre, une couronne d'or
//             au-dessus, côté hampe (le drapeau de la Ville libre, 1920-1939).
//   Tanger  : dessin simplifié — champ rouge, écu blanc bordé d'or au centre
//             (le drapeau de la zone portait les armes de la ville).

import { encodePng } from "./lib/png.mjs";

const W = 120; const H = 80;
const RED = [200, 16, 46]; const WHITE = [255, 255, 255]; const GOLD = [240, 190, 20];

const canvas = (background) => {
  const pixels = new Uint8Array(W * H * 3);
  for (let k = 0; k < W * H; k += 1) pixels.set(background, k * 3);
  const paint = (inside, colour) => {
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (inside(x + 0.5, y + 0.5)) pixels.set(colour, (y * W + x) * 3);
  };
  return { pixels, paint };
};

// Une croix pattée : les bras s'élargissent vers leurs bouts.
const crossPattee = (cx, cy, r) => (x, y) => {
  const dx = Math.abs(x - cx); const dy = Math.abs(y - cy);
  if (dx > r || dy > r) return false;
  const half = (d) => 1.6 + (d / r) * (r * 0.42);
  return dx <= half(dy) || dy <= half(dx);
};

const danzig = () => {
  const { pixels, paint } = canvas(RED);
  const cx = 30;
  paint(crossPattee(cx, 38, 10), WHITE);
  paint(crossPattee(cx, 63, 10), WHITE);
  // La couronne : un bandeau, trois pointes, et le haut arrondi.
  paint((x, y) => x >= cx - 11 && x <= cx + 11 && y >= 19 && y <= 23, GOLD);
  for (const px of [cx - 9, cx, cx + 9]) paint((x, y) => y >= 9 && y < 19 && Math.abs(x - px) <= (y - 9) * 0.35 + 0.6, GOLD);
  paint((x, y) => y >= 12 && y < 19 && Math.abs(x - cx) <= 11 && y >= 12 + Math.abs(x - cx) * 0.25, GOLD);
  return pixels;
};

const tangier = () => {
  const { pixels, paint } = canvas(RED);
  const shield = (grow) => (x, y) => {
    const top = 20 - grow; const bottom = 64 + grow; const half = 15 + grow;
    if (y < top || y > bottom) return false;
    const mid = 48;
    const width = y <= mid ? half : half * Math.sqrt(Math.max(0, 1 - ((y - mid) / (bottom - mid)) ** 2));
    return Math.abs(x - 60) <= width;
  };
  paint(shield(2.5), GOLD);
  paint(shield(0), WHITE);
  return pixels;
};

// Bahreïn (1933) : champ rouge, bande blanche côté hampe au bord dentelé.
const bahrain = () => {
  const { pixels, paint } = canvas(RED);
  const teeth = 8; const tooth = H / teeth;
  paint((x, y) => {
    const t = (y % tooth) / tooth; // 0 → 1 le long d'une dent
    const edge = 24 + 12 * (1 - Math.abs(2 * t - 1));
    return x < edge;
  }, WHITE);
  return pixels;
};

const dataUrl = (pixels) => `data:image/png;base64,${encodePng(W, H, pixels).toString("base64")}`;

export const FLAGS_1936 = Object.freeze({
  "Free City of Danzig": dataUrl(danzig()),
  "Tangier International Zone": dataUrl(tangier()),
  Bahrain: dataUrl(bahrain()),
});
