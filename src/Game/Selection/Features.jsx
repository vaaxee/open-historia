/*! Open Historia — map feature (city/structure) selection UI © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { useWorldState } from "../Map/useWorldState.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { HOI_BUILDING_TYPES, describeBuildingEffect } from "../../runtime/hoi/buildings.js";

let _setSelection = null;
let _currentSelection = null;
let _dismiss = null;

// Called by the map click dispatcher (Nations.jsx) when a city or a built
// structure (world.markers) is clicked. The payload is everything the popup
// shows — cities are stateless tile features, so it all rides the click:
// { source: "city"|"marker", id?, name, kind?, population?, capital?, tier?, lng, lat }
export const onFeatureSelected = (payload) => {
  if (!_setSelection || !payload?.name) return;

  const isSame =
    _currentSelection &&
    _currentSelection.name === payload.name &&
    _currentSelection.source === payload.source;
  if (isSame) {
    _dismiss?.();
    return;
  }
  if (_currentSelection) _dismiss?.();
  _setSelection(payload);
};

// Search opens a feature without a click's toggle, so landing on the one already open leaves it open.
export const focusFeature = (payload) => {
  if (!_setSelection || !payload?.name) return;
  _setSelection(payload);
};

// Called when another selection (unit, region, empty space) takes over.
export const dismissFeaturePopup = () => {
  if (_currentSelection) _dismiss?.();
};

// DOM-side emoji per kind (the on-map glyphs are font-limited; the popup isn't).
const KIND_EMOJI = [
  // Couche HOI4 : les types de bâtiments, en français (runtime/hoi/buildings.js).
  [/complexe industriel|usine|aciérie|raffinerie/, "🏭"],
  [/^mine$/, "⛏"],
  [/aérodrome/, "✈"],
  [/city|town|settlement|metropolis|capital/, "🏙"],
  [/military base|army base|fort|fortress|barracks|garrison|outpost|citadel|castle/, "🏰"],
  [/bunker|shelter/, "🛡"],
  [/missile|silo|launch/, "🚀"],
  [/embassy|consulate/, "🏛"],
  [/port|harbor|harbour|naval/, "⚓"],
  [/airbase|airfield|airport|air base/, "✈"],
  [/nuclear|reactor|plant|power/, "⚡"],
  [/factory|industrial|refinery|mine/, "🏭"],
  [/radar|listening|intelligence|spy/, "📡"],
  [/monument|memorial|shrine|temple|cathedral|mosque/, "🗿"],
];

const emojiForKind = (kind) => {
  const normalized = String(kind || "").toLowerCase();
  for (const [pattern, emoji] of KIND_EMOJI) {
    if (pattern.test(normalized)) return emoji;
  }
  return "📍";
};

const titleCase = (value) =>
  String(value || "")
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

const TIER_LABEL = { 1: "Town", 2: "City", 3: "Major city", 4: "Capital" };

const MARKER_STATUS_META = {
  planned: { label: "Planned", color: "#e4e4e7" },
  under_construction: { label: "Under construction", color: "#fcd34d" },
  active: { label: "Active", color: "#86efac" },
  damaged: { label: "Damaged", color: "#fca5a5" },
  inactive: { label: "Inactive", color: "#d1d1d5" },
  abandoned: { label: "Abandoned", color: "#fdba74" },
  destroyed: { label: "Destroyed", color: "#f87171" },
};

const markerStatusMeta = (status) =>
  MARKER_STATUS_META[String(status || "").trim().toLowerCase()] || MARKER_STATUS_META.active;


const ANIM_ID = "feature-popup-anims";
if (typeof document !== "undefined" && !document.getElementById(ANIM_ID)) {
  const style = document.createElement("style");
  style.id = ANIM_ID;
  style.textContent = `
  @keyframes featurePopupFadeIn {
    from { opacity: 0; transform: translateY(calc(-100% + 10px)); }
    to   { opacity: 1; transform: translateY(-100%); }
  }
  @keyframes featurePopupFadeOut {
    from { opacity: 1; transform: translateY(-100%); }
    to   { opacity: 0; transform: translateY(calc(-100% + 10px)); }
  }`;
  document.head.appendChild(style);
}

const DetailRow = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "11px", color: "rgba(255,255,255,0.6)", marginTop: "3px" }}>
    <span style={{ flexShrink: 0 }}>{label}</span>
    <span style={{ color: "rgba(255,255,255,0.9)", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
  </div>
);

const Bar = ({ value, color }) => (
  <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 999, height: 4, marginTop: "3px", overflow: "hidden" }}>
    <div style={{ background: color, height: "100%", width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
  </div>
);

// Couche HOI4, phase 3 : les stats qu'un bâtiment tient du moteur
// (runtime/hoi/buildings.js) — type, niveau, effet, état, chantier.
const BuildingDetails = ({ building }) => {
  const spec = HOI_BUILDING_TYPES[building.type];
  if (!spec) return null;
  const condition = Number(building.condition ?? 100);
  const construction = building.construction;
  const conditionColor = condition <= 0 ? "#ef4444" : condition < 100 ? "#f59e0b" : "#4ade80";
  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "6px 0 4px", paddingTop: "4px" }}>
      <DetailRow label="Building" value={<span data-no-translate>{spec.label}</span>} />
      <DetailRow label="Level" value={<span data-no-translate>{building.level} / {spec.maxLevel}</span>} />
      <DetailRow label="Effect" value={<span data-no-translate>{describeBuildingEffect(building)}</span>} />
      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginTop: "3px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Condition</span>
          <span data-no-translate style={{ color: conditionColor }}>{Math.round(condition)}%</span>
        </div>
        <Bar value={condition / 100} color={conditionColor} />
      </div>
      {construction ? (
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginTop: "5px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{construction.kind === "upgrade" ? "Upgrading to level" : "Under construction, level"} <span data-no-translate>{construction.targetLevel}</span></span>
            <span data-no-translate>{Math.min(99, Math.round((construction.progress / construction.cost) * 100))}%</span>
          </div>
          <Bar value={construction.progress / construction.cost} color="#60a5fa" />
        </div>
      ) : null}
    </div>
  );
};

const FeaturePopup = () => {
  const [selection, setSelection] = useState(null);
  const [screenPos, setScreenPos] = useState(null);
  const [animKey, setAnimKey] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const { current: map } = useMap();
  const { markers } = useWorldState();

  _setSelection = (value) => {
    _currentSelection = value;
    setDismissing(false);
    setSelection(value);
    if (value !== null) setAnimKey((key) => key + 1);
  };

  _dismiss = () => setDismissing(true);

  // A selected structure tracks live world state: identity-preserving updates
  // refresh the popup, while only true canonical removal closes it. Lifecycle
  // states such as damaged/abandoned/destroyed remain inspectable historical canon.
  const liveMarker = selection?.source === "marker"
    ? markers.find((marker) => marker.id === selection.id) ?? null
    : null;

  useEffect(() => {
    if (selection?.source === "marker" && !liveMarker) _dismiss?.();
  }, [selection, liveMarker]);

  const handleAnimationEnd = (e) => {
    if (e.animationName !== "featurePopupFadeOut") return;
    _currentSelection = null;
    setSelection(null);
    setDismissing(false);
  };

  useEffect(() => {
    if (!map || !selection) {
      setScreenPos(null);
      return undefined;
    }

    const update = () => {
      const center = map.getCenter();
      const toRad = (deg) => (deg * Math.PI) / 180;
      const anchor = { lng: selection.lng, lat: selection.lat };
      const lat1 = toRad(center.lat);
      const lat2 = toRad(anchor.lat);
      const dLng = toRad(anchor.lng - center.lng);
      const cosAngle =
        Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);

      // On the globe, points around the horizon have no meaningful screen spot.
      if (cosAngle < 0) {
        setScreenPos(null);
        return;
      }

      const point = map.project(anchor);
      setScreenPos((prev) => {
        if (prev && Math.abs(prev.x - point.x) < 0.5 && Math.abs(prev.y - point.y) < 0.5) {
          return prev;
        }
        return { x: point.x, y: point.y };
      });
    };

    let frameId = 0;
    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        update();
      });
    };

    update();
    map.on("move", scheduleUpdate);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      map.off("move", scheduleUpdate);
    };
  }, [map, selection]);

  // Hook order must not depend on the selection — called before any return.
  const ownerName = useCountryDisplayName(liveMarker?.ownerCode || selection?.ownerCode || "");

  if (!selection || !screenPos) return null;

  const feature = liveMarker
    ? { ...selection, ...liveMarker }
    : selection;

  const isCity = selection.source === "city";
  const kind = isCity
    ? (feature.capital === "primary" ? "Capital city" : TIER_LABEL[feature.tier] || "City")
    : titleCase(feature.kind || "Landmark");
  const population = Number(feature.population);
  const statusMeta = markerStatusMeta(feature.status);

  const POPUP_WIDTH = 220;

  return createPortal(
    <div
      key={animKey}
      onAnimationEnd={handleAnimationEnd}
      style={{
        position: "fixed",
        left: screenPos.x - POPUP_WIDTH / 2,
        top: screenPos.y - 14,
        width: `${POPUP_WIDTH}px`,
        zIndex: 21,
        pointerEvents: dismissing ? "none" : "auto",
        animation: dismissing
          ? "featurePopupFadeOut 0.18s cubic-bezier(0.4, 0, 1, 1) both"
          : "featurePopupFadeIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(24, 24, 27, 0.96)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px 8px" }}>
          <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>
            {isCity ? (feature.capital === "primary" ? "⭐" : "🏙") : emojiForKind(feature.kind)}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "13px", wordBreak: "break-word" }}>{feature.name}</div>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "1px" }}>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>
                Map Feature · {kind}
              </span>
              {!isCity ? (
                <span style={{
                  border: `1px solid ${statusMeta.color}55`,
                  borderRadius: "999px",
                  color: statusMeta.color,
                  fontSize: "9px",
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  padding: "1px 5px",
                  textTransform: "uppercase",
                }}>
                  {statusMeta.label}
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => _dismiss?.()}
            style={{
              background: "rgba(24,24,27,0.7)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "6px",
              width: "20px",
              height: "20px",
              cursor: "pointer",
              color: "rgba(255,255,255,0.5)",
              fontSize: "11px",
              padding: 0,
              flexShrink: 0,
            }}
          >
            {"✕"}
          </button>
        </div>

        <div style={{ padding: "0 12px 10px" }}>
          {ownerName ? <DetailRow label="Owner" value={ownerName} /> : null}
          {Number.isFinite(population) && population > 0 ? (
            <DetailRow label="Population" value={population.toLocaleString()} />
          ) : null}
          {!isCity ? <DetailRow label="Status" value={statusMeta.label} /> : null}
          {feature.foundedAt ? <DetailRow label="Founded" value={feature.foundedAt} /> : null}
          {!isCity && feature.updatedDate && feature.updatedDate !== feature.foundedAt ? (
            <DetailRow label="Last changed" value={feature.updatedDate} />
          ) : null}
          {!isCity && feature.building ? <BuildingDetails building={feature.building} /> : null}
          <DetailRow label="Location" value={`${feature.lat.toFixed(2)}, ${feature.lng.toFixed(2)}`} />
          {feature.note ? (
            <div style={{ marginTop: "8px", fontSize: "11px", lineHeight: 1.45, color: "rgba(255,255,255,0.75)" }}>
              {feature.note}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FeaturePopup;
