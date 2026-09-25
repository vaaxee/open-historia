// Couche HOI4, phase 3 — deux bâtiments au même endroit restent tous deux visibles.
//
// Run tests: node --test src/Game/Map/buildingFan.test.js
//
// Un fort bâti à 3 km d'un complexe industriel tombe sous le même pixel dès
// qu'on regarde un pays entier : l'icône dessinée par-dessus cache l'autre. Les
// bâtiments proches sont donc regroupés, et chaque groupe disposé en éventail
// autour de son point, avec un écart fixe à l'écran (icon-offset) : visible à
// tous les zooms, et la position enregistrée ne bouge pas.

// En dessous de cette distance, deux bâtiments forment un groupe.
export const FAN_GROUP_KM = 25;
// Rayon de l'éventail, en unités d'icon-offset (multipliées par icon-size).
export const FAN_RADIUS = 22;

const KM_PER_DEGREE = 111.32;

const distanceKm = (a, b) => {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (a.lng - b.lng) * Math.cos(meanLat) * KM_PER_DEGREE;
  const dy = (a.lat - b.lat) * KM_PER_DEGREE;
  return Math.hypot(dx, dy);
};

// points : [{ id, lng, lat }]. Renvoie Map id → [x, y] : [0, 0] pour un bâtiment
// seul, un point de l'éventail sinon (le premier en haut, puis dans le sens des
// aiguilles d'une montre). Stable : l'ordre des identifiants décide.
export const fanOutOffsets = (points, { groupKm = FAN_GROUP_KM, radius = FAN_RADIUS } = {}) => {
  const sorted = [...points]
    .filter((point) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const offsets = new Map();
  const assigned = new Set();
  for (const seed of sorted) {
    if (assigned.has(seed.id)) continue;
    // De proche en proche : un bâtiment proche d'un membre du groupe en fait partie.
    const group = [seed];
    assigned.add(seed.id);
    for (let i = 0; i < group.length; i += 1) {
      for (const other of sorted) {
        if (assigned.has(other.id)) continue;
        if (distanceKm(group[i], other) < groupKm) {
          group.push(other);
          assigned.add(other.id);
        }
      }
    }
    if (group.length === 1) {
      offsets.set(seed.id, [0, 0]);
      continue;
    }
    group.forEach((point, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / group.length;
      offsets.set(point.id, [
        Math.round(Math.cos(angle) * radius * 100) / 100,
        Math.round(Math.sin(angle) * radius * 100) / 100,
      ]);
    });
  }
  return offsets;
};
