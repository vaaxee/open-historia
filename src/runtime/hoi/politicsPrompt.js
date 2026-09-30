// Couche HOI4 — ce que les IA savent de la politique et des focus (phase 8).
//
// Un bloc « [POLITICS — computed by the engine] », lu par le tour, le conseiller
// du joueur et les dirigeants : pour chaque pays, son régime, ses partis, sa
// stabilité, son soutien à la guerre, sa prochaine élection, son focus en cours
// et ses focus disponibles (leurs identifiants, pour economyOps focus) ; pour le
// tour, les élections, coups et focus achevés que le moteur vient de décider.
// Import-free à part les modules purs de la couche.

import { normalizePolitics, POLITICS_TUNING, POWER_PROGRAMMES_1936 } from "./politics.js";
import { availableFocuses, focusTreeFor, normalizeFocusState } from "./focus.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const nameIn = (map, polity) => Object.keys(map ?? {}).find((name) => key(name) === key(polity)) ?? "";

export const describePoliticsLine = (hoi, polity, { withFocusOptions = false } = {}) => {
  const name = nameIn(hoi?.politics, polity);
  if (!name) return "";
  const politics = normalizePolitics(hoi.politics[name]);
  const parties = Object.entries(politics.parties).sort((a, b) => b[1] - a[1]).map(([party, share]) => `${party} ${Math.round(share)}%`).join(", ");
  const state = normalizeFocusState(hoi?.focus?.[nameIn(hoi?.focus, polity)]);
  const tree = focusTreeFor(name, state);
  const current = state.current ? tree.find((focus) => focus.id === state.current.id) : null;
  const options = withFocusOptions && !state.current ? availableFocuses(name, state, politics).slice(0, 6).map((focus) => `${focus.id} "${focus.name.en}"`) : [];
  const programme = programmeOf(hoi, name);
  return `- ${name}: ${politics.ideology} government (${parties}); stability ${Math.round(politics.stability)}%, war support ${Math.round(politics.warSupport)}%${politics.elections?.next ? `; next election ${politics.elections.next}` : ""}`
    + `${current ? `; national focus "${current.name.en}" since ${state.current.startDate}` : "; no focus under way"}${state.completed.length ? `; ${state.completed.length} focus(es) done` : ""}`
    + `${options.length ? `; can take: ${options.join(", ")}` : ""}.${programme ? `\n  Programme: ${programme}.` : ""}`;
};

// Phase 10 : le programme d'un pays — celui que la grande IA a fixé (economyOps
// programme, gardé dans la mémoire de Jev), sinon celui de 1936 des puissances.
export const programmeOf = (hoi, polity) => {
  const memory = hoi?.jevMemory?.[nameIn(hoi?.jevMemory, polity)];
  return clean(memory?.programme) || POWER_PROGRAMMES_1936[nameIn(POWER_PROGRAMMES_1936, polity)] || "";
};

// Phase 11 : l'espionnage d'un pays, tel que lui le connaît : ses réseaux, ses
// missions, son dernier rapport sur chaque cible, les agents étrangers qu'il détient.
export const describeEspionageLine = (hoi, polity) => {
  const networks = Object.entries(hoi?.networks?.[nameIn(hoi?.networks, polity)] ?? {})
    .filter(([, network]) => Number(network?.strength) > 0 || network?.building)
    .map(([target, network]) => `${target} ${Math.round(Number(network.strength) || 0)}${network.building ? " (building)" : ""}`);
  const missions = list(hoi?.spyMissions).filter((mission) => key(mission?.owner) === key(polity)).map((mission) => `${mission.kind} in ${mission.target}`);
  const reports = list(hoi?.intelReports?.[nameIn(hoi?.intelReports, polity)]).slice(-3)
    .map((report) => `${report.target} (${report.date}): ${report.divisions} divisions, ${report.ideology || "?"} regime, stability ${report.stability ?? "?"}%`);
  const held = list(hoi?.capturedAgents).filter((agent) => key(agent?.holder) === key(polity) && agent.status === "held").map((agent) => `${agent.owner}'s ${agent.mission} agent`);
  if (!networks.length && !missions.length && !reports.length && !held.length) return "";
  return [
    `  Espionage — networks: ${networks.join(", ") || "none"}`,
    missions.length ? `missions: ${missions.join(", ")}` : "",
    reports.length ? `latest reports: ${reports.join("; ")}` : "",
    held.length ? `holds: ${held.join(", ")}` : "",
  ].filter(Boolean).join("; ") + ".";
};

// Le bloc complet. `polity` : le pays dont on parle d'abord ; `others` : combien
// d'autres ; `enginePolitics` : ce que le moteur a décidé pour ce tour (gameplay.js).
export const buildPoliticsPromptBlock = (world, polity, { others = 0, enginePolitics = null, forTurn = false } = {}) => {
  const hoi = world?.hoi;
  if (!hoi?.politics) return "";
  const lines = ["[POLITICS — computed by the engine]"];
  const own = describePoliticsLine(hoi, polity);
  if (own) lines.push(own);
  const spying = describeEspionageLine(hoi, polity);
  if (spying) lines.push(spying);
  if (others > 0) {
    const rest = Object.keys(hoi.politics).filter((name) => key(name) !== key(polity))
      .sort((a, b) => list(hoi.armies?.[b]?.divisions).length - list(hoi.armies?.[a]?.divisions).length)
      .slice(0, others);
    for (const name of rest) lines.push(describePoliticsLine(hoi, name, { withFocusOptions: forTurn }));
  }
  if (forTurn && (list(enginePolitics?.changes).length || list(enginePolitics?.completed).length)) {
    lines.push("Decided by the engine for THIS period (each has its own event, written by the engine; narrate around it, never change the outcome):");
    for (const change of list(enginePolitics.changes)) lines.push(`- ${change.date} ${change.polity}: ${change.kind} — ${change.from} → ${change.to} (${change.share}%).`);
    for (const done of list(enginePolitics.completed)) lines.push(`- ${done.date} ${done.polity} completes the national focus "${done.name?.en ?? done.focusId}".`);
  }
  if (forTurn) {
    lines.push("Each AI power pursues its Programme above: what it does this period serves it, or the event says why it departs from it (a shock, a new leader, a crisis). A power that changes course for good gets a new programme (economyOps programme).");
    lines.push("Espionage is engine-run too: networks grow while a country builds them, and missions (intel, sabotage, tech, party) succeed or get agents caught by the engine's draw. An AI country may order one with economyOps spy (enemy: the target, mission, label: the ideology to support or the building to hit); never narrate a spy success or capture the engine did not decide.");
    lines.push(`Politics is engine-run: stability moves production (±20%), war support moves recruitment, and a country under ${POLITICS_TUNING.minWarSupportToDeclare}% war support cannot start a war of aggression (the engine drops it). Elections and coups happen by the engine's thresholds only: never narrate one it did not decide, nor its result before its date; and never tell as done anything dated after the end of this period. An AI country may take a national focus (economyOps focus, focusId from the list above) or propose a custom one (label, days 14-140, effects such as "civil+2; stability+5; divisions:infanterie*2; claim:Gdańsk; opinion:Poland-20"), which the engine validates and bounds.`);
  }
  return lines.filter(Boolean).join("\n");
};
