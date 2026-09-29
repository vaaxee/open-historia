// Phase 9 (suite) — la texture de terrain Natural Earth II sous le relief.
//
// Tuiles raster des zooms 0 à 6 (scripts/worldmap/texture-tiles.mjs,
// /api/worldmap/texture), la mer transparente. Au-delà du zoom 6 MapLibre
// agrandit les tuiles du zoom 6 : la texture s'estompe puis disparaît, les aplats
// de terrain des provinces prennent le relais. Le réglage « Animations » règle
// aussi sa charge : complètes, les tuiles apparaissent en fondu et la texture
// suit jusqu'au zoom 9 ; réduites, fondu court et arrêt au zoom 8 ; désactivées,
// pas de fondu et pas d'agrandissement (arrêt au zoom 7) — la carte la plus légère.

export const TEXTURE_MAX_ZOOM = 6;

const SPECS = Object.freeze({
  full: { fade: 300, maxzoom: 9, fadeFrom: 7, fadeTo: 9 },
  reduced: { fade: 100, maxzoom: 8, fadeFrom: 6.5, fadeTo: 8 },
  off: { fade: 0, maxzoom: 7, fadeFrom: 6, fadeTo: 7 },
});

// La couche pour un niveau d'animation ("full", "reduced", "off").
export const textureLayerSpec = (level = "full") => {
  const spec = SPECS[level] ?? SPECS.full;
  return {
    minzoom: 0,
    maxzoom: spec.maxzoom,
    paint: {
      "raster-opacity": ["interpolate", ["linear"], ["zoom"], spec.fadeFrom, 1, spec.fadeTo, 0],
      "raster-fade-duration": spec.fade,
      "raster-resampling": "linear",
    },
  };
};
