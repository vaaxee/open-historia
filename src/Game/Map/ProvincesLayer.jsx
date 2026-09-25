// Couche HOI4 — les provinces sur la carte (phase 4).
//
// Leurs limites, fines, à partir du zoom 5 (sous les frontières des États). En
// mode « Choisir sur la carte » (panneau Construction) : les provinces du
// joueur teintées dès le zoom 3, celle sous la souris en surbrillance, et un
// clic la choisit. Échap annule.

import React, { useEffect, useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { provinceAt, provinceOwnerKey } from "../../runtime/hoi/provinces.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import {
  cancelProvincePick,
  finishProvincePick,
  getHoiProvinceState,
  loadHoiProvinces,
  setProvinceHover,
  useHoiProvinces,
} from "./hoiProvinceStore.js";

const selectHoiOn = (world) => Boolean(world?.hoi);
const selectOwnership = (world) => world;
const NONE = ["==", ["get", "id"], ""];

const ProvincesLayer = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef;
  const hoiOn = useRuntimeState("world", selectHoiOn);
  const world = useRuntimeState("world", selectOwnership);
  const { collection, index, pick, hover, selected } = useHoiProvinces();

  useEffect(() => {
    if (hoiOn) loadHoiProvinces();
  }, [hoiOn]);

  // Les provinces que le joueur peut choisir (recalculées au début du choix).
  const pickable = useMemo(() => {
    if (!pick || !index) return [];
    return index.entries.filter((entry) => provinceOwnerKey(entry, world) === pick.playerKey).map((entry) => entry.id);
  }, [pick, index, world]);

  useEffect(() => {
    if (!map || !collection) return undefined;
    const reorder = () => enforceMapLayerOrder(map);
    map.once?.("idle", reorder);
    return () => map.off?.("idle", reorder);
  }, [map, collection]);

  useEffect(() => {
    if (!map || !pick || !index) return undefined;
    const allowed = new Set(pickable);
    const canvas = map.getCanvas?.();
    const at = (event) => provinceAt(index, [event.lngLat.lng, event.lngLat.lat]);
    const onMove = (event) => {
      const entry = at(event);
      const ok = entry && allowed.has(entry.id);
      setProvinceHover(ok ? entry.id : null);
      if (canvas) canvas.style.cursor = ok ? "pointer" : "not-allowed";
    };
    const onClick = (event) => {
      const entry = at(event);
      if (entry && allowed.has(entry.id)) finishProvincePick(entry);
    };
    const onKey = (event) => { if (event.key === "Escape") cancelProvincePick(); };
    map.on("mousemove", onMove);
    map.on("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      map.off("mousemove", onMove);
      map.off("click", onClick);
      window.removeEventListener("keydown", onKey);
      if (canvas) canvas.style.cursor = "";
    };
  }, [map, pick, index, pickable]);

  if (!hoiOn || !collection?.features?.length) return null;
  const picking = Boolean(pick);

  return (
    <Source id="hoi-provinces-source" type="geojson" data={collection} tolerance={0.6} buffer={16}>
      <Layer
        id="hoi-provinces-pick-fill"
        type="fill"
        layout={{ visibility: picking ? "visible" : "none" }}
        filter={picking ? ["in", ["get", "id"], ["literal", pickable]] : NONE}
        paint={{
          // Un voile clair sur les provinces du joueur (lisible sur toutes les
          // couleurs de pays), jaune sur celle sous la souris.
          "fill-color": ["case", ["==", ["get", "id"], hover ?? ""], "#facc15", "#ffffff"],
          "fill-opacity": ["case", ["==", ["get", "id"], hover ?? ""], 0.5, 0.22],
        }}
      />
      <Layer
        id="hoi-provinces-outline"
        type="line"
        minzoom={5}
        layout={{ "line-join": "round" }}
        paint={{
          "line-color": "rgba(30, 24, 16, 0.55)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 8, 0.9, 11, 1.4],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 5.6, 0.7],
        }}
      />
      <Layer
        id="hoi-provinces-pick-outline"
        type="line"
        maxzoom={5}
        layout={{ visibility: picking ? "visible" : "none", "line-join": "round" }}
        filter={picking ? ["in", ["get", "id"], ["literal", pickable]] : NONE}
        paint={{ "line-color": "rgba(255, 255, 255, 0.55)", "line-width": 0.5 }}
      />
      <Layer
        id="hoi-provinces-selected"
        type="line"
        filter={["==", ["get", "id"], (picking ? hover : selected) ?? ""]}
        paint={{ "line-color": "#facc15", "line-width": 2.2 }}
      />
    </Source>
  );
};

// Pour la fiche d'un bâtiment : sa province, sans React.
export const provinceOfPoint = (lng, lat) => provinceAt(getHoiProvinceState().index, [lng, lat]);

export default ProvincesLayer;
