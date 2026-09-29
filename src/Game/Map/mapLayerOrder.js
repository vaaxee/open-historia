/*! Open Historia — canonical current-renderer map layer stacking © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Political Cartography Pipeline v2 separates political truth (region fills)
// from presentation (boundaries, labels, cities, objects, units). React mount
// order cannot enforce that separation by itself because several sources mount
// asynchronously after world/scenario data arrives. MapLibre appends a late
// layer at the top unless it is explicitly reordered, which lets a political
// fill paint over boundaries and object/symbol layers.
//
// This list is the single current-renderer authority for bottom -> top order.
export const MAP_LAYER_ORDER = [
  // Political body / local geography.
  "countries-fill",
  "countries-outline",
  "custom-regions-fill-far",
  "custom-regions-repair-fill-far",
  "regions-fill",
  "regions-disputed",
  "regions-outline",
  "custom-regions-fill",
  "custom-regions-repair-fill",
  "ownership-transition-flood",
  "ownership-transition-sweep-fill",
  "custom-regions-local-outline",
  "custom-regions-repair-local-outline",
  "custom-regions-disputed-vnext",

  // Couche HOI4 : les provinces, sous les frontières des États.
  "hoi-provinces-pick-fill",
  "hoi-provinces-outline",
  "hoi-provinces-pick-outline",
  "hoi-provinces-selected",

  // Sovereign frontiers are presentation, but must remain above every
  // political fill and below every semantic object/label layer.
  "polity-boundaries-shadow",
  "polity-boundaries",

  // Carte mondiale unique (phase 5) : opaque, elle couvre l'ancienne carte
  // politique quand elle est active ; les noms et les objets restent au-dessus.
  "worldmap-sea",
  // Phase 9 (proposition v3) : le halo des côtes sur la mer, le terrain sous les
  // aplats politiques translucides, le relief ombré par-dessus.
  "worldmap-coast-halo",
  "worldmap-terrain",
  // La texture Natural Earth II, sur les aplats de terrain, sous la couleur des pays.
  "worldmap-texture",
  "worldmap-fill",
  "worldmap-relief",
  // Occupied states, hatched in their lawful sovereign's colour over the occupier's.
  "worldmap-occupation",
  // Phase 12 : les provinces que l'éditeur au pinceau a prises.
  "worldmap-brush",
  "worldmap-province-lines",
  "worldmap-country-borders",
  "worldmap-country-borders-inner",
  // Phase 9 : la frontière qu'une annexion redessine.
  "motion-border",
  // Phase 9 : l'onde d'un blocus sur sa zone de mer.
  "motion-blockade",
  // Phase 7.6 : les fronts (traits et flèches), sur les frontières.
  "worldmap-fronts",
  "worldmap-fronts-motion",
  "worldmap-front-arrows",
  "worldmap-front-draw",

  // Draped standing-order lines belong above map cartography but below symbols.
  "units-heading",
  "units-station",

  // Political labels.
  "country-curved-labels",
  "country-line-labels-live-world",
  "country-line-labels-live-detail",
  "country-labels-live-managed",
  "country-labels-live-overlap",
  "country-labels",
  // PTR-0 replacement typography proof. It intentionally sits above the old
  // polity symbols while both systems coexist, and below cities/objects.
  "polity-text-renderer",

  // Physical/world objects must never be buried by political cartography.
  "cities-shapes",
  "cities-labels",
  "markers-shapes-strategic",
  "markers-labels-strategic",
  "markers-shapes-regional",
  "markers-labels-regional",
  "markers-shapes-local",
  "markers-labels-local",

  // Phase 9 : les bâtiments comptés par état (vue de loin).
  "worldmap-buildings-count",
  // Phase 7.6 : les batailles du dernier tour et les pions des armées.
  "motion-battles",
  "worldmap-battles",
  "motion-moves",
  "worldmap-armies",
  "worldmap-armies-count",
  // Phase 7.8 : escadres et flottes en mission.
  "worldmap-air",
  "worldmap-naval",

  // Unit counters are interactive operational objects and remain topmost.
  "units-fill",
  "units-icons",
  "units-name",
];

const NATGEO_REFERENCE_TIER_METADATA_KEY = "openhistoria:natgeo-reference-tier";

const getNatGeoReferenceLayerIds = (map) => {
  const styleLayers = map?.getStyle?.()?.layers;
  if (!Array.isArray(styleLayers)) return { lines: [], labels: [] };
  const lines = [];
  const labels = [];
  for (const layer of styleLayers) {
    const tier = layer?.metadata?.[NATGEO_REFERENCE_TIER_METADATA_KEY];
    if (tier === "line") lines.push(layer.id);
    else if (tier === "label") labels.push(layer.id);
  }
  return { lines, labels };
};

export const buildEffectiveMapLayerOrder = (map) => {
  const { lines: natGeoLines, labels: natGeoLabels } = getNatGeoReferenceLayerIds(map);
  if (!natGeoLines.length && !natGeoLabels.length) return MAP_LAYER_ORDER;

  const order = [];
  for (const id of MAP_LAYER_ORDER) {
    order.push(id);
    // NatGeo's roads, coastlines and administrative borders must sit above OH
    // fills to remain visible, but below canonical OH sovereign borders.
    if (id === "custom-regions-disputed-vnext") order.push(...natGeoLines);
    // NatGeo reference text/icons (cities, admin1 names, water/terrain, roads)
    // must also sit above the political fill. Keep them below OH's own polity
    // typography and operational overlays so canonical labels stay dominant.
    if (id === "polity-boundaries") order.push(...natGeoLabels);
  }
  return order;
};

export const enforceMapLayerOrder = (map) => {
  if (!map?.getLayersOrder || !map.getLayer || !map.moveLayer) return false;

  const effectiveOrder = buildEffectiveMapLayerOrder(map);
  const present = effectiveOrder.filter((id) => map.getLayer(id));
  if (!present.length) return false;

  const current = map.getLayersOrder();
  if (current.slice(-present.length).join("\u0000") === present.join("\u0000")) {
    return false;
  }

  // Move known app/reference layers to the top one-by-one in canonical
  // bottom->top order. Untagged style-owned basemap material stays underneath.
  for (const id of present) map.moveLayer(id);
  return true;
};
