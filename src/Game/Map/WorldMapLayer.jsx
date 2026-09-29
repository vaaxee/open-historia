// Carte mondiale unique (phase 5) — la carte des provinces dans le jeu.
//
// Tuiles vectorielles servies par le serveur (server/worldMap.js) : la
// géométrie ne change jamais. Chaque province est coloriée par « feature-state »
// (la couleur de son propriétaire) ; chaque limite reçoit son genre (province,
// état, pays) d'après les propriétaires de ses deux provinces
// (runtime/worldmap/borders.js). Les noms de pays sont placés par Nations.jsx
// sur la réunion des provinces de chaque pays (worldMapStore.js).
//
// Une partie créée sur la carte mondiale (étape E : ses régions sont les états
// de la carte) l'affiche toujours, en mode scenario. Sinon, deux aperçus
// (?worldmap=… dans l'adresse, ou localStorage["oh:worldmap"]) :
//   today     les pays d'aujourd'hui (Natural Earth)
//   scenario  le scénario actif converti (provinces.v1.json), avec les
//             changements de territoire de la partie (par état)
// ?worldmap=off la cache.
//
// Phase 9, dans l'esprit de la proposition v3 : le terrain de chaque province
// (plaine, forêt, marais…) sous des aplats politiques translucides, le relief
// ombré (tuiles d'altitude locales), une mer ardoise avec un halo le long des
// côtes, des frontières doublées, des noms gravés clairs. Et le motion design
// (motion/) : la couleur d'une prise se répand depuis l'état voisin puis les
// hachures apparaissent ; une annexion passe en fondu et sa frontière se
// redessine ; un pays qui capitule se désature sous un tampon.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { JSON_URLS, getNationColors, readJson } from "../../runtime/assets.js";
import { cssColourToRgb, hatchPixels, occupationFeatures, occupiedStates } from "./occupationHatch.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import {
  BORDER_KIND, arcKind, changedProvinces, provinceOwners, todayColour,
} from "../../runtime/worldmap/borders.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import ArmiesLayer from "./ArmiesLayer.jsx";
import { getFrontDraw, toggleFrontDrawState } from "./frontDrawStore.js";
import { setWorldMapState, worldMapPreviewMode } from "./worldMapStore.js";
import { adjacencyFromArcs, classifyOwnerChanges, desaturate, easeAt, onScreen, spreadOrder } from "./motion/motionPlan.js";
import { animate, currentTimings } from "./motion/motionEngine.js";
import { stateOutlineLines, stampCapitulation } from "./motion/motionOverlays.js";

export { worldMapPreviewMode };
const SOURCE = "worldmap";
const NEUTRAL = "#d8cfb8";
// La mer ardoise de la proposition v3 : une nappe opaque sous les provinces, qui
// recouvre l'ancienne carte politique.
const SEA = "#27384f";
const SEA_SHEET = Object.freeze({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }],
});
// Le terrain sous les aplats politiques (proposition v3 : vert-brun).
export const TERRAIN_COLOURS = Object.freeze({
  plaine: "#b8b36d", foret: "#4f7a3c", colline: "#a0814f", montagne: "#8c8a84", marais: "#5e8a7c", jungle: "#3f6b35", urbain: "#9c9690", desert: "#d4c08a",
});
// L'opacité des aplats politiques sur le terrain.
export const POLITICAL_OPACITY = 0.62;

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
const selectSovereignty = (world) => world?.regionSovereigntyOverrides ?? null;
const selectCapitulations = (world) => world?.capitulations ?? null;
const EMPTY_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });

// La couleur d'une province : de `from` vers `color` selon `t` (motion design).
const FILL_COLOUR = [
  "interpolate", ["linear"], ["coalesce", ["feature-state", "t"], 1],
  0, ["to-color", ["coalesce", ["feature-state", "from"], ["feature-state", "color"], NEUTRAL]],
  1, ["to-color", ["coalesce", ["feature-state", "color"], NEUTRAL]],
];

const WorldMapLayer = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef;
  const [mode, setMode] = useState(worldMapPreviewMode);
  const [data, setData] = useState(null);
  const overrides = useRuntimeState("world", selectOverrides);
  const sovereignty = useRuntimeState("world", selectSovereignty);
  const capitulations = useRuntimeState("world", selectCapitulations);
  const [statesGeojson, setStatesGeojson] = useState(null);
  const [annexLines, setAnnexLines] = useState(EMPTY_COLLECTION);
  const applied = useRef({ owners: null, sovereign: null, source: null, capitulated: null });
  const hatchShown = useRef(new Set());
  const hatchDelay = useRef(0);

  // Les pays qui ont capitulé : leurs provinces se désaturent (motion design).
  const capitulated = useMemo(() => new Set((Array.isArray(capitulations) ? capitulations : []).map((entry) => String(entry?.polity ?? "")).filter(Boolean)), [capitulations]);
  const colourFor = useMemo(() => (owner) => {
    const base = data?.colourOf(owner) ?? NEUTRAL;
    return capitulated.has(owner) ? desaturate(base) : base;
  }, [data, capitulated]);

  // The states' outlines (the game's regions are the world map's states), for the
  // hatching of occupied states and the borders an annexation redraws.
  const occupied = useMemo(
    () => (data?.useOverrides ? occupiedStates({ sovereignty: sovereignty ?? {}, ownership: overrides ?? {}, stateOwners: data.scenario?.stateOwners ?? {} }) : []),
    [data, sovereignty, overrides],
  );
  const needOutlines = occupied.length > 0 || Boolean(sovereignty && Object.keys(sovereignty).length);
  useEffect(() => {
    if (!needOutlines || statesGeojson) return undefined;
    let alive = true;
    readJson(JSON_URLS.regionsGeojson, { defaultValue: null, clone: false })
      .then((geojson) => { if (alive && geojson) setStatesGeojson(geojson); })
      .catch((error) => console.warn("Carte mondiale : contours des états indisponibles pour les hachures :", error));
    return () => { alive = false; };
  }, [needOutlines, statesGeojson]);
  const occupation = useMemo(() => {
    if (!occupied.length || !statesGeojson) return EMPTY_COLLECTION;
    const features = occupationFeatures(occupied, statesGeojson).map((feature) => ({ ...feature, id: undefined, properties: { ...feature.properties, stateId: feature.properties?.state ?? feature.properties?.id ?? "" } }));
    return { type: "FeatureCollection", features };
  }, [occupied, statesGeojson]);
  // One stripe image per sovereign, in its colour.
  useEffect(() => {
    if (!map || !data || !occupation.features.length) return;
    for (const feature of occupation.features) {
      const { pattern, sovereign } = feature.properties;
      if (map.hasImage?.(pattern)) continue;
      map.addImage(pattern, { width: 16, height: 16, data: hatchPixels(cssColourToRgb(data.colourOf(sovereign))) });
    }
  }, [map, data, occupation]);
  // Motion design : les hachures d'une nouvelle occupation apparaissent en fondu,
  // après la couleur du vainqueur.
  useEffect(() => {
    if (!map || !occupation.features.length || !map.getSource?.("worldmap-occupation-source")) return undefined;
    const fresh = occupation.features.map((feature) => feature.properties.stateId).filter((id) => id && !hatchShown.current.has(id));
    if (!fresh.length) return undefined;
    const T = currentTimings();
    const firstRun = hatchShown.current.size === 0 && applied.current.owners === null;
    for (const id of fresh) hatchShown.current.add(id);
    if (firstRun || !T.hatchFade) return undefined;
    const set = (value) => { for (const id of fresh) map.setFeatureState({ source: "worldmap-occupation-source", id }, { o: value }); };
    set(0);
    const timer = setTimeout(() => animate({ duration: T.hatchFade, update: (progress) => set(progress), done: () => set(1) }), hatchDelay.current);
    return () => clearTimeout(timer);
  }, [map, occupation]);

  // La partie se joue-t-elle sur la carte mondiale ?
  useEffect(() => {
    if (mode) return undefined;
    let alive = true;
    fetchJson("/api/worldmap/status")
      .then((status) => { if (alive && status?.available && status.game) setMode("scenario"); })
      .catch(() => {});
    return () => { alive = false; };
  }, [mode]);

  useEffect(() => {
    if (mode !== "today" && mode !== "scenario") return undefined;
    let alive = true;
    (async () => {
      const status = await fetchJson("/api/worldmap/status");
      if (!status?.available) return null;
      const [provinces, arcs] = await Promise.all([fetchJson("/api/worldmap/v1/provinces.json"), fetchJson("/api/worldmap/v1/arcs-index.json")]);
      const stateOfProvince = provinces.map((p) => p.state ?? "");
      // Phase 9 : le terrain et le centre de chaque province (motion design, v3).
      const terrain = provinces.map((p) => TERRAIN_COLOURS[p.terrain] ?? TERRAIN_COLOURS.plaine);
      const centers = provinces.map((p) => (Array.isArray(p.center) ? p.center : null));
      const adjacency = adjacencyFromArcs(arcs);
      if (mode === "today") {
        const countries = await fetchJson("/api/worldmap/v1/countries-today.json");
        const scenario = { owners: provinces.map((p) => countries[p.country]?.name ?? ""), states: stateOfProvince };
        const colours = new Map(Object.values(countries).map((c) => [c.name, todayColour(c)]));
        return { scenario, arcs, terrain, centers, adjacency, colourOf: (owner) => colours.get(owner) ?? NEUTRAL, useOverrides: false, stamp: status.stamp };
      }
      const scenario = await fetchJson("/api/worldmap/scenario");
      const palette = await getNationColors().catch(() => ({}));
      const colourOf = (owner) => {
        // Les pays du jeu, puis ceux que la correction de 1936 ajoute (Dantzig, Tanger).
        const rgb = palette?.[owner] ?? scenario.newOwners?.[owner]?.color;
        return Array.isArray(rgb) ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : owner ? hashedColour(owner) : NEUTRAL;
      };
      return { scenario, arcs, terrain, centers, adjacency, colourOf, useOverrides: true, stamp: status.stamp };
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
  // Le souverain de chaque province : une prise change le propriétaire, une
  // annexion aussi le souverain.
  const sovereigns = useMemo(() => {
    if (!data || !owners) return null;
    return owners.map((owner, index) => String(sovereignty?.[data.scenario.states?.[index]] ?? "") || owner);
  }, [data, owners, sovereignty]);

  useEffect(() => {
    if (!owners) return;
    const ownerLabels = Object.fromEntries(Object.entries(data?.scenario?.newOwners ?? {}).map(([owner, info]) => [owner, info?.label ?? owner]));
    setWorldMapState({
      active: true, mode, owners, ownerLabels, ownersKey: `${mode}:${owners.length}:${owners.join("|").length}`,
      // Phase 7.7 : les états du scénario, pour le panneau Fronts.
      stateOwners: data?.scenario?.stateOwners ?? null,
      stateNames: Object.fromEntries(Object.entries(data?.scenario?.stateInfo ?? {}).map(([id, info]) => [id, info?.name ?? id])),
    });
  }, [owners, mode, data]);

  // Phase 7.7 : pendant qu'on dessine un front (frontDrawStore.js), un clic sur
  // une province ajoute ou retire son état du tracé.
  useEffect(() => {
    if (!map || !data?.useOverrides) return undefined;
    const onClick = (event) => {
      if (!getFrontDraw().drawing) return;
      const feature = map.queryRenderedFeatures?.(event.point, { layers: ["worldmap-fill"] })?.[0];
      const province = Number(feature?.id);
      const stateId = Number.isFinite(province) ? data.scenario?.states?.[province - 1] : "";
      if (stateId) toggleFrontDrawState(stateId);
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [map, data]);
  useEffect(() => () => setWorldMapState({ active: false, owners: null }), []);

  // Phase 9 : les noms de pays gravés de la proposition v3 (clairs, contour sombre).
  useEffect(() => {
    if (!map || !data) return undefined;
    const engrave = () => {
      for (const id of ["country-curved-labels", "country-labels", "country-line-labels-live-world", "country-line-labels-live-detail", "country-labels-live-managed", "country-labels-live-overlap"]) {
        if (!map.getLayer?.(id)) continue;
        try {
          map.setPaintProperty(id, "text-color", "#ece6d4");
          map.setPaintProperty(id, "text-halo-color", "rgba(30, 27, 22, 0.95)");
          map.setPaintProperty(id, "text-halo-width", 2.2);
        } catch { /* a layer without text paint keeps its own */ }
      }
    };
    engrave();
    map.on("styledata", engrave);
    return () => map.off("styledata", engrave);
  }, [map, data]);

  // Couleurs et genres de limites, par feature-state : tout la première fois,
  // puis seulement ce que touchent les provinces qui ont changé de mains — avec
  // leur animation (motion design).
  useEffect(() => {
    if (!map || !data || !owners) return undefined;
    let stops = [];
    const apply = () => {
      const source = map.getSource(SOURCE);
      if (!source) return false;
      const same = applied.current.source === source;
      const previous = same ? applied.current.owners : null;
      const previousSovereign = same ? applied.current.sovereign : null;
      const previousCapitulated = same ? applied.current.capitulated : null;
      const set = (id, state) => map.setFeatureState({ source: SOURCE, sourceLayer: "provinces", id }, state);
      // Premier passage : tout, sans animation (et le terrain).
      if (!previous) {
        owners.forEach((owner, index) => set(index + 1, { color: colourFor(owner), terrain: data.terrain?.[index], t: 1 }));
      } else {
        const T = currentTimings();
        const bounds = (() => { try { const b = map.getBounds(); return [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]]; } catch { return null; } })();
        const visible = (id) => onScreen(data.centers?.[id - 1], bounds);
        const { captures, annexations } = classifyOwnerChanges({ owners: previous, sovereign: previousSovereign ?? previous }, { owners, sovereign: sovereigns ?? owners });
        // Une prise : la couleur se répand depuis l'état voisin du vainqueur.
        const spread = captures.filter(visible);
        const rank = spreadOrder(spread, { adjacency: data.adjacency, newOwnerOf: (id) => owners[id - 1], oldOwnerOf: (id) => previous[id - 1] });
        const deepest = Math.max(0, ...rank.values());
        hatchDelay.current = spread.length ? deepest * T.spreadStep + T.spreadFade : 0;
        for (const id of [...captures, ...annexations]) {
          const moving = rank.has(id) || (annexations.includes(id) && visible(id));
          set(id, { from: colourFor(previous[id - 1]), color: colourFor(owners[id - 1]), t: moving && T.spreadFade ? 0 : 1 });
        }
        if (spread.length && T.spreadFade) {
          const last = new Map();
          stops.push(animate({
            duration: hatchDelay.current,
            update: (_, elapsed) => {
              for (const [id, order] of rank) {
                const t = Math.round(easeAt(elapsed, order * T.spreadStep, T.spreadFade) * 20) / 20;
                if (last.get(id) === t) continue;
                last.set(id, t);
                set(id, { t });
              }
            },
            done: () => { for (const id of rank.keys()) set(id, { t: 1 }); },
          }));
        }
        // Une annexion : fondu d'un coup, et la frontière qui se redessine.
        const fading = annexations.filter(visible);
        if (fading.length && T.annexFade) {
          stops.push(animate({ duration: T.annexFade, update: (progress) => { for (const id of fading) set(id, { t: progress }); }, done: () => { for (const id of fading) set(id, { t: 1 }); } }));
          const states = [...new Set(fading.map((id) => data.scenario.states?.[id - 1]).filter(Boolean))];
          if (statesGeojson && states.length) setAnnexLines(stateOutlineLines(states, statesGeojson));
        }
        // Une capitulation : le pays se désature, sous un tampon.
        const fresh = [...capitulated].filter((polity) => !previousCapitulated?.has(polity));
        for (const polity of fresh) {
          const ids = owners.map((owner, index) => (owner === polity ? index + 1 : 0)).filter(Boolean);
          const base = data.colourOf(polity);
          for (const id of ids) set(id, { from: base, color: desaturate(base), t: T.desaturate ? 0 : 1 });
          if (T.desaturate) stops.push(animate({ duration: T.desaturate, update: (progress) => { for (const id of ids) set(id, { t: progress }); } }));
          const inView = ids.map((id) => data.centers?.[id - 1]).filter((point) => onScreen(point, bounds));
          if (inView.length && T.stamp) {
            const lng = inView.reduce((sum, point) => sum + point[0], 0) / inView.length;
            const lat = inView.reduce((sum, point) => sum + point[1], 0) / inView.length;
            stampCapitulation(map, [lng, lat], { duration: T.stamp });
          }
        }
      }
      const changed = previous ? changedProvinces(previous, owners) : owners.map((_, k) => k + 1);
      const touched = new Set(changed);
      const ownerOf = (id) => owners[id - 1] ?? "";
      const stateOf = (id) => data.scenario.states?.[id - 1] ?? "";
      for (const [id, a, b] of data.arcs) {
        if (previous && !touched.has(a) && !touched.has(b)) continue;
        // Phase 9 : une côte (limite avec la mer, province 0) porte le halo v3.
        map.setFeatureState({ source: SOURCE, sourceLayer: "arcs", id }, { kind: arcKind(a, b, ownerOf, stateOf), coast: !a || !b });
      }
      applied.current = { owners, sovereign: sovereigns, source, capitulated: new Set(capitulated) };
      enforceMapLayerOrder(map);
      return true;
    };
    if (apply()) return () => { for (const stop of stops) stop(); };
    const retry = () => { if (apply()) map.off("sourcedata", retry); };
    map.on("sourcedata", retry);
    return () => { map.off("sourcedata", retry); for (const stop of stops) stop(); };
  }, [map, data, owners, sovereigns, capitulated, colourFor, statesGeojson]);

  // La frontière d'une annexion se redessine d'un trait qui avance.
  useEffect(() => {
    if (!map || !annexLines.features.length || !map.getLayer?.("motion-border")) return undefined;
    const T = currentTimings();
    const paint = (p) => {
      const at = Math.max(0.0001, Math.min(0.9999, p));
      map.setPaintProperty("motion-border", "line-gradient", ["interpolate", ["linear"], ["line-progress"], 0, "#fff3c4", at, "#fff3c4", Math.min(1, at + 0.0001), "rgba(255,243,196,0)"]);
    };
    paint(0);
    const stop = animate({ duration: T.borderDraw, update: paint, done: () => setTimeout(() => setAnnexLines(EMPTY_COLLECTION), 800) });
    return stop;
  }, [map, annexLines]);

  if (!data) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <>
    <Source id="worldmap-sea-source" type="geojson" data={SEA_SHEET}>
      <Layer id="worldmap-sea" type="fill" paint={{ "fill-color": SEA, "fill-antialias": false }} />
    </Source>
    <Source id={SOURCE} type="vector" tiles={[`${origin}/api/worldmap/v1/tiles/{z}/{x}/{y}.pbf?v=${data.stamp ?? ""}`]} minzoom={0} maxzoom={8}>
      {/* Phase 9 (v3) : un halo bleu le long des côtes, sur la mer. */}
      <Layer
        id="worldmap-coast-halo"
        type="line"
        source-layer="arcs"
        layout={{ "line-join": "round" }}
        paint={{
          "line-color": "#5a7aa3",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 3, 4, 7, 7, 12],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 1, 2, 4, 5, 7, 8],
          "line-opacity": ["case", ["boolean", ["feature-state", "coast"], false], 0.5, 0],
        }}
      />
      {/* Le terrain de chaque province, sous les aplats politiques. */}
      <Layer
        id="worldmap-terrain"
        type="fill"
        source-layer="provinces"
        paint={{ "fill-color": ["to-color", ["coalesce", ["feature-state", "terrain"], TERRAIN_COLOURS.plaine]], "fill-antialias": false }}
      />
      <Layer
        id="worldmap-fill"
        type="fill"
        source-layer="provinces"
        paint={{ "fill-color": FILL_COLOUR, "fill-opacity": POLITICAL_OPACITY, "fill-antialias": false }}
      />
      <Layer
        id="worldmap-province-lines"
        type="line"
        source-layer="arcs"
        layout={{ "line-join": "round" }}
        paint={{
          "line-color": ["case", ["==", ["feature-state", "kind"], BORDER_KIND.state], "rgba(20, 20, 20, 0.5)", "rgba(20, 20, 20, 0.22)"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.15, 4, 0.35, 6, 0.7, 9, 1.2],
          "line-opacity": ["case", ["==", ["feature-state", "kind"], BORDER_KIND.country], 0, 1],
        }}
      />
      {/* Frontières doublées (v3) : un trait sombre, un filet clair dedans. */}
      <Layer
        id="worldmap-country-borders"
        type="line"
        source-layer="arcs"
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={{
          "line-color": "rgba(22, 22, 22, 0.88)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 4, 1.8, 7, 2.8],
          "line-opacity": ["case", ["all", ["==", ["feature-state", "kind"], BORDER_KIND.country], ["!", ["boolean", ["feature-state", "coast"], false]]], 1, 0],
        }}
      />
      <Layer
        id="worldmap-country-borders-inner"
        type="line"
        source-layer="arcs"
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={{
          "line-color": "rgba(240, 232, 205, 0.75)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.25, 4, 0.5, 7, 0.9],
          "line-opacity": ["case", ["all", ["==", ["feature-state", "kind"], BORDER_KIND.country], ["!", ["boolean", ["feature-state", "coast"], false]]], 1, 0],
        }}
      />
    </Source>
    {/* Le relief ombré, depuis les tuiles d'altitude locales (zooms 0 à 4). */}
    <Source id="worldmap-dem" type="raster-dem" tiles={[`${origin}/api/worldmap/dem/{z}/{x}/{y}.png`]} tileSize={256} maxzoom={4} encoding="terrarium">
      <Layer
        id="worldmap-relief"
        type="hillshade"
        paint={{
          "hillshade-exaggeration": 0.45,
          "hillshade-shadow-color": "#2b2418",
          "hillshade-highlight-color": "#fff6e0",
          "hillshade-accent-color": "#5c4a2e",
          "hillshade-illumination-direction": 315,
        }}
      />
    </Source>
    {/* Occupied states: stripes in the lawful sovereign's colour over the occupier's
        (occupationHatch.js). The layer order puts them under the borders. */}
    <Source id="worldmap-occupation-source" type="geojson" data={occupation} promoteId="stateId">
      <Layer id="worldmap-occupation" type="fill" paint={{ "fill-pattern": ["get", "pattern"], "fill-antialias": false, "fill-opacity": ["coalesce", ["feature-state", "o"], 1] }} />
    </Source>
    {/* Motion design : la frontière d'une annexion, tracée d'un trait qui avance. */}
    <Source id="motion-border-source" type="geojson" data={annexLines} lineMetrics>
      <Layer id="motion-border" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-width": 3, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(255,243,196,0)", 1, "rgba(255,243,196,0)"] }} />
    </Source>
    {/* Phase 7.6 : armées, fronts et batailles (ArmiesLayer.jsx), dans une partie qui en a. */}
    {data.useOverrides ? <ArmiesLayer stateOwners={data.scenario?.stateOwners ?? {}} colourOf={data.colourOf} /> : null}
    </>
  );
};

export default WorldMapLayer;
