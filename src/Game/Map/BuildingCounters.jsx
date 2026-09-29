// Phase 9 — les bâtiments comptés par état sur la carte mondiale, vue de loin
// (buildingCounts.js). De près, les icônes une à une de MarkersLayer.jsx
// prennent le relais : leur zoom minimal passe à BUILDING_DETAIL_ZOOM pour que
// les deux ne se chevauchent pas. Un clic sur un compteur rapproche la caméra.

import React, { useEffect, useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { buildingIconId, ensureBuildingIcons } from "./buildingIcons.js";
import { BUILDING_DETAIL_ZOOM, buildingCounterFeatures } from "./buildingCounts.js";

const selectMarkers = (world) => world?.markers ?? null;
const FONT = ["Open Sans Semibold", "Arial Unicode MS Bold"];

const BuildingCounters = ({ map, centers }) => {
  const markers = useRuntimeState("world", selectMarkers);
  const data = useMemo(() => buildingCounterFeatures(markers, centers, { iconOf: buildingIconId }), [markers, centers]);

  useEffect(() => {
    if (!map) return undefined;
    ensureBuildingIcons(map);
    // Masquage selon le zoom : les icônes une à une, et leurs noms, de près seulement.
    const ranges = () => {
      for (const [id, min] of [["markers-building-icons", BUILDING_DETAIL_ZOOM], ["markers-building-damage", BUILDING_DETAIL_ZOOM], ["markers-building-labels", BUILDING_DETAIL_ZOOM + 1]]) {
        if (map.getLayer?.(id)) map.setLayerZoomRange(id, min, 24);
      }
    };
    ranges();
    map.on("styledata", ranges);
    const onClick = (event) => {
      const hit = map.queryRenderedFeatures?.(event.point, { layers: ["worldmap-buildings-count"] })?.[0];
      if (!hit) return;
      map.flyTo({ center: hit.geometry.coordinates, zoom: BUILDING_DETAIL_ZOOM + 0.6, duration: 900 });
    };
    map.on("click", onClick);
    return () => { map.off("styledata", ranges); map.off("click", onClick); };
  }, [map]);

  return (
    <Source id="worldmap-buildings-count-source" type="geojson" data={data}>
      <Layer
        id="worldmap-buildings-count"
        type="symbol"
        minzoom={2.5}
        maxzoom={BUILDING_DETAIL_ZOOM}
        layout={{
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 2.5, 0.45, 5, 0.7],
          "icon-offset": ["get", "offset"],
          "icon-allow-overlap": false,
          "text-field": ["get", "label"],
          "text-font": FONT,
          "text-size": 10,
          "text-offset": ["get", "textOffset"],
          "text-optional": true,
          "text-allow-overlap": false,
        }}
        paint={{
          "icon-color": "#f4ecd8",
          "icon-halo-color": "rgba(20,18,14,0.95)",
          "icon-halo-width": 2,
          "text-color": "#f4ecd8",
          "text-halo-color": "rgba(20,18,14,0.95)",
          "text-halo-width": 1.4,
        }}
      />
    </Source>
  );
};

export default BuildingCounters;
