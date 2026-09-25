/*! Open Historia — built-structure map layer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { useWorldState } from "./useWorldState.js";
import {
  getMarkerPresentation,
  MARKER_VISIBILITY_TIER,
} from "./vnext/presentationPolicy.js";
import { HOI_BUILDING_TYPES } from "../../runtime/hoi/buildings.js";
import { buildingIconId, ensureBuildingIcons } from "./buildingIcons.js";
import { fanOutOffsets } from "./buildingFan.js";

// Le nom d'un bâtiment suit son icône décalée : l'écart de l'éventail
// (icon-offset × icon-size, en pixels) ramené en ems du texte, à deux zooms.
const LABEL_EMS_PER_UNIT_LOW = 0.073; // zoom 4 : icon-size 0,62, texte 8,5
const LABEL_EMS_PER_UNIT_HIGH = 0.1; // zoom 10 : icon-size 1,05, texte 10,5
const labelOffset = ([x, y], perUnit, below) => [Math.round(x * perUnit * 100) / 100, Math.round((y * perUnit + below) * 100) / 100];

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const MARKER_STATUS_LABEL = {
  planned: "Planned",
  under_construction: "Under construction",
  active: "Active",
  damaged: "Damaged",
  inactive: "Inactive",
  abandoned: "Abandoned",
  destroyed: "Destroyed",
};

const normalizeMarkerStatus = (status) => {
  const key = String(status || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MARKER_STATUS_LABEL, key) ? key : "active";
};

const markerStatusOpacity = (status) => ({
  planned: 0.76,
  under_construction: 0.86,
  active: 1,
  damaged: 0.95,
  inactive: 0.68,
  abandoned: 0.64,
  destroyed: 0.62,
}[normalizeMarkerStatus(status)]);


const ownerColorString = (colorMap, code) => {
  const rgb = colorMap[String(code ?? "").trim()];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  // Unowned / unknown-owner structures read as neutral parchment, not an error.
  return "rgb(226, 222, 205)";
};

// World.markers — structures founded during play (cities, military bases,
// bunkers, missile silos, embassies…). Rendered in the visual language of the
// city layer (glyph + haloed label) but colored by owner so a forward base
// reads as belonging to someone.
const V_NEXT_TIER_LAYERS = [
  {
    tier: MARKER_VISIBILITY_TIER.strategic,
    shapeId: "markers-shapes-strategic",
    labelId: "markers-labels-strategic",
    shapeMinZoom: 3.0,
    labelMinZoom: 3.8,
  },
  {
    tier: MARKER_VISIBILITY_TIER.regional,
    shapeId: "markers-shapes-regional",
    labelId: "markers-labels-regional",
    shapeMinZoom: 4.2,
    labelMinZoom: 5.0,
  },
  {
    tier: MARKER_VISIBILITY_TIER.local,
    shapeId: "markers-shapes-local",
    labelId: "markers-labels-local",
    shapeMinZoom: 5.8,
    labelMinZoom: 6.6,
  },
];

const MarkersLayer = () => {
  const { markers } = useWorldState();
  const [colorMap, setColorMap] = useState({});
  const { current: map } = useMap();

  // Couche HOI4 : les icônes des bâtiments, remises après chaque changement de
  // style (qui efface les images de la carte).
  useEffect(() => {
    const mapInstance = map?.getMap?.() ?? map;
    if (!mapInstance?.on) return undefined;
    const install = () => ensureBuildingIcons(mapInstance);
    install();
    mapInstance.on("styledata", install);
    mapInstance.on("styleimagemissing", install);
    return () => {
      mapInstance.off?.("styledata", install);
      mapInstance.off?.("styleimagemissing", install);
    };
  }, [map]);

  useEffect(() => {
    getNationColors()
      .then(setColorMap)
      .catch((error) => console.error("Failed to load colors for markers:", error));
  }, []);

  const data = useMemo(() => {
    if (!markers.length) return EMPTY_FEATURE_COLLECTION;
    // Couche HOI4 : les bâtiments proches les uns des autres en éventail, pour
    // qu'aucun ne disparaisse sous un autre (buildingFan.js).
    const offsets = fanOutOffsets(markers
      .filter((marker) => marker.building && Number.isFinite(marker.lng) && Number.isFinite(marker.lat))
      .map((marker) => ({ id: marker.id, lng: marker.lng, lat: marker.lat })));
    return {
      type: "FeatureCollection",
      features: markers
        .filter((marker) => Number.isFinite(marker.lng) && Number.isFinite(marker.lat) && marker.name)
        .map((marker) => {
          const status = normalizeMarkerStatus(marker.status);
          const statusLabel = MARKER_STATUS_LABEL[status];
          const presentation = getMarkerPresentation(marker);
          // Couche HOI4 : un bâtiment a son icône ; l'anneau dit son état.
          const buildingSpec = marker.building ? HOI_BUILDING_TYPES[marker.building.type] : null;
          const condition = Number(marker.building?.condition ?? 100);
          const iconOffset = offsets.get(marker.id) ?? [0, 0];
          return {
            type: "Feature",
            id: marker.id,
            geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
            properties: {
              id: marker.id,
              name: marker.name,
              // Lifecycle is encoded by opacity and remains fully described in
              // the feature popup, so the map label stays the plain name.
              displayName: marker.name,
              kind: marker.kind || "landmark",
              ownerCode: marker.ownerCode || "",
              status,
              statusLabel,
              statusOpacity: markerStatusOpacity(status),
              family: presentation.family,
              priority: presentation.priority,
              sortKey: presentation.sortKey,
              visibilityTier: presentation.visibilityTier,
              glyph: presentation.glyph,
              hasBuilding: Boolean(buildingSpec),
              icon: buildingSpec ? buildingIconId(buildingSpec.icon) : "",
              damage: buildingSpec ? (condition <= 0 ? "destroyed" : condition < 100 ? "damaged" : "") : "",
              iconOffset,
              labelOffsetLow: labelOffset(iconOffset, LABEL_EMS_PER_UNIT_LOW, 1.2),
              labelOffsetHigh: labelOffset(iconOffset, LABEL_EMS_PER_UNIT_HIGH, 1.3),
              rgb: ownerColorString(colorMap, marker.ownerCode),
            },
          };
        }),
    };
  }, [markers, colorMap]);

  return (
    <Source id="markers-source" type="geojson" data={data}>
        {V_NEXT_TIER_LAYERS.map((entry) => (
          <Layer
            key={entry.shapeId}
            id={entry.shapeId}
            type="symbol"
            beforeId="country-curved-labels"
            minzoom={entry.shapeMinZoom}
            filter={["all", ["==", ["get", "visibilityTier"], entry.tier], ["!", ["get", "hasBuilding"]]]}
            layout={{
              "symbol-sort-key": ["get", "sortKey"],
              "text-field": ["get", "glyph"],
              "text-allow-overlap": true,
              "text-ignore-placement": false,
              "text-padding": 3,
              "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 7, 13, 11, 17],
            }}
            paint={{
              "text-color": ["get", "rgb"],
              "text-halo-color": "rgba(5, 8, 12, 0.92)",
              "text-halo-width": 1.4,
              "text-halo-blur": 0.25,
              "text-opacity": ["get", "statusOpacity"],
            }}
          />
        ))}
        {/* Couche HOI4 : un anneau sous l'icône d'un bâtiment endommagé ou détruit,
            décalé avec elle dans l'éventail. */}
        <Layer
          id="markers-building-damage"
          type="symbol"
          beforeId="country-curved-labels"
          minzoom={3}
          filter={["all", ["get", "hasBuilding"], ["!=", ["get", "damage"], ""]]}
          layout={{
            "icon-image": buildingIconId("ring"),
            "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 0.9, 12, 1.2],
            "icon-offset": ["get", "iconOffset"],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          }}
          paint={{
            "icon-color": ["match", ["get", "damage"], "destroyed", "#ef4444", "#f59e0b"],
          }}
        />
        <Layer
          id="markers-building-icons"
          type="symbol"
          beforeId="country-curved-labels"
          minzoom={3}
          filter={["get", "hasBuilding"]}
          layout={{
            "symbol-sort-key": ["get", "sortKey"],
            "icon-image": ["get", "icon"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 0.9, 12, 1.2],
            "icon-offset": ["get", "iconOffset"],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          }}
          paint={{
            "icon-color": ["get", "rgb"],
            "icon-halo-color": "rgba(5, 8, 12, 0.92)",
            "icon-halo-width": 2,
            "icon-opacity": ["get", "statusOpacity"],
          }}
        />
        {V_NEXT_TIER_LAYERS.map((entry) => (
          <Layer
            key={entry.labelId}
            id={entry.labelId}
            type="symbol"
            beforeId="country-curved-labels"
            minzoom={entry.labelMinZoom}
            filter={["all", ["==", ["get", "visibilityTier"], entry.tier], ["!", ["get", "hasBuilding"]]]}
            layout={{
              "symbol-sort-key": ["get", "sortKey"],
              "text-field": ["get", "displayName"],
              "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
              "text-padding": 6,
              "text-radial-offset": 0.8,
              "text-size": ["interpolate", ["linear"], ["zoom"], 4, 8.5, 10, 10.5],
              "text-variable-anchor": ["top", "bottom", "left", "right"],
              "text-max-width": 16,
            }}
            paint={{
              "text-color": "rgba(247, 246, 240, 0.96)",
              "text-halo-color": "rgba(5, 8, 12, 0.92)",
              "text-halo-width": 1.35,
              "text-halo-blur": 0.35,
              "text-opacity": ["get", "statusOpacity"],
            }}
          />
        ))}
        {/* Couche HOI4 : le nom d'un bâtiment, sous son icône décalée. */}
        <Layer
          id="markers-building-labels"
          type="symbol"
          beforeId="country-curved-labels"
          minzoom={5}
          filter={["get", "hasBuilding"]}
          layout={{
            "symbol-sort-key": ["get", "sortKey"],
            "text-field": ["get", "displayName"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-anchor": "top",
            "text-offset": ["interpolate", ["linear"], ["zoom"], 4, ["get", "labelOffsetLow"], 10, ["get", "labelOffsetHigh"]],
            "text-padding": 4,
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 8.5, 10, 10.5],
            "text-max-width": 14,
          }}
          paint={{
            "text-color": "rgba(247, 246, 240, 0.96)",
            "text-halo-color": "rgba(5, 8, 12, 0.92)",
            "text-halo-width": 1.35,
            "text-halo-blur": 0.35,
            "text-opacity": ["get", "statusOpacity"],
          }}
        />
      </Source>
  );
};

export default MarkersLayer;
