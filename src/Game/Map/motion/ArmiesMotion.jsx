// Phase 9 — le motion design des armées sur la carte mondiale (motionPlan.js) :
//   - bataille : pulsation sur le lieu, puis un éclair selon le résultat ;
//   - divisions : les pions qui changent d'état glissent de l'un à l'autre ;
//   - fronts : la ligne ondule (attaque, percée) et les flèches avancent vers l'axe ;
//   - blocus : une onde sur la zone de mer ; les flottes dérivent lentement ;
//   - après un tour : la caméra survole les lieux des batailles, avec « Passer ».
// Tout passe par feature-state, les propriétés de peinture et de petites sources
// GeoJSON ; seul ce qui est à l'écran s'anime ; le réglage « Animations »
// raccourcit ou coupe tout (et l'ambiance et le survol en « réduites »).

import React, { useEffect, useMemo, useRef } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import { RESULT_FLASH, FRONT_DASH_SPEED, battlePulseAt, dashSequence, divisionMoves, glideAt, onScreen } from "./motionPlan.js";
import { addAmbient, animate, currentTimings } from "./motionEngine.js";
import { showSkipButton } from "./motionOverlays.js";

const EMPTY = Object.freeze({ type: "FeatureCollection", features: [] });
const boundsOf = (map) => {
  try { const b = map.getBounds(); return [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]]; } catch { return null; }
};

const ArmiesMotion = ({ map, centers, battles, armies, blockades, seas, navalMarks, colourOf }) => {
  const battleSeen = useRef(null);
  const armiesBefore = useRef(null);
  const [battleData, setBattleData] = React.useState(EMPTY);
  const [moveData, setMoveData] = React.useState(EMPTY);

  // Bataille : pulsation puis éclair, pour les batailles nouvelles et à l'écran.
  useEffect(() => {
    if (!map || !centers) return undefined;
    const ids = (battles ?? []).map((battle) => battle.id);
    if (battleSeen.current === null) { battleSeen.current = new Set(ids); return undefined; }
    const fresh = (battles ?? []).filter((battle) => !battleSeen.current.has(battle.id) && centers[battle.stateId]);
    for (const id of ids) battleSeen.current.add(id);
    const T = currentTimings();
    const bounds = boundsOf(map);
    const shown = fresh.filter((battle) => onScreen(centers[battle.stateId], bounds));
    if (!shown.length || !T.battlePulse) return undefined;
    setBattleData({
      type: "FeatureCollection",
      features: shown.map((battle, index) => ({ type: "Feature", id: index + 1, properties: { flashColour: RESULT_FLASH[battle.result] ?? "#fde68a" }, geometry: { type: "Point", coordinates: centers[battle.stateId] } })),
    });
    const total = T.battlePulse + T.battleFlash;
    const stop = animate({
      duration: total + 100 * shown.length,
      update: (_, elapsed) => {
        shown.forEach((battle, index) => {
          const state = battlePulseAt(elapsed - index * 100, { pulse: T.battlePulse, flash: T.battleFlash });
          map.setFeatureState({ source: "motion-battles-source", id: index + 1 }, { r: Math.round(state.radius), op: Math.round(state.opacity * 20) / 20, flash: state.flash });
        });
      },
      done: () => setBattleData(EMPTY),
    });
    return stop;
  }, [map, centers, battles]);

  // Divisions : les pions qui changent d'état glissent de l'un à l'autre.
  useEffect(() => {
    if (!map || !centers || !armies) return undefined;
    const before = armiesBefore.current;
    armiesBefore.current = armies;
    if (!before) return undefined;
    const T = currentTimings();
    const bounds = boundsOf(map);
    const moves = divisionMoves(before, armies, centers).filter((move) => onScreen(centers[move.from], bounds) || onScreen(centers[move.to], bounds)).slice(0, 120);
    if (!moves.length || !T.glide) return undefined;
    const frameOf = (progress) => ({
      type: "FeatureCollection",
      features: moves.map((move) => ({ type: "Feature", properties: { colour: colourOf(move.owner), count: move.count }, geometry: { type: "Point", coordinates: glideAt(centers[move.from], centers[move.to], progress) } })),
    });
    let last = -1;
    const stop = animate({
      duration: T.glide,
      update: (progress) => {
        const step = Math.round(progress * 30);
        if (step === last) return;
        last = step;
        map.getSource?.("motion-moves-source")?.setData(frameOf(progress));
      },
      done: () => { map.getSource?.("motion-moves-source")?.setData(EMPTY); setMoveData(EMPTY); },
    });
    setMoveData(frameOf(0));
    return stop;
  }, [map, centers, armies, colourOf]);

  // Fronts : la ligne ondule, les flèches avancent (ambiance, animations complètes).
  useEffect(() => {
    if (!map || !currentTimings().ambient) return undefined;
    const sequence = dashSequence(2, 2, 14);
    let step = 0; let lastTime = 0;
    return addAmbient((time) => {
      if (time - lastTime < FRONT_DASH_SPEED.breakthrough) return;
      lastTime = time;
      step = (step + 1) % sequence.length;
      for (const id of ["worldmap-fronts-motion", "worldmap-front-arrows"]) {
        if (map.getLayer?.(id)) map.setPaintProperty(id, "line-dasharray", sequence[step]);
      }
    });
  }, [map]);

  // Blocus : une onde sur la zone de mer ; flottes : une lente dérive.
  const blockadeData = useMemo(() => ({
    type: "FeatureCollection",
    features: (blockades ?? []).map((blockade, index) => seas?.zones?.[blockade.zoneId]?.center && ({ type: "Feature", id: index + 1, properties: {}, geometry: { type: "Point", coordinates: seas.zones[blockade.zoneId].center } })).filter(Boolean),
  }), [blockades, seas]);
  useEffect(() => {
    if (!map || !currentTimings().ambient || (!blockadeData.features.length && !navalMarks?.features?.length)) return undefined;
    let lastTime = 0;
    return addAmbient((time) => {
      if (time - lastTime < 80) return;
      lastTime = time;
      const bounds = boundsOf(map);
      blockadeData.features.forEach((feature) => {
        if (!onScreen(feature.geometry.coordinates, bounds, 4)) return;
        const phase = ((time / 2400) + feature.id * 0.3) % 1;
        map.setFeatureState({ source: "motion-blockade-source", id: feature.id }, { r: Math.round(8 + 40 * phase), op: Math.round((1 - phase) * 20) / 20 });
      });
      if (navalMarks?.features?.length && Math.round(time / 80) % 2 === 0) {
        const drift = {
          ...navalMarks,
          features: navalMarks.features.map((feature, index) => {
            const [lng, lat] = feature.geometry.coordinates;
            const a = time / 4000 + index;
            return { ...feature, geometry: { ...feature.geometry, coordinates: [lng + 0.15 * Math.sin(a), lat + 0.08 * Math.cos(a * 1.3)] } };
          }),
        };
        map.getSource?.("worldmap-naval-source")?.setData(drift);
      }
    });
  }, [map, blockadeData, navalMarks]);

  // Après un tour : la caméra survole les lieux des batailles, dans l'ordre.
  const tourSeen = useRef(null);
  useEffect(() => {
    if (!map || !centers) return undefined;
    const key = (battles ?? []).map((battle) => battle.id).join("|");
    if (tourSeen.current === null) { tourSeen.current = key; return undefined; }
    if (!key || key === tourSeen.current) return undefined;
    tourSeen.current = key;
    const T = currentTimings();
    if (!T.tour) return undefined;
    const stops = [];
    const seen = new Set();
    for (const battle of [...battles].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      if (!centers[battle.stateId] || seen.has(battle.stateId)) continue;
      seen.add(battle.stateId);
      stops.push(centers[battle.stateId]);
      if (stops.length >= 8) break;
    }
    if (!stops.length) return undefined;
    let cancelled = false;
    let timer = null;
    const stop = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      removeButton();
      map.off("dragstart", stop);
      map.off("wheel", stop);
    };
    const removeButton = showSkipButton(map, stop);
    map.on("dragstart", stop);
    map.on("wheel", stop);
    const visit = (index) => {
      if (cancelled || index >= stops.length) { stop(); return; }
      map.flyTo({ center: stops[index], zoom: Math.max(map.getZoom(), 5), duration: Math.round(T.tourStop * 0.6), essential: false });
      timer = setTimeout(() => visit(index + 1), T.tourStop);
    };
    timer = setTimeout(() => visit(0), 1200);
    return stop;
  }, [map, centers, battles]);

  return (
    <>
      <Source id="motion-battles-source" type="geojson" data={battleData}>
        <Layer
          id="motion-battles"
          type="circle"
          paint={{
            "circle-radius": ["coalesce", ["feature-state", "r"], 0],
            "circle-color": ["case", [">", ["coalesce", ["feature-state", "flash"], 0], 0], ["get", "flashColour"], "#fde68a"],
            "circle-opacity": ["coalesce", ["feature-state", "op"], 0],
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 1,
            "circle-stroke-opacity": ["coalesce", ["feature-state", "op"], 0],
          }}
        />
      </Source>
      <Source id="motion-moves-source" type="geojson" data={moveData}>
        <Layer
          id="motion-moves"
          type="circle"
          paint={{ "circle-radius": 7, "circle-color": ["get", "colour"], "circle-opacity": 0.85, "circle-stroke-color": "#111", "circle-stroke-width": 1.5 }}
        />
      </Source>
      <Source id="motion-blockade-source" type="geojson" data={blockadeData}>
        <Layer
          id="motion-blockade"
          type="circle"
          paint={{
            "circle-radius": ["coalesce", ["feature-state", "r"], 0],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#991b1b",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": ["coalesce", ["feature-state", "op"], 0],
          }}
        />
      </Source>
    </>
  );
};

export default ArmiesMotion;
