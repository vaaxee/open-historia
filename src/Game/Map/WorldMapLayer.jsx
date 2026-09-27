// Carte mondiale unique (phase 5, étape B) — la carte des provinces dans le jeu.
//
// Tuiles vectorielles servies par le serveur (server/worldMap.js) : la
// géométrie ne change jamais. Chaque province est coloriée par « feature-state »
// (la couleur de son propriétaire) ; chaque limite reçoit son genre (province,
// état, pays) d'après les propriétaires de ses deux provinces
// (runtime/worldmap/borders.js).
//
// Pour l'instant (étape B), seulement en aperçu, coloriée avec les pays
// d'aujourd'hui : ?worldmap=today dans l'adresse, ou
// localStorage["oh:worldmap"] = "today". Opaque, elle couvre l'ancienne carte
// politique ; les noms, villes, bâtiments et unités restent au-dessus.
// L'étape C la branchera sur les scénarios (province → pays, province → état).

import React, { useEffect, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { BORDER_KIND, arcKind, todayColour } from "../../runtime/worldmap/borders.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";

const SOURCE = "worldmap";

export const worldMapPreviewMode = () => {
  if (typeof window === "undefined") return "";
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("worldmap");
    if (fromUrl) return fromUrl;
    return window.localStorage?.getItem("oh:worldmap") ?? "";
  } catch {
    return "";
  }
};

const fetchJson = async (file) => {
  const response = await fetch(`/api/worldmap/v1/${file}`);
  if (!response.ok) throw new Error(`${file} : HTTP ${response.status}`);
  return response.json();
};

// Les propriétaires : pour l'aperçu, le pays d'aujourd'hui de chaque province.
const loadTodayOwners = async () => {
  const [provinces, countries, arcs] = await Promise.all([
    fetchJson("provinces.json"), fetchJson("countries-today.json"), fetchJson("arcs-index.json"),
  ]);
  const owner = new Map(); const state = new Map();
  for (const province of provinces) {
    owner.set(province.id, province.country ?? "");
    state.set(province.id, province.state ?? "");
  }
  return { provinces, countries, arcs, owner, state };
};

const WorldMapLayer = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef;
  const [mode] = useState(worldMapPreviewMode);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (mode !== "today") return undefined;
    let alive = true;
    fetch("/api/worldmap/status")
      .then((response) => response.json())
      .then((status) => (status?.available ? loadTodayOwners() : null))
      .then((loaded) => { if (alive) setData(loaded); })
      .catch((error) => console.warn("Carte mondiale indisponible :", error));
    return () => { alive = false; };
  }, [mode]);

  // Couleurs et genres de limites, par feature-state (appliqués aussi aux
  // tuiles pas encore chargées).
  useEffect(() => {
    if (!map || !data) return undefined;
    const apply = () => {
      if (!map.getSource(SOURCE)) return false;
      for (const province of data.provinces) {
        map.setFeatureState({ source: SOURCE, sourceLayer: "provinces", id: province.id }, { color: todayColour(data.countries[province.country]) });
      }
      const ownerOf = (id) => data.owner.get(id) ?? "";
      const stateOf = (id) => data.state.get(id) ?? "";
      for (const [id, a, b] of data.arcs) {
        map.setFeatureState({ source: SOURCE, sourceLayer: "arcs", id }, { kind: arcKind(a, b, ownerOf, stateOf) });
      }
      enforceMapLayerOrder(map);
      return true;
    };
    if (apply()) return undefined;
    const retry = () => { if (apply()) map.off("sourcedata", retry); };
    map.on("sourcedata", retry);
    return () => map.off("sourcedata", retry);
  }, [map, data]);

  if (mode !== "today" || !data) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Source id={SOURCE} type="vector" tiles={[`${origin}/api/worldmap/v1/tiles/{z}/{x}/{y}.pbf`]} minzoom={0} maxzoom={8}>
      <Layer
        id="worldmap-fill"
        type="fill"
        source-layer="provinces"
        paint={{ "fill-color": ["to-color", ["coalesce", ["feature-state", "color"], "#d8cfb8"]], "fill-antialias": false }}
      />
      <Layer
        id="worldmap-province-lines"
        type="line"
        source-layer="arcs"
        layout={{ "line-join": "round" }}
        paint={{
          "line-color": ["case", ["==", ["feature-state", "kind"], BORDER_KIND.state], "rgba(60, 45, 30, 0.55)", "rgba(60, 45, 30, 0.32)"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.15, 4, 0.35, 6, 0.7, 9, 1.2],
          "line-opacity": ["case", ["==", ["feature-state", "kind"], BORDER_KIND.country], 0, 1],
        }}
      />
      <Layer
        id="worldmap-country-borders"
        type="line"
        source-layer="arcs"
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={{
          "line-color": "rgba(45, 30, 20, 0.9)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 4, 1.3, 7, 2.2],
          "line-opacity": ["case", ["==", ["feature-state", "kind"], BORDER_KIND.country], 1, 0],
        }}
      />
    </Source>
  );
};

export default WorldMapLayer;
