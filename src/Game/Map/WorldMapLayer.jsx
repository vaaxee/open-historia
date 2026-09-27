// Carte mondiale unique (phase 5) — la carte des provinces dans le jeu.
//
// Tuiles vectorielles servies par le serveur (server/worldMap.js) : la
// géométrie ne change jamais. Chaque province est coloriée par « feature-state »
// (la couleur de son propriétaire) ; chaque limite reçoit son genre (province,
// état, pays) d'après les propriétaires de ses deux provinces
// (runtime/worldmap/borders.js). Les noms de pays sont placés par Nations.jsx
// sur la réunion des provinces de chaque pays (worldMapStore.js).
//
// Deux aperçus (?worldmap=… dans l'adresse, ou localStorage["oh:worldmap"]) :
//   today     les pays d'aujourd'hui (Natural Earth)
//   scenario  le scénario actif converti (provinces.v1.json), avec les
//             changements de territoire de la partie (par état)
// Opaque, la carte couvre l'ancienne carte politique ; noms, villes, bâtiments
// et unités restent au-dessus.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { getNationColors } from "../../runtime/assets.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import {
  BORDER_KIND, arcKind, changedProvinces, provinceOwners, todayColour,
} from "../../runtime/worldmap/borders.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { setWorldMapState, worldMapPreviewMode } from "./worldMapStore.js";

export { worldMapPreviewMode };
const SOURCE = "worldmap";
const NEUTRAL = "#d8cfb8";
// La mer de la carte mondiale : une nappe opaque sous les provinces, qui
// recouvre l'ancienne carte politique. Ses côtes, en gros pixels et mal calées,
// dépassaient sinon en mer (les zones pâles au large de l'Espagne, du Maroc,
// de la Crimée…).
const SEA = "#a3a8b0";
const SEA_SHEET = Object.freeze({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }],
});

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  return response.json();
};

// Une couleur stable pour un propriétaire sans couleur dans le scénario.
const hashedColour = (owner) => {
  let h = 2166136261;
  for (const ch of owner) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 32%, 68%)`;
};

const selectOverrides = (world) => world?.regionOwnershipOverrides ?? null;

const WorldMapLayer = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef;
  const [mode] = useState(worldMapPreviewMode);
  const [data, setData] = useState(null);
  const overrides = useRuntimeState("world", selectOverrides);
  const applied = useRef({ owners: null, source: null });

  useEffect(() => {
    if (mode !== "today" && mode !== "scenario") return undefined;
    let alive = true;
    (async () => {
      const status = await fetchJson("/api/worldmap/status");
      if (!status?.available) return null;
      const [provinces, arcs] = await Promise.all([fetchJson("/api/worldmap/v1/provinces.json"), fetchJson("/api/worldmap/v1/arcs-index.json")]);
      const stateOfProvince = provinces.map((p) => p.state ?? "");
      if (mode === "today") {
        const countries = await fetchJson("/api/worldmap/v1/countries-today.json");
        const scenario = { owners: provinces.map((p) => countries[p.country]?.name ?? ""), states: stateOfProvince };
        const colours = new Map(Object.values(countries).map((c) => [c.name, todayColour(c)]));
        return { scenario, arcs, colourOf: (owner) => colours.get(owner) ?? NEUTRAL, useOverrides: false, stamp: status.stamp };
      }
      const scenario = await fetchJson("/api/worldmap/scenario");
      const palette = await getNationColors().catch(() => ({}));
      const colourOf = (owner) => {
        // Les pays du jeu, puis ceux que la correction de 1936 ajoute (Dantzig, Tanger).
        const rgb = palette?.[owner] ?? scenario.newOwners?.[owner]?.color;
        return Array.isArray(rgb) ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : owner ? hashedColour(owner) : NEUTRAL;
      };
      return { scenario, arcs, colourOf, useOverrides: true, stamp: status.stamp };
    })()
      .then((loaded) => { if (alive && loaded) setData(loaded); })
      .catch((error) => console.warn("Carte mondiale indisponible :", error));
    return () => { alive = false; };
  }, [mode]);

  // Le propriétaire de chaque province (le scénario, puis la partie).
  const owners = useMemo(
    () => (data ? provinceOwners(data.scenario, data.useOverrides ? overrides ?? {} : {}) : null),
    [data, overrides],
  );

  useEffect(() => {
    if (!owners) return;
    const ownerLabels = Object.fromEntries(Object.entries(data?.scenario?.newOwners ?? {}).map(([owner, info]) => [owner, info?.label ?? owner]));
    setWorldMapState({ active: true, mode, owners, ownerLabels, ownersKey: `${mode}:${owners.length}:${owners.join("|").length}` });
  }, [owners, mode, data]);
  useEffect(() => () => setWorldMapState({ active: false, owners: null }), []);

  // Couleurs et genres de limites, par feature-state : tout la première fois,
  // puis seulement ce que touchent les provinces qui ont changé de mains.
  useEffect(() => {
    if (!map || !data || !owners) return undefined;
    const apply = () => {
      const source = map.getSource(SOURCE);
      if (!source) return false;
      const previous = applied.current.source === source ? applied.current.owners : null;
      const changed = previous ? changedProvinces(previous, owners) : owners.map((_, k) => k + 1);
      if (!changed.length) return true;
      for (const id of changed) {
        map.setFeatureState({ source: SOURCE, sourceLayer: "provinces", id }, { color: data.colourOf(owners[id - 1]) });
      }
      const touched = new Set(changed);
      const ownerOf = (id) => owners[id - 1] ?? "";
      const stateOf = (id) => data.scenario.states?.[id - 1] ?? "";
      for (const [id, a, b] of data.arcs) {
        if (previous && !touched.has(a) && !touched.has(b)) continue;
        map.setFeatureState({ source: SOURCE, sourceLayer: "arcs", id }, { kind: arcKind(a, b, ownerOf, stateOf) });
      }
      applied.current = { owners, source };
      enforceMapLayerOrder(map);
      return true;
    };
    if (apply()) return undefined;
    const retry = () => { if (apply()) map.off("sourcedata", retry); };
    map.on("sourcedata", retry);
    return () => map.off("sourcedata", retry);
  }, [map, data, owners]);

  if (!data) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <>
    <Source id="worldmap-sea-source" type="geojson" data={SEA_SHEET}>
      <Layer id="worldmap-sea" type="fill" paint={{ "fill-color": SEA, "fill-antialias": false }} />
    </Source>
    <Source id={SOURCE} type="vector" tiles={[`${origin}/api/worldmap/v1/tiles/{z}/{x}/{y}.pbf?v=${data.stamp ?? ""}`]} minzoom={0} maxzoom={8}>
      <Layer
        id="worldmap-fill"
        type="fill"
        source-layer="provinces"
        paint={{ "fill-color": ["to-color", ["coalesce", ["feature-state", "color"], NEUTRAL]], "fill-antialias": false }}
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
    </>
  );
};

export default WorldMapLayer;
