// Phase 9 — ce que le motion design pose sur la carte en plus des couches :
// les contours d'états à retracer (annexion), le tampon « Capitulation », et le
// bouton « Passer » du survol d'après-tour. Les contours sont purs ; le tampon et
// le bouton sont de petits éléments posés sur le conteneur de la carte.

import { getStoredLanguage } from "../../../runtime/i18n.js";

const list = (value) => (Array.isArray(value) ? value : []);

// Les contours des états `stateIds` en lignes (pour line-gradient), depuis le
// GeoJSON des régions de la partie (ses régions sont les états de la carte).
export const stateOutlineLines = (stateIds, regionsGeojson) => {
  const wanted = new Set(list(stateIds).map(String));
  const features = [];
  for (const feature of list(regionsGeojson?.features)) {
    const id = String(feature?.properties?.id ?? "");
    if (!wanted.has(id)) continue;
    const geometry = feature.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const polygon of polygons) {
      const ring = list(polygon)[0];
      if (list(ring).length > 2) features.push({ type: "Feature", properties: { stateId: id }, geometry: { type: "LineString", coordinates: ring } });
    }
  }
  return { type: "FeatureCollection", features };
};

const isFrench = () => /^fr\b/i.test(String(getStoredLanguage() || ""));

// Le tampon « Capitulation », posé sur le pays, qui s'efface.
export const stampCapitulation = (map, lngLat, { duration = 2600 } = {}) => {
  const container = map?.getContainer?.();
  if (!container || typeof document === "undefined") return;
  const point = map.project(lngLat);
  const stamp = document.createElement("div");
  stamp.setAttribute("data-no-translate", "");
  stamp.textContent = isFrench() ? "Capitulation" : "Capitulation";
  Object.assign(stamp.style, {
    position: "absolute", left: `${point.x}px`, top: `${point.y}px`, transform: "translate(-50%, -50%) rotate(-12deg) scale(2.2)",
    border: "4px double #b91c1c", color: "#b91c1c", padding: "4px 14px", fontFamily: "Georgia, serif", fontWeight: "700", fontSize: "22px",
    letterSpacing: "0.12em", textTransform: "uppercase", background: "rgba(255,248,235,0.55)", opacity: "0", pointerEvents: "none", zIndex: "5",
    transition: `transform ${Math.round(duration * 0.2)}ms cubic-bezier(.2,1.6,.4,1), opacity ${Math.round(duration * 0.2)}ms ease`,
  });
  container.appendChild(stamp);
  requestAnimationFrame(() => {
    stamp.style.opacity = "0.92";
    stamp.style.transform = "translate(-50%, -50%) rotate(-12deg) scale(1)";
  });
  setTimeout(() => {
    stamp.style.transition = `opacity ${Math.round(duration * 0.3)}ms ease`;
    stamp.style.opacity = "0";
  }, Math.round(duration * 0.7));
  setTimeout(() => stamp.remove(), duration + 100);
};

// Le bouton « Passer » du survol d'après-tour. Renvoie de quoi l'enlever.
export const showSkipButton = (map, onSkip) => {
  const container = map?.getContainer?.();
  if (!container || typeof document === "undefined") return () => {};
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-no-translate", "");
  button.textContent = isFrench() ? "Passer ▸" : "Skip ▸";
  Object.assign(button.style, {
    position: "absolute", right: "1rem", top: "4.5rem", zIndex: "6", background: "rgba(24,24,27,0.9)", color: "white",
    border: "1px solid rgba(255,255,255,0.25)", borderRadius: "8px", padding: "0.45rem 0.9rem", fontSize: "0.8rem", fontWeight: "700", cursor: "pointer",
  });
  button.addEventListener("click", () => onSkip?.());
  container.appendChild(button);
  return () => button.remove();
};
