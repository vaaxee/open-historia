// Couche HOI4 — l'espionnage (phase 11).
//
// Run tests: node --test src/runtime/hoi/espionage.test.js
// Import-free à part les modules purs.
//
// À côté des agents isolés de spycraft.js (qui lisent la diplomatie privée), des
// RÉSEAUX : chaque pays en bâtit dans d'autres (world.hoi.networks[pays][cible] =
// { strength 0 → 100, building }) ; un réseau se renforce tant qu'on le bâtit,
// selon le service de renseignement du pays (world.intelligence, spycraft.js),
// et s'use lentement sinon. Sur un réseau, des MISSIONS (world.hoi.spyMissions) :
//   intel    renseignement : un rapport chiffré sur les armées et la politique ;
//   sabotage un bâtiment de la cible endommagé ;
//   tech     vol de technologie : une recherche que la cible a finie avance ;
//   party    soutien à un parti : un courant monte chez la cible, sa stabilité baisse.
// Le moteur tire le succès et la capture (chances selon le réseau et les deux
// services, graine stable) ; un agent pris est DÉTENU (world.hoi.capturedAgents)
// jusqu'à ce que son geôlier en décide : échange, procès public, retournement
// (le réseau du propriétaire est compromis et ses rapports sont faux), exécution.

import { draw, intelligenceOf } from "../spycraft.js";
import { IDEOLOGIES, normalizePolitics, shiftPopularity } from "./politics.js";

export const SPY_MISSIONS = Object.freeze(["intel", "sabotage", "tech", "party"]);
export const AGENT_FATES = Object.freeze(["exchange", "trial", "turn", "execute"]);
export const ESPIONAGE_TUNING = Object.freeze({
  // Par mois : ce qu'un réseau gagne en se bâtissant (à service moyen, 50) et
  // ce qu'il perd sinon.
  buildPerMonth: 10,
  decayPerMonth: 2,
  // La force qu'il faut à un réseau pour lancer une mission.
  minStrength: Object.freeze({ intel: 20, sabotage: 40, tech: 50, party: 40 }),
  // La durée d'une mission et sa difficulté (retirée des chances de succès).
  days: Object.freeze({ intel: 30, sabotage: 45, tech: 60, party: 60 }),
  difficulty: Object.freeze({ intel: 0, sabotage: 0.15, tech: 0.2, party: 0.1 }),
  // Ce qu'une capture coûte au réseau.
  captureLoss: 40,
  sabotageDamage: 0.35,
  techTheftShare: 0.3,
  partyShift: 5,
  partyStability: 3,
  // Les suites d'un sort d'agent, pour le geôlier et le propriétaire.
  trialStability: 3,
  trialWarSupport: 3,
  opinion: Object.freeze({ exchange: 10, trial: -20, turn: 0, execute: -30 }),
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(days) * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
const nameIn = (map, polity) => Object.keys(map ?? {}).find((name) => key(name) === key(polity)) ?? "";

export const normalizeNetwork = (value) => ({
  strength: round2(clamp(num(value?.strength), 0, 100)),
  building: Boolean(value?.building),
  compromised: Boolean(value?.compromised),
});

export const normalizeMission = (value, index = 0) => {
  if (!isObject(value)) return null;
  const owner = clean(value.owner); const target = clean(value.target);
  const kind = SPY_MISSIONS.includes(value.kind) ? value.kind : "";
  if (!owner || !target || !kind || key(owner) === key(target)) return null;
  return {
    id: clean(value.id) || `mission-${index + 1}`,
    owner, target, kind,
    detail: clean(value.detail),
    startDate: clean(value.startDate),
    days: Math.max(1, Math.round(num(value.days, ESPIONAGE_TUNING.days[kind]))),
  };
};

// Un réseau d'un pays dans un autre (0 s'il n'en a pas).
export const networkOf = (hoi, owner, target) => normalizeNetwork(hoi?.networks?.[nameIn(hoi?.networks, owner)]?.[target]);

// Les chances d'une mission : succès et capture.
export const missionChances = ({ kind, strength, ownerIntelligence, targetIntelligence }) => {
  const T = ESPIONAGE_TUNING;
  const success = clamp(0.25 + 0.5 * (strength / 100) + 0.3 * ((ownerIntelligence - targetIntelligence) / 100) - (T.difficulty[kind] ?? 0), 0.05, 0.95);
  const capture = clamp(0.1 + 0.4 * (targetIntelligence / 100) - 0.2 * (strength / 100), 0.02, 0.8);
  return { success: round2(success), capture: round2(capture) };
};

// Un ordre d'espionnage, du joueur ou d'une IA :
//   { op: "build", polity, target } / { op: "stop", polity, target }
//   { op: "mission", polity, target, kind, detail? }
// `context` : { hoi, date }. Renvoie { hoi, note }.
export const applyEspionageOp = (op, { hoi, date = "" }) => {
  const T = ESPIONAGE_TUNING;
  const polity = clean(op?.polity); const target = clean(op?.target);
  const refuse = (text) => ({ hoi, note: { kind: "dropped", text: `espionage — ${text}` } });
  if (!polity || !target || key(polity) === key(target)) return refuse("a network needs a country and another as target.");
  const ownerKey = nameIn(hoi?.networks, polity) || polity;
  const networks = { ...(hoi?.networks ?? {}) };
  const own = { ...(networks[ownerKey] ?? {}) };
  const kind = clean(op?.op).toLowerCase();
  if (kind === "build" || kind === "stop") {
    own[target] = { ...normalizeNetwork(own[target]), building: kind === "build" };
    networks[ownerKey] = own;
    return { hoi: { ...hoi, networks }, note: { kind: "adjusted", text: `espionage — ${polity} ${kind === "build" ? "builds" : "stops building"} a network in ${target}.` } };
  }
  if (kind !== "mission") return refuse(`"${kind}" is not an espionage order (build, stop, mission).`);
  const mission = clean(op?.kind);
  if (!SPY_MISSIONS.includes(mission)) return refuse(`"${mission}" is not a mission (${SPY_MISSIONS.join(", ")}).`);
  const network = normalizeNetwork(own[target]);
  if (network.strength < T.minStrength[mission]) return refuse(`${polity}'s network in ${target} is at ${Math.round(network.strength)}, under the ${T.minStrength[mission]} a ${mission} mission needs.`);
  const missions = list(hoi?.spyMissions).map(normalizeMission).filter(Boolean);
  if (missions.some((entry) => key(entry.owner) === key(polity) && key(entry.target) === key(target))) return refuse(`${polity} already runs a mission in ${target}.`);
  const next = normalizeMission({ id: `mission-${key(polity)}-${key(target)}-${mission}-${clean(date)}`, owner: polity, target, kind: mission, detail: op.detail, startDate: date }, missions.length);
  return { hoi: { ...hoi, spyMissions: [...missions, next] }, note: { kind: "adjusted", text: `espionage — ${polity} starts a ${mission} mission in ${target} (${next.days} days).` } };
};

// Le rapport d'une mission de renseignement : ce que le réseau voit (faux si le
// réseau est compromis : le geôlier d'un agent retourné le nourrit).
export const intelReport = (hoi, target, { compromised = false, seed = "" } = {}) => {
  const army = hoi?.armies?.[nameIn(hoi?.armies, target)];
  const politics = hoi?.politics?.[nameIn(hoi?.politics, target)];
  const divisions = list(army?.divisions).length;
  const factor = compromised ? 0.5 + draw(`${seed}|lie`) : 1; // un rapport truqué se trompe du simple au double
  const p = politics ? normalizePolitics(politics) : null;
  return {
    divisions: Math.round(divisions * factor),
    manpower: Math.round(num(army?.manpower?.available) * factor),
    ideology: p?.ideology ?? "",
    stability: p ? Math.round(clamp(p.stability * (compromised ? 1.3 : 1), 0, 100)) : null,
    warSupport: p ? Math.round(clamp(p.warSupport * (compromised ? 0.6 : 1), 0, 100)) : null,
  };
};

// Un saut d'espionnage : les réseaux avancent, les missions qui finissent sont
// tirées (succès, capture), leurs effets calculés. `world` : le monde du début
// du saut (world.intelligence et world.hoi). Pur : renvoie { hoi, results,
// captured } ; `results` : [{ mission, success, captured, effect }].
export const advanceEspionage = (world, { fromDate, toDate, seed = "" } = {}) => {
  const T = ESPIONAGE_TUNING;
  let hoi = { ...(world?.hoi ?? {}) };
  const days = daysBetween(fromDate, toDate);
  const months = days / 30;
  // 1. Les réseaux.
  const networks = {};
  for (const [owner, targets] of Object.entries(hoi.networks ?? {})) {
    const factor = intelligenceOf(world, owner) / 50;
    networks[owner] = Object.fromEntries(Object.entries(targets ?? {}).map(([target, raw]) => {
      const network = normalizeNetwork(raw);
      const strength = network.building ? network.strength + T.buildPerMonth * factor * months : network.strength - T.decayPerMonth * months;
      return [target, { ...network, strength: round2(clamp(strength, 0, 100)) }];
    }));
  }
  hoi = { ...hoi, networks };
  // 2. Les missions qui finissent pendant le saut.
  const results = [];
  const captured = [...list(hoi.capturedAgents)];
  const ongoing = [];
  for (const mission of list(hoi.spyMissions).map(normalizeMission).filter(Boolean)) {
    const end = addDays(mission.startDate || fromDate, mission.days);
    if (end > toDate) { ongoing.push(mission); continue; }
    const network = networkOf(hoi, mission.owner, mission.target);
    const chances = missionChances({ kind: mission.kind, strength: network.strength, ownerIntelligence: intelligenceOf(world, mission.owner), targetIntelligence: intelligenceOf(world, mission.target) });
    // Un réseau compromis échoue toujours, sans le savoir (ses rapports sont faux).
    const success = network.compromised ? mission.kind === "intel" : draw(`${seed}|${mission.id}|success`) < chances.success;
    const caught = !network.compromised && draw(`${seed}|${mission.id}|capture`) < chances.capture + (success ? 0 : 0.15);
    const result = { mission, date: end, success, captured: caught, chances, effect: null };
    if (success) {
      if (mission.kind === "intel") result.effect = { report: intelReport(hoi, mission.target, { compromised: network.compromised, seed: `${seed}|${mission.id}` }), false: network.compromised };
      if (mission.kind === "party") {
        const politicsKey = nameIn(hoi.politics, mission.target);
        const ideology = IDEOLOGIES.includes(mission.detail) ? mission.detail : "";
        if (politicsKey && ideology) {
          const politics = normalizePolitics(hoi.politics[politicsKey]);
          hoi = { ...hoi, politics: { ...hoi.politics, [politicsKey]: { ...politics, parties: shiftPopularity(politics.parties, ideology, T.partyShift), stability: clamp(politics.stability - T.partyStability, 0, 100) } } };
          result.effect = { ideology, shift: T.partyShift };
        }
      }
      if (mission.kind === "tech") {
        const ownerNation = hoi.nations?.[nameIn(hoi.nations, mission.owner)];
        const targetNation = hoi.nations?.[nameIn(hoi.nations, mission.target)];
        const done = new Set(list(ownerNation?.research?.done));
        const techs = list(hoi.tech?.tree?.techs);
        const stolen = mission.detail && list(targetNation?.research?.done).includes(mission.detail) && !done.has(mission.detail)
          ? mission.detail
          : list(targetNation?.research?.done).find((id) => !done.has(id));
        if (stolen && ownerNation) {
          const cost = num(techs.find((tech) => tech.id === stolen)?.days, 100);
          const ownerKey = nameIn(hoi.nations, mission.owner);
          const research = ownerNation.research ?? {};
          const partial = { ...(research.partial ?? {}), [stolen]: round2(num(research.partial?.[stolen]) + cost * T.techTheftShare) };
          hoi = { ...hoi, nations: { ...hoi.nations, [ownerKey]: { ...ownerNation, research: { ...research, partial } } } };
          result.effect = { techId: stolen, days: round2(cost * T.techTheftShare) };
        }
      }
      if (mission.kind === "sabotage") result.effect = { damage: T.sabotageDamage, target: mission.detail };
    }
    if (caught) {
      const ownerKey = nameIn(hoi.networks, mission.owner) || mission.owner;
      const net = normalizeNetwork(hoi.networks?.[ownerKey]?.[mission.target]);
      hoi = { ...hoi, networks: { ...hoi.networks, [ownerKey]: { ...(hoi.networks?.[ownerKey] ?? {}), [mission.target]: { ...net, strength: round2(Math.max(0, net.strength - T.captureLoss)) } } } };
      captured.push({ id: `agent-${mission.id}`, owner: mission.owner, holder: mission.target, capturedAt: end, mission: mission.kind, status: "held" });
    }
    results.push(result);
  }
  return { hoi: { ...hoi, spyMissions: ongoing, capturedAgents: captured }, results, captured: captured.filter((agent) => agent.capturedAt > fromDate && agent.capturedAt <= toDate) };
};

// Le sort d'un agent détenu, décidé par son geôlier. Renvoie { hoi, note }.
export const decideAgentFate = (hoi, agentId, fate, { date = "" } = {}) => {
  const T = ESPIONAGE_TUNING;
  const agents = list(hoi?.capturedAgents);
  const agent = agents.find((entry) => entry.id === agentId && entry.status === "held");
  if (!agent) return { hoi, note: { kind: "dropped", text: `espionage — no held agent "${agentId}".` } };
  if (!AGENT_FATES.includes(fate)) return { hoi, note: { kind: "dropped", text: `espionage — "${fate}" is not a fate (${AGENT_FATES.join(", ")}).` } };
  let next = { ...hoi, capturedAgents: agents.map((entry) => (entry === agent ? { ...entry, status: fate, decidedAt: date } : entry)) };
  const adjustPolitics = (polity, change) => {
    const politicsKey = nameIn(next.politics, polity);
    if (!politicsKey) return;
    next = { ...next, politics: { ...next.politics, [politicsKey]: change(normalizePolitics(next.politics[politicsKey])) } };
  };
  const opinion = T.opinion[fate];
  if (opinion) adjustPolitics(agent.owner, (p) => ({ ...p, opinions: { ...p.opinions, [agent.holder]: clamp(num(p.opinions[agent.holder]) + opinion, -100, 100) } }));
  if (fate === "exchange") adjustPolitics(agent.holder, (p) => ({ ...p, opinions: { ...p.opinions, [agent.owner]: clamp(num(p.opinions[agent.owner]) + opinion, -100, 100) } }));
  if (fate === "trial") adjustPolitics(agent.holder, (p) => ({ ...p, stability: clamp(p.stability + T.trialStability, 0, 100), warSupport: clamp(p.warSupport + T.trialWarSupport, 0, 100) }));
  if (fate === "turn") {
    const ownerKey = nameIn(next.networks, agent.owner) || agent.owner;
    const net = normalizeNetwork(next.networks?.[ownerKey]?.[agent.holder]);
    next = { ...next, networks: { ...next.networks, [ownerKey]: { ...(next.networks?.[ownerKey] ?? {}), [agent.holder]: { ...net, compromised: true } } } };
  }
  return { hoi: next, note: { kind: "adjusted", text: `espionage — ${agent.holder} decides the fate of ${agent.owner}'s agent: ${fate}.` } };
};

// Ce qu'une IA fait d'un agent qu'elle détient : un ennemi de guerre ou un pays
// qu'elle déteste le paie (procès, ou exécution s'il la hait) ; un pays qu'elle
// ménage le récupère par échange ; un service fort tente le retournement.
export const aiAgentFate = (hoi, agent, { atWar = () => false, holderIntelligence = 40 } = {}) => {
  const politics = hoi?.politics?.[nameIn(hoi?.politics, agent.holder)];
  const opinion = num(politics?.opinions?.[agent.owner]);
  if (holderIntelligence >= 65) return "turn";
  if (atWar(agent.holder, agent.owner)) return opinion <= -50 ? "execute" : "trial";
  if (opinion >= 20) return "exchange";
  return "trial";
};

// Les ordres d'espionnage par défaut d'un pays IA : bâtir un réseau chez son
// ennemi de guerre, sinon chez le pays qu'il aime le moins (opinion ≤ −20) ; y
// lancer une mission quand le réseau le permet (renseignement d'abord, puis
// sabotage en guerre, vol de technologie en paix).
export const defaultEspionageOps = (polity, { hoi, enemies = [] } = {}) => {
  const T = ESPIONAGE_TUNING;
  const politics = hoi?.politics?.[nameIn(hoi?.politics, polity)];
  const rival = enemies[0] || Object.entries(normalizePolitics(politics ?? {}).opinions).filter(([, opinion]) => opinion <= -20).sort((a, b) => a[1] - b[1])[0]?.[0];
  if (!rival) return [];
  const ops = [];
  const network = networkOf(hoi, polity, rival);
  if (!network.building && network.strength < 100) ops.push({ op: "build", polity, target: rival });
  const busy = list(hoi?.spyMissions).some((mission) => key(mission?.owner) === key(polity) && key(mission?.target) === key(rival));
  if (!busy) {
    const wanted = network.strength >= T.minStrength.sabotage && enemies.length ? "sabotage" : network.strength >= T.minStrength.tech && !enemies.length ? "tech" : network.strength >= T.minStrength.intel ? "intel" : "";
    if (wanted) ops.push({ op: "mission", polity, target: rival, kind: wanted });
  }
  return ops;
};

// L'événement du moteur pour une mission, dans la langue du tour. Seulement ce
// que le pays qui en parle sait : son propre succès, un agent qu'il a pris.
export const espionageEvent = (result, { language = "en", the = (name) => name } = {}) => {
  const fr = language === "fr";
  const { mission } = result;
  const words = {
    intel: fr ? "renseignement" : "intelligence", sabotage: fr ? "sabotage" : "sabotage", tech: fr ? "vol de technologie" : "technology theft", party: fr ? "soutien à un parti" : "party support",
  };
  if (result.captured) {
    return {
      date: result.date,
      title: fr ? `${the(mission.target).replace(/^./, (c) => c.toUpperCase())} arrête un agent étranger` : `${mission.target} arrests a foreign agent`,
      description: fr
        ? `Les services ${the(mission.target, "de")} démantèlent une opération de ${words[mission.kind]} menée par ${the(mission.owner)} et détiennent son agent.`
        : `${mission.target}'s security service breaks up a ${words[mission.kind]} operation run by ${mission.owner} and holds its agent.`,
      kind: "espionage", importance: "normal", notable: true, source: "engine", impacts: {},
    };
  }
  if (!result.success) return null;
  return {
    date: result.date,
    title: fr ? `Opération de ${words[mission.kind]} réussie` : `${words[mission.kind].replace(/^./, (c) => c.toUpperCase())} operation succeeds`,
    description: fr
      ? `Le réseau ${the(mission.owner, "de")} chez ${the(mission.target)} mène à bien une opération de ${words[mission.kind]}.`
      : `${mission.owner}'s network in ${mission.target} carries out a ${words[mission.kind]} operation.`,
    kind: "espionage", importance: "normal", notable: false, source: "engine", impacts: {}, secretTo: mission.owner,
  };
};
