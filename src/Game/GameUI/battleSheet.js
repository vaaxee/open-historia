// Phase 7.6 — la fiche d'une bataille du moteur (runtime/hoi/combat.js), en
// lignes à afficher : les camps et leurs forces, les facteurs et leur poids, la
// puissance de chaque côté, le jet de dés, le résultat et les pertes.
// Import-free, pour les tests. Les libellés sont en anglais comme le reste de
// l'interface : le traducteur les rend dans la langue du joueur.

const list = (value) => (Array.isArray(value) ? value : []);
const forces = (counts) => Object.entries(counts ?? {}).map(([template, count]) => `${count} ${template}`).join(", ") || "—";

export const RESULT_LABELS = Object.freeze({ captured: "State captured", stalemate: "Indecisive", repelled: "Attack repelled" });

export const battleSheetRows = (battle) => {
  if (!battle) return [];
  const f = battle.factors ?? {};
  const factor = (label, value, applies = true) => (applies && Number.isFinite(value) && value !== 1 ? [{ label, value: `×${value}` }] : []);
  return [
    { label: "Attacker", value: `${battle.attacker} (${battle.posture})` },
    { label: "Attacking forces", value: forces(battle.attackers) },
    { label: "Defender", value: battle.defender },
    { label: "Defending forces", value: battle.garrison ? "Garrison only" : forces(battle.defenders) },
    { label: "Terrain", value: `${battle.terrain} (defence ×${f.terrain ?? 1})` },
    ...factor("River crossing", f.river),
    ...factor("Forts", f.fort),
    ...factor("Holding posture", f.hold),
    ...factor("Breakthrough", f.posture),
    ...(battle.weather ? [{ label: "Weather", value: `${battle.weather} (attack ×${f.weather})` }] : []),
    ...factor("Air", f.air),
    { label: "Dice", value: `×${f.dice ?? 1}` },
    { label: "Power", value: `${battle.power?.attack ?? 0} against ${battle.power?.defense ?? 0} (ratio ${battle.power?.ratio ?? 0})` },
    { label: "Result", value: RESULT_LABELS[battle.result] ?? battle.result },
    { label: "Losses", value: `${battle.losses?.attacker ?? 0} / ${battle.losses?.defender ?? 0} men` },
    ...(battle.retreatTo ? [{ label: "Defenders fell back to", value: battle.retreatTo }] : []),
    ...(battle.surrendered ? [{ label: "Surrendered", value: `${battle.surrendered} division(s)` }] : []),
  ];
};

// La bataille d'un événement, d'après son identifiant, dans le journal du monde.
export const findBattle = (battleLog, battleId) => (battleId ? list(battleLog).find((battle) => battle?.id === battleId) ?? null : null);
