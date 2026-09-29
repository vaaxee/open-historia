// Phase 7.6 — les armées sur la carte mondiale : pions empilés par état et par
// pays (nombre de divisions), fronts (trait sur la frontière de contact, flèches
// d'attaque, l'axe en gras), et lieux des batailles du dernier tour. Rien pour
// une partie sans armées. Les géométries viennent d'armyFeatures.js (pur).

import React, { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { loadWorldMapSeas, loadWorldMapSupply } from "../../runtime/worldmap/supplyData.js";
import { divisionStrength, templatesFor } from "../../runtime/hoi/armies.js";
import { airFeatures, armyStackFeatures, battleFeatures, frontFeatures, navalFeatures } from "./armyFeatures.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { useFrontDraw } from "./frontDrawStore.js";
import ArmiesMotion from "./motion/ArmiesMotion.jsx";
import BuildingCounters from "./BuildingCounters.jsx";

const selectArmies = (world) => world?.hoi?.armies ?? null;
const selectFronts = (world) => world?.hoi?.fronts ?? null;
const selectBattles = (world) => world?.hoi?.lastBattles ?? null;
const selectSeries = (world) => world?.hoi?.series ?? "1936";
const selectOverrides = (world) => world?.regionOwnershipOverrides ?? null;
const selectAirMissions = (world) => world?.hoi?.airMissions ?? null;
const selectNavalMissions = (world) => world?.hoi?.navalMissions ?? null;
const selectBlockades = (world) => world?.hoi?.blockades ?? null;
const EMPTY = Object.freeze({ type: "FeatureCollection", features: [] });
const FONT = ["Open Sans Semibold", "Arial Unicode MS Bold"];

const ArmiesLayer = ({ stateOwners = {}, colourOf = () => "#888" }) => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef;
  const armies = useRuntimeState("world", selectArmies);
  const fronts = useRuntimeState("world", selectFronts);
  const battles = useRuntimeState("world", selectBattles);
  const series = useRuntimeState("world", selectSeries);
  const overrides = useRuntimeState("world", selectOverrides);
  const airMissions = useRuntimeState("world", selectAirMissions);
  const navalMissions = useRuntimeState("world", selectNavalMissions);
  const blockades = useRuntimeState("world", selectBlockades);
  const [supply, setSupply] = useState(null);
  const [seas, setSeas] = useState(null);

  useEffect(() => {
    if (!armies || supply) return undefined;
    let alive = true;
    loadWorldMapSupply().then((states) => { if (alive && Object.keys(states).length) setSupply(states); }).catch(() => {});
    return () => { alive = false; };
  }, [armies, supply]);
  useEffect(() => {
    if (!navalMissions?.length || seas) return undefined;
    let alive = true;
    loadWorldMapSeas().then((data) => { if (alive && data) setSeas(data); }).catch(() => {});
    return () => { alive = false; };
  }, [navalMissions, seas]);

  const centers = useMemo(() => {
    if (!supply) return null;
    const out = {};
    for (const [id, info] of Object.entries(supply)) if (Number.isFinite(info?.lng) && Number.isFinite(info?.lat)) out[id] = [info.lng, info.lat];
    return out;
  }, [supply]);
  const ownerOf = useMemo(() => (id) => overrides?.[id] ?? stateOwners?.[id] ?? "", [overrides, stateOwners]);
  const templates = templatesFor(series);

  const stacks = useMemo(() => (armies && centers
    ? armyStackFeatures(armies, centers, {
      colourOf,
      strengthOf: (division) => divisionStrength(division, templates[division.template]).overall,
      counts: (division) => templates[division.template]?.kind === "land",
    })
    : EMPTY), [armies, centers, colourOf, templates]);
  // Phase 7.8 : escadres au-dessus de leur front, flottes dans leur zone de mer.
  const airMarks = useMemo(() => (airMissions?.length && centers
    ? airFeatures(airMissions, { centers, fronts, armies, colourOf })
    : EMPTY), [airMissions, centers, fronts, armies, colourOf]);
  const navalMarks = useMemo(() => (navalMissions?.length && seas?.zones
    ? navalFeatures(navalMissions, { zones: seas.zones, blockades, colourOf })
    : EMPTY), [navalMissions, seas, blockades, colourOf]);
  const frontLines = useMemo(() => (fronts?.length && centers
    ? frontFeatures(fronts, { centers, ownerOf, neighboursOf: (id) => supply?.[id]?.neighbours ?? [], colourOf })
    : EMPTY), [fronts, centers, ownerOf, supply, colourOf]);
  const battleMarks = useMemo(() => (battles?.length && centers ? battleFeatures(battles, centers) : EMPTY), [battles, centers]);
  // Phase 7.7 : les états du front en cours de dessin.
  const draw = useFrontDraw();
  const drawn = useMemo(() => (draw.drawing && centers ? {
    type: "FeatureCollection",
    features: draw.sector.filter((id) => centers[id]).map((id) => ({ type: "Feature", properties: { stateId: id }, geometry: { type: "Point", coordinates: centers[id] } })),
  } : EMPTY), [draw, centers]);

  useEffect(() => { if (map) enforceMapLayerOrder(map); }, [map, stacks, frontLines, battleMarks, airMarks, navalMarks]);

  if (!armies || !centers) return null;
  return (
    <>
      <Source id="worldmap-fronts-source" type="geojson" data={frontLines}>
        <Layer
          id="worldmap-fronts"
          type="line"
          filter={["==", ["get", "kind"], "front"]}
          layout={{ "line-cap": "round" }}
          paint={{ "line-color": ["get", "colour"], "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 6, 5], "line-opacity": 0.9, "line-dasharray": [1, 0.6] }}
        />
        {/* Phase 9 : un front qui attaque ou perce ondule (motion/ArmiesMotion.jsx). */}
        <Layer
          id="worldmap-fronts-motion"
          type="line"
          filter={["all", ["==", ["get", "kind"], "front"], ["!=", ["get", "posture"], "hold"]]}
          layout={{ "line-cap": "butt" }}
          paint={{ "line-color": "#fff6dc", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 6, 2.2], "line-opacity": 0.75, "line-dasharray": [2, 2] }}
        />
        <Layer
          id="worldmap-front-arrows"
          type="line"
          filter={["==", ["get", "kind"], "arrow"]}
          layout={{ "line-cap": "round" }}
          paint={{
            "line-color": ["get", "colour"],
            "line-width": ["case", ["get", "axis"], 5, 2.5],
            "line-opacity": ["case", ["==", ["get", "posture"], "breakthrough"], 1, 0.75],
          }}
        />
      </Source>
      <Source id="worldmap-front-draw-source" type="geojson" data={drawn}>
        <Layer
          id="worldmap-front-draw"
          type="circle"
          paint={{ "circle-color": "rgba(255,255,255,0.15)", "circle-radius": 16, "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 }}
        />
      </Source>
      <Source id="worldmap-battles-source" type="geojson" data={battleMarks}>
        <Layer
          id="worldmap-battles"
          type="symbol"
          layout={{ "text-field": ["get", "label"], "text-font": FONT, "text-size": 12, "text-offset": [0, 1.6], "text-allow-overlap": false }}
          paint={{
            "text-color": ["match", ["get", "result"], "captured", "#7f1d1d", "repelled", "#1e3a8a", "#3f3f46"],
            "text-halo-color": "rgba(255,255,255,0.9)",
            "text-halo-width": 1.4,
          }}
        />
      </Source>
      <Source id="worldmap-armies-source" type="geojson" data={stacks}>
        <Layer
          id="worldmap-armies"
          type="circle"
          paint={{
            "circle-color": ["get", "colour"],
            "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 7, 10, 10, 60, 15],
            "circle-stroke-color": ["case", [">", ["get", "onFront"], 0], "#111", "rgba(255,255,255,0.9)"],
            "circle-stroke-width": ["case", [">", ["get", "onFront"], 0], 2.2, 1.4],
            "circle-opacity": ["interpolate", ["linear"], ["get", "strength"], 0, 0.45, 1, 0.95],
          }}
        />
        <Layer
          id="worldmap-armies-count"
          type="symbol"
          layout={{ "text-field": ["get", "label"], "text-font": FONT, "text-size": 11, "text-allow-overlap": true }}
          paint={{ "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.2 }}
        />
      </Source>
      <Source id="worldmap-air-source" type="geojson" data={airMarks}>
        <Layer
          id="worldmap-air"
          type="symbol"
          layout={{ "text-field": ["get", "label"], "text-font": FONT, "text-size": 12, "text-allow-overlap": true }}
          paint={{ "text-color": ["get", "colour"], "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6 }}
        />
      </Source>
      <Source id="worldmap-naval-source" type="geojson" data={navalMarks}>
        <Layer
          id="worldmap-naval"
          type="symbol"
          layout={{ "text-field": ["get", "label"], "text-font": FONT, "text-size": 13, "text-allow-overlap": true }}
          paint={{ "text-color": ["case", ["get", "blockade"], "#991b1b", ["get", "colour"]], "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6 }}
        />
      </Source>
      {/* Phase 9 : le motion design des armées (batailles, glissements, fronts, blocus, survol). */}
      <ArmiesMotion map={map} centers={centers} battles={battles} armies={armies} blockades={blockades} seas={seas} navalMarks={navalMarks} colourOf={colourOf} />
      {/* Phase 9 : les bâtiments comptés par état, vus de loin. */}
      <BuildingCounters map={map} centers={centers} />
    </>
  );
};

export default ArmiesLayer;
