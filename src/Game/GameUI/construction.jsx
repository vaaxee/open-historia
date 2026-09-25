// Couche HOI4 — la section « Construction » du panneau Production (phase 3).
//
// Pour le pays du joueur : sa capacité de construction, sa file de chantiers
// (monter, descendre, annuler), ses bâtiments à agrandir, et un formulaire pour
// bâtir sur un site : une de ses villes ou une de ses structures. Le clic sur la
// carte viendra avec sa refonte visuelle. Les écritures passent par
// runtime/hoi/constructionOps.js et hoiWrites.js.

import React, { useEffect, useMemo, useState } from "react";

import { listHoiBuildSites } from "../AI/gameplayLazy.js";
import { effectiveFactories, findNationKey } from "../../runtime/hoi/engine.js";
import {
  HOI_BUILDING_TYPES,
  constructibleTypesFor,
  constructionCapacity,
  describeBuildingEffect,
} from "../../runtime/hoi/buildings.js";
import { cancelConstruction, moveInQueue, queueNewBuilding, queueUpgrade } from "../../runtime/hoi/constructionOps.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { HOI_WRITE_ERRORS, updateHoiWorld } from "./hoiWrites.js";

const selectMarkers = (world) => (Array.isArray(world?.markers) ? world.markers : []);
const selectDate = (game) => String(game?.gameDate ?? "");

const muted = "rgba(255,255,255,0.5)";

const smallButton = (primary = false, disabled = false) => ({
  background: primary ? "rgba(59,130,246,0.22)" : "rgba(255,255,255,0.06)",
  border: `1px solid ${primary ? "rgba(96,165,250,0.45)" : "rgba(255,255,255,0.12)"}`,
  borderRadius: 6,
  color: "white",
  cursor: disabled ? "default" : "pointer",
  fontSize: "0.7rem",
  opacity: disabled ? 0.45 : 1,
  padding: "0.18rem 0.45rem",
  whiteSpace: "nowrap",
});

const selectStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 7,
  color: "white",
  fontSize: "0.74rem",
  minWidth: 0,
  padding: "0.3rem 0.4rem",
};

const Progress = ({ value }) => (
  <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 4, marginTop: "0.2rem", overflow: "hidden" }}>
    <div style={{ background: "#60a5fa", height: "100%", width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
  </div>
);

const newId = () => `hoi-site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const ConstructionSection = ({ hoi, playerKey, nation }) => {
  const markers = useRuntimeState("world", selectMarkers);
  const gameDate = useRuntimeState("game", selectDate);
  const [sites, setSites] = useState(null);
  const [type, setType] = useState("");
  const [siteIndex, setSiteIndex] = useState(0);
  const [resource, setResource] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  // Les sites viennent de la carte (villes par région possédée) : chargés une
  // fois à l'ouverture, et rechargés quand les structures du joueur changent.
  const ownedCount = markers.filter((marker) => findNationKey(hoi, marker.ownerCode) === playerKey).length;
  useEffect(() => {
    let alive = true;
    listHoiBuildSites()
      .then((list) => { if (alive) setSites(list); })
      .catch(() => { if (alive) setSites([]); });
    return () => { alive = false; };
  }, [ownedCount]);

  const owned = useMemo(
    () => markers.filter((marker) => marker.building && findNationKey(hoi, marker.ownerCode) === playerKey),
    [markers, hoi, playerKey],
  );
  const queue = (nation.constructionQueue ?? [])
    .map((id) => owned.find((marker) => String(marker.id) === String(id)))
    .filter((marker) => marker?.building?.construction);
  const upgradable = owned.filter((marker) => {
    const spec = HOI_BUILDING_TYPES[marker.building.type];
    return !marker.building.construction && marker.building.type !== "complexe_industriel" && marker.building.level < spec.maxLevel;
  });
  const repairing = owned.filter((marker) => marker.building.level > 0 && marker.building.condition < 100);
  const types = constructibleTypesFor(nation, hoi?.tech?.tree);
  const chosenType = types.includes(type) ? type : types[0];
  const resources = [...new Set([...Object.keys(nation.stocks ?? {}), ...Object.keys(nation.extraction ?? {})])].sort();
  const chosenResource = resources.includes(resource) ? resource : (resources.includes("acier") ? "acier" : resources[0]);
  const capacity = constructionCapacity(effectiveFactories(nation).civilian);

  const act = async (mutate) => {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await updateHoiWorld((world) => {
        const { world: next, error } = mutate(world);
        return error ? { error } : { world: next };
      });
      if (!result.ok) setMessage(HOI_WRITE_ERRORS[result.error] ?? result.error);
    } finally {
      setPending(false);
    }
  };

  const site = sites?.[Math.min(siteIndex, Math.max(0, (sites?.length ?? 1) - 1))] ?? null;

  return (
    <div>
      <div style={{ color: muted, fontSize: "0.68rem", marginBottom: "0.5rem" }}>
        <span data-no-translate>{Math.round(capacity.perDay)}</span> construction points per day
        {" "}(<span data-no-translate>{Math.round(capacity.perProjectPerDay)}</span> at most per site; repairs first)
      </div>
      {message && <div style={{ color: "#fbbf24", fontSize: "0.7rem", marginBottom: "0.5rem" }}>{message}</div>}

      {repairing.length > 0 && (
        <div style={{ fontSize: "0.74rem", marginBottom: "0.6rem" }}>
          <div style={{ color: muted, fontSize: "0.66rem", marginBottom: "0.2rem" }}>Repairing</div>
          {repairing.map((marker) => (
            <div key={marker.id} style={{ marginBottom: "0.3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span data-no-translate>{marker.name}</span>
                <span data-no-translate style={{ color: "#f59e0b" }}>{Math.round(marker.building.condition)}%</span>
              </div>
              <Progress value={marker.building.condition / 100} />
            </div>
          ))}
        </div>
      )}

      {queue.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginBottom: "0.7rem" }}>
          {queue.map((marker, index) => {
            const { construction } = marker.building;
            return (
              <div key={marker.id}>
                <div style={{ alignItems: "center", display: "flex", fontSize: "0.76rem", gap: "0.3rem", justifyContent: "space-between" }}>
                  <span data-no-translate style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {index + 1}. {marker.name}
                    <span style={{ color: muted, fontWeight: 400 }}> → {construction.targetLevel}</span>
                  </span>
                  <span style={{ display: "flex", flexShrink: 0, gap: "0.2rem" }}>
                    <button type="button" aria-label="Move up" disabled={pending || index === 0} style={smallButton(false, pending || index === 0)}
                      onClick={() => act((world) => moveInQueue(world, { polity: playerKey, markerId: marker.id, delta: -1 }))}>↑</button>
                    <button type="button" aria-label="Move down" disabled={pending || index === queue.length - 1} style={smallButton(false, pending || index === queue.length - 1)}
                      onClick={() => act((world) => moveInQueue(world, { polity: playerKey, markerId: marker.id, delta: 1 }))}>↓</button>
                    <button type="button" aria-label="Cancel" disabled={pending} style={smallButton(false, pending)}
                      onClick={() => act((world) => cancelConstruction(world, { polity: playerKey, markerId: marker.id }))}>✕</button>
                  </span>
                </div>
                <Progress value={construction.progress / construction.cost} />
                <div style={{ color: muted, fontSize: "0.64rem", marginTop: "0.1rem" }}>
                  <span data-no-translate>{Math.floor(construction.progress)} / {Math.round(construction.cost)}</span> points
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ color: muted, fontSize: "0.74rem", marginBottom: "0.7rem" }}>No construction under way.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <select aria-label="Building type" value={chosenType ?? ""} onChange={(event) => setType(event.target.value)} style={{ ...selectStyle, flex: 1 }}>
            {types.map((id) => (
              <option key={id} value={id} style={{ background: "#18181b" }} data-no-translate>
                {HOI_BUILDING_TYPES[id].label} ({HOI_BUILDING_TYPES[id].cost} pts)
              </option>
            ))}
          </select>
          {chosenType === "mine" && (
            <select aria-label="Resource" value={chosenResource ?? ""} onChange={(event) => setResource(event.target.value)} style={selectStyle}>
              {resources.map((id) => <option key={id} value={id} style={{ background: "#18181b" }} data-no-translate>{id}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <select
            aria-label="Site"
            value={String(Math.min(siteIndex, Math.max(0, (sites?.length ?? 1) - 1)))}
            onChange={(event) => setSiteIndex(Number(event.target.value))}
            disabled={!sites?.length}
            style={{ ...selectStyle, flex: 1 }}
          >
            {sites === null && <option>Loading your cities…</option>}
            {sites?.length === 0 && <option>No city found for your country</option>}
            {(sites ?? []).map((entry, index) => (
              <option key={`${entry.source}-${entry.name}-${index}`} value={index} style={{ background: "#18181b" }} data-no-translate>
                {entry.name}{entry.source === "marker" ? " (structure)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !site || !chosenType}
            style={smallButton(true, pending || !site || !chosenType)}
            onClick={() => act((world) => queueNewBuilding(world, {
              polity: playerKey,
              type: chosenType,
              site,
              resource: chosenType === "mine" ? chosenResource : null,
              date: gameDate,
              id: newId(),
            }))}
          >
            Build
          </button>
        </div>
      </div>

      {upgradable.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ color: muted, fontSize: "0.66rem", marginBottom: "0.25rem" }}>Enlarge a building</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {upgradable.map((marker) => (
              <div key={marker.id} style={{ alignItems: "center", display: "flex", fontSize: "0.74rem", gap: "0.4rem", justifyContent: "space-between" }}>
                <span style={{ minWidth: 0 }}>
                  <span data-no-translate>{marker.name}</span>
                  <span data-no-translate style={{ color: muted }}> · {marker.building.level}/{HOI_BUILDING_TYPES[marker.building.type].maxLevel} · {describeBuildingEffect(marker.building)}</span>
                </span>
                <button type="button" disabled={pending} style={smallButton(false, pending)}
                  onClick={() => act((world) => queueUpgrade(world, { polity: playerKey, markerId: marker.id }))}>
                  +1
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
