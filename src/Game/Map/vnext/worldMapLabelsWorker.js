// Carte mondiale unique (phase 5) — les noms de pays, hors du fil de l'écran.
//
// Reçoit la forme de chaque pays (réunion de ses provinces, calculée par le
// serveur : POST /api/worldmap/surfaces) et le nom à afficher de chaque
// propriétaire ; rend les mêmes collections que le travailleur des frontières
// (polityBoundariesWorker.js), placées et courbées par le même moteur de noms
// (polityLabels.js) sur la forme réelle du pays.

import { buildPolityLabelCollections } from "./polityLabels.js";

const EMPTY = { type: "FeatureCollection", features: [] };

self.onmessage = (event) => {
  const { requestId, surfaces, names } = event.data ?? {};
  const logical = []; const ptr = []; const points = []; const lines = [];
  for (const feature of surfaces?.features ?? []) {
    const owner = String(feature?.properties?.owner ?? "").trim();
    if (!owner) continue;
    try {
      const collections = buildPolityLabelCollections(
        { type: "FeatureCollection", features: [feature] },
        { nameResolver: () => String(names?.[owner] ?? owner).trim() || owner },
      );
      logical.push(...(collections?.labelData ?? EMPTY).features);
      ptr.push(...(collections?.ptrLabelData ?? EMPTY).features);
      points.push(...(collections?.pointLabelData ?? EMPTY).features);
      lines.push(...(collections?.lineLabelData ?? EMPTY).features);
    } catch (error) {
      console.warn(`Nom de ${owner} non placé :`, error);
    }
  }
  self.postMessage({
    requestId,
    labels: {
      labelData: { type: "FeatureCollection", features: logical },
      ptrLabelData: { type: "FeatureCollection", features: ptr },
      pointLabelData: { type: "FeatureCollection", features: points },
      lineLabelData: { type: "FeatureCollection", features: lines },
    },
  });
};
