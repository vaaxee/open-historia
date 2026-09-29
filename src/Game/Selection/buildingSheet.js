// Phase 9 — la fiche d'un bâtiment au clic (Features.jsx) : niveau, production
// réelle (selon son état), entretien (la réparation qu'il attend), effets, dégâts.
// Pur, à partir de runtime/hoi/buildings.js.

import { BUILDING_TUNING, HOI_BUILDING_TYPES, buildingContribution, describeBuildingEffect, repairCost } from "../../runtime/hoi/buildings.js";

const round = (value) => Math.round(Number(value) || 0);

export const buildingSheetRows = (building) => {
  const spec = HOI_BUILDING_TYPES[building?.type];
  if (!spec) return [];
  const condition = Number(building.condition ?? 100);
  const part = buildingContribution(building);
  const extraction = Object.entries(part.extraction).map(([resource, amount]) => `+${amount} ${resource}/mois`);
  const production = [
    part.civilian ? `+${part.civilian} usines civiles` : "",
    part.military ? `+${part.military} usines militaires` : "",
    ...extraction,
  ].filter(Boolean).join(", ") || (building.legacy ? "comptée dans l'économie de départ" : spec.effect.kind === "none" ? "aucune (effet militaire)" : "aucune");
  const working = condition >= BUILDING_TUNING.minWorkingCondition;
  return [
    { key: "level", label: "Level", value: `${building.level} / ${spec.maxLevel}` },
    { key: "production", label: "Production", value: working ? production : `arrêtée (état sous ${BUILDING_TUNING.minWorkingCondition} %)` },
    { key: "upkeep", label: "Upkeep", value: condition < 100 ? `réparation : ${round(repairCost(building) * (1 - condition / 100))} points de construction` : "aucun (intact)" },
    { key: "effect", label: "Effect", value: describeBuildingEffect(building) },
    { key: "damage", label: "Damage", value: condition >= 100 ? "aucun" : condition <= 0 ? "détruit" : `${round(100 - condition)} %` },
  ];
};
