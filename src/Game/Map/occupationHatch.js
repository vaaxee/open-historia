// Carte mondiale unique (phase 6, étape 2) — les états occupés, hachurés.
//
// An occupied state keeps its lawful sovereign (world.regionSovereigntyOverrides)
// while another polity controls it (world.regionOwnershipOverrides). The world
// map colours provinces by controller; over an occupied state it lays diagonal
// stripes in the sovereign's colour, so the map reads "held by X, belongs to Y".
// Pure helpers: WorldMapLayer.jsx draws them.

const clean = (value) => String(value ?? "").trim();

// [{ state, sovereign, controller }] for every state whose controller is not
// its lawful sovereign. `stateOwners` gives each state's starting owner, which
// is its controller when the game has not changed it.
export const occupiedStates = ({ sovereignty = {}, ownership = {}, stateOwners = {} } = {}) => {
  const out = [];
  for (const [state, rawSovereign] of Object.entries(sovereignty ?? {})) {
    const sovereign = clean(rawSovereign);
    const controller = clean(ownership?.[state]) || clean(stateOwners?.[state]);
    if (!sovereign || !controller || sovereign.toLowerCase() === controller.toLowerCase()) continue;
    out.push({ state, sovereign, controller });
  }
  return out.sort((a, b) => a.state.localeCompare(b.state));
};

// The map image name of a sovereign's stripes.
export const hatchPatternName = (sovereign) => `worldmap-hatch-${clean(sovereign).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

// The stripe mask of a square tile: true where a pixel is on a stripe. Diagonal
// stripes `width` pixels wide every `period` pixels, seamless when tiled.
export const hatchMask = (size = 16, { period = 8, width = 3 } = {}) => {
  const mask = new Array(size * size).fill(false);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) mask[y * size + x] = ((x + y) % period) < width;
  }
  return mask;
};

// The tile as RGBA pixels (stripes in `rgb`, the rest transparent), for map.addImage.
export const hatchPixels = (rgb, size = 16, options = {}) => {
  const [r, g, b] = rgb;
  const mask = hatchMask(size, options);
  const data = new Uint8ClampedArray(size * size * 4);
  mask.forEach((on, index) => {
    if (!on) return;
    data.set([r, g, b, 235], index * 4);
  });
  return data;
};

// "rgb(12, 34, 56)", "#0c2238" or "hsl(200, 32%, 68%)" → [r, g, b].
export const cssColourToRgb = (css) => {
  const text = clean(css);
  let match = text.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  match = text.match(/^#([0-9a-f]{6})$/i);
  if (match) return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
  match = text.match(/^hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i);
  if (match) {
    const h = Number(match[1]) / 360; const s = Number(match[2]) / 100; const l = Number(match[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
    const hue = (t) => {
      let x = t; if (x < 0) x += 1; if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((v) => Math.round(v * 255));
  }
  return [90, 70, 50];
};

// The occupation layer's features: each occupied state's geometry (from the
// game's region GeoJSON, whose regions are the world map's states) with the
// pattern of its sovereign.
export const occupationFeatures = (occupied, regionsGeojson) => {
  const byId = new Map();
  for (const feature of Array.isArray(regionsGeojson?.features) ? regionsGeojson.features : []) {
    const id = clean(feature?.properties?.id);
    if (id && feature?.geometry) byId.set(id, feature.geometry);
  }
  return occupied
    .filter((entry) => byId.has(entry.state))
    .map((entry) => ({
      type: "Feature",
      properties: { state: entry.state, sovereign: entry.sovereign, controller: entry.controller, pattern: hatchPatternName(entry.sovereign) },
      geometry: byId.get(entry.state),
    }));
};
