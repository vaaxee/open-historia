// Phase 8 — les panneaux Focus (l'arbre du joueur, cliquable) et Politique
// (régime, partis, stabilité, soutien à la guerre, élections). Écrits dans la
// langue du joueur et soustraits au traducteur ; l'état vient de
// focusPoliticsModel.js, les écritures passent par hoiWrites.js.

import React, { useEffect, useMemo, useState } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { getStoredLanguage } from "../../runtime/i18n.js";
import { applyPlayerEspionage, applyPlayerFocus, cancelPlayerFocus, decidePlayerAgent, espionagePanelModel, focusEffectText, focusPanelModel, politicsPanelModel } from "./focusPoliticsModel.js";
import { HOI_WRITE_ERRORS, updateHoiWorld } from "./hoiWrites.js";
import { describeBusy } from "./frontsPanelText.js";
import { frenchPolityName } from "../../runtime/polityExonyms.js";

const selectWorld = (world) => world ?? null;
const selectCountry = (game) => String(game?.country ?? "");
const selectDate = (game) => String(game?.gameDate ?? "");

const WORDS = {
  en: {
    focus: "National focus", politics: "Politics", close: "Close", none: "No focus under way: pick one in the tree.", current: "Under way",
    daysLeft: (n) => `${n} day(s) left`, cancel: "Abandon", start: "Take this focus", done: "Done", locked: "Locked", excluded: "Excluded", available: "Available",
    completed: (n) => `${n} completed`, noCountry: "Your country has no national focuses tracked by the engine.", days: (n) => `${n} days`,
    ideology: "In power", parties: "Parties", stability: "Stability", warSupport: "War support", nextElection: "Next election", none2: "—",
    production: "Production", recruitment: "Recruitment", canDeclare: "Can declare a war of aggression", cannotDeclare: "Cannot declare a war of aggression (war support under 25%)",
    coupRisk: "Risk of a coup", opinions: "Opinions", lastChange: "Last change", election: "election", coup: "coup",
    waiting: (what) => `Waiting for ${what} to finish…`, busy: (what) => `The game is busy (${what}); try again.`,
    espionage: "Espionage", service: "Intelligence service", networks: "Networks", build: "Build", stop: "Stop", launch: "Launch", target: "Target",
    missionKinds: { intel: "Intelligence", sabotage: "Sabotage", tech: "Technology theft", party: "Support a party" }, success: "success", capture: "capture",
    inProgress: "Missions under way", reports: "Intelligence reports", held: "Foreign agents we hold", lostAgents: "Our agents taken",
    fates: { exchange: "Exchange", trial: "Public trial", turn: "Turn", execute: "Execute" }, compromised: "compromised?", noNetwork: "No network yet.",
    report: (r) => `${r.divisions} divisions, ${r.manpower.toLocaleString()} men available, stability ${r.stability ?? "?"} %, war support ${r.warSupport ?? "?"} %`,
    building: "building", party: "Party",
  },
  fr: {
    focus: "Focus national", politics: "Politique", close: "Fermer", none: "Aucun focus en cours : choisissez-en un dans l'arbre.", current: "En cours",
    daysLeft: (n) => `${n} jour(s) restant(s)`, cancel: "Abandonner", start: "Prendre ce focus", done: "Fait", locked: "Verrouillé", excluded: "Exclu", available: "Disponible",
    completed: (n) => `${n} achevé(s)`, noCountry: "Votre pays n'a pas de focus suivis par le moteur.", days: (n) => `${n} jours`,
    ideology: "Au pouvoir", parties: "Partis", stability: "Stabilité", warSupport: "Soutien à la guerre", nextElection: "Prochaine élection", none2: "—",
    production: "Production", recruitment: "Recrutement", canDeclare: "Peut déclarer une guerre d'agression", cannotDeclare: "Ne peut pas déclarer de guerre d'agression (soutien sous 25 %)",
    coupRisk: "Risque de coup d'État", opinions: "Opinions", lastChange: "Dernier changement", election: "élection", coup: "coup d'État",
    waiting: (what) => `En attente de la fin de ${what}…`, busy: (what) => `Le jeu est occupé (${what}) ; réessayez.`,
    espionage: "Espionnage", service: "Service de renseignement", networks: "Réseaux", build: "Bâtir", stop: "Arrêter", launch: "Lancer", target: "Cible",
    missionKinds: { intel: "Renseignement", sabotage: "Sabotage", tech: "Vol de technologie", party: "Soutien à un parti" }, success: "succès", capture: "capture",
    inProgress: "Missions en cours", reports: "Rapports de renseignement", held: "Agents étrangers détenus", lostAgents: "Nos agents pris",
    fates: { exchange: "Échanger", trial: "Procès public", turn: "Retourner", execute: "Exécuter" }, compromised: "compromis ?", noNetwork: "Aucun réseau pour l'instant.",
    report: (r) => `${r.divisions} divisions, ${r.manpower.toLocaleString("fr-FR")} hommes mobilisables, stabilité ${r.stability ?? "?"} %, soutien ${r.warSupport ?? "?"} %`,
    building: "en construction", party: "Parti",
  },
};
const wordsFor = (language) => (/^fr\b/i.test(language) ? WORDS.fr : WORDS.en);

const shell = (isOpen, width = "34rem") => ({
  backdropFilter: "blur(8px)", backgroundColor: "rgba(24,24,27,0.96)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px",
  bottom: isOpen ? "5.2rem" : "-44rem", boxShadow: "-4px 0 24px rgba(0,0,0,0.4)", color: "white", display: "flex", flexDirection: "column",
  fontFamily: "sans-serif", height: "min(calc(100vh - 9rem), 38rem)", left: "0.5rem", maxWidth: "calc(100vw - 1rem)", opacity: isOpen ? 1 : 0,
  overflow: "hidden", pointerEvents: isOpen ? "auto" : "none", position: "fixed", transition: "bottom 0.35s ease, opacity 0.35s ease", width, zIndex: 9998,
});
const small = { color: "rgba(255,255,255,0.55)", fontSize: "0.7rem" };
const card = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "12px", padding: "0.6rem 0.75rem" };
const button = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "8px", color: "white", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, padding: "0.3rem 0.6rem" };
const STATUS_COLOURS = { done: "#16a34a", current: "#f59e0b", available: "#2563eb", locked: "#3f3f46", excluded: "#7f1d1d" };
const CELL_W = 118; const CELL_H = 74; const NODE_W = 104; const NODE_H = 54;

const Header = ({ title, onClose, closeLabel }) => (
  <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", padding: "0.9rem 1.1rem 0.7rem" }}>
    <span style={{ fontSize: "1rem", fontWeight: 700 }}>{title}</span>
    <button type="button" aria-label={closeLabel} onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1rem" }}>✕</button>
  </div>
);

// Une écriture du joueur : elle attend la fin de ce qui occupe le jeu.
const useHoiOrder = (language) => {
  const w = wordsFor(language);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const run = async (apply) => {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await updateHoiWorld((current) => {
        const applied = apply(current);
        return applied.note.kind === "dropped" ? { error: "refused" } : { world: applied.world };
      }, { onWait: (reasons) => setMessage(w.waiting(describeBusy(reasons, language))) });
      setMessage(result.ok ? "" : result.error === "busy" ? w.busy(describeBusy(result.reasons, language)) : HOI_WRITE_ERRORS[result.error] ?? "");
    } finally {
      setPending(false);
    }
  };
  return { message, pending, run };
};

export const FocusPanel = ({ isOpen, onClose }) => {
  const world = useRuntimeState("world", selectWorld);
  const country = useRuntimeState("game", selectCountry);
  const date = useRuntimeState("game", selectDate);
  const language = getStoredLanguage();
  const w = wordsFor(language);
  const model = useMemo(() => (world?.hoi ? focusPanelModel(world, country, { language, date }) : null), [world, country, language, date]);
  const [selected, setSelected] = useState("");
  const { message, pending, run } = useHoiOrder(language);
  const node = model?.nodes.find((entry) => entry.id === selected) ?? null;
  const width = model ? (Math.max(0, ...model.nodes.map((entry) => entry.x)) + 1) * CELL_W : 0;
  const height = model ? (Math.max(0, ...model.nodes.map((entry) => entry.y)) + 1) * CELL_H : 0;
  const at = (id) => model?.nodes.find((entry) => entry.id === id);
  return (
    <div data-no-translate="" style={shell(isOpen)}>
      <Header title={w.focus} onClose={onClose} closeLabel={w.close} />
      <div style={{ display: "grid", gap: "0.6rem", overflowY: "auto", padding: "0.8rem 1.1rem 1rem" }}>
        {!model && <p style={small}>{w.noCountry}</p>}
        {model && (
          <div style={{ ...card, alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.78rem" }}>
              {model.current ? `${w.current} : « ${model.current.name} »${model.remaining !== null ? ` · ${w.daysLeft(model.remaining)}` : ""}` : w.none}
              <span style={small}>{` · ${w.completed(model.completed)}`}</span>
            </span>
            {model.current && <button type="button" style={button} disabled={pending} onClick={() => run((current) => cancelPlayerFocus(current, country))}>{w.cancel}</button>}
          </div>
        )}
        {message && <div style={{ ...card, color: "#fde68a", fontSize: "0.74rem" }}>{message}</div>}
        {model && (
          <div style={{ overflowX: "auto" }}>
            <svg width={width} height={height} role="tree" aria-label={w.focus}>
              {model.links.map(([from, to]) => {
                const a = at(from); const b = at(to);
                if (!a || !b) return null;
                return <line key={`${from}-${to}`} x1={a.x * CELL_W + NODE_W / 2} y1={a.y * CELL_H + NODE_H} x2={b.x * CELL_W + NODE_W / 2} y2={b.y * CELL_H} stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />;
              })}
              {model.exclusive.map(([from, to]) => {
                const a = at(from); const b = at(to);
                if (!a || !b) return null;
                return <line key={`x-${from}-${to}`} x1={a.x * CELL_W + NODE_W} y1={a.y * CELL_H + NODE_H / 2} x2={b.x * CELL_W} y2={b.y * CELL_H + NODE_H / 2} stroke="#ef4444" strokeDasharray="3 3" strokeWidth="1.5" />;
              })}
              {model.nodes.map((entry) => (
                <g key={entry.id} transform={`translate(${entry.x * CELL_W}, ${entry.y * CELL_H})`} style={{ cursor: "pointer" }} onClick={() => setSelected(entry.id)} role="treeitem" aria-selected={selected === entry.id}>
                  <rect width={NODE_W} height={NODE_H} rx="8" fill={STATUS_COLOURS[entry.status]} fillOpacity={entry.status === "locked" ? 0.45 : 0.85} stroke={selected === entry.id ? "#fff" : "rgba(255,255,255,0.2)"} strokeWidth={selected === entry.id ? 2 : 1} />
                  <foreignObject x="4" y="3" width={NODE_W - 8} height={NODE_H - 6}>
                    <div style={{ color: "white", fontSize: "0.62rem", fontWeight: 700, lineHeight: 1.15, textAlign: "center" }}>{entry.name}<div style={{ fontWeight: 400, opacity: 0.8 }}>{w.days(entry.days)}</div></div>
                  </foreignObject>
                </g>
              ))}
            </svg>
          </div>
        )}
        {node && (
          <div style={card}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>{node.name}</div>
            <div style={small}>{`${w[node.status] ?? w.current} · ${w.days(node.days)}`}</div>
            <ul style={{ fontSize: "0.72rem", margin: "0.35rem 0 0.4rem 1rem", padding: 0 }}>
              {node.effects.map((effect, index) => <li key={index}>{focusEffectText(effect, language)}</li>)}
            </ul>
            {node.status === "available" && !model.current && (
              <button type="button" style={button} disabled={pending} onClick={() => run((current) => applyPlayerFocus(current, country, node.id, { date }))}>{w.start}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Gauge = ({ label, value, colour, note = "" }) => (
  <div style={{ marginTop: "0.35rem" }}>
    <div style={{ display: "flex", fontSize: "0.74rem", justifyContent: "space-between" }}><span>{label}</span><span>{`${Math.round(value)} %${note ? ` · ${note}` : ""}`}</span></div>
    <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: "4px", height: "6px", marginTop: "0.2rem" }}>
      <div style={{ background: colour, borderRadius: "4px", height: "6px", width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  </div>
);
const PARTY_COLOURS = { democratic: "#3b82f6", communist: "#dc2626", fascist: "#78350f", authoritarian: "#6b7280" };

// Phase 11 : l'onglet Espionnage du panneau Politique.
const EspionageTab = ({ world, country, language }) => {
  const w = wordsFor(language);
  const fr = /^fr\b/i.test(language);
  const polity = (name) => (fr ? frenchPolityName(name) : name);
  const date = useRuntimeState("game", selectDate);
  const model = useMemo(() => espionagePanelModel(world, country), [world, country]);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState("intel");
  const [party, setParty] = useState("democratic");
  const { message, pending, run } = useHoiOrder(language);
  if (!model) return <p style={small}>{w.noCountry}</p>;
  const chosen = model.networks.find((entry) => entry.target === target) ?? model.networks[0];
  const pct = (value) => `${Math.round(value * 100)} %`;
  const active = model.networks.filter((entry) => entry.strength > 0 || entry.building);
  return (
    <>
      {message && <div style={{ ...card, color: "#fde68a", fontSize: "0.74rem" }}>{message}</div>}
      <div style={card}>
        <div style={{ fontSize: "0.78rem" }}>{`${w.service} : `}<b>{model.intelligence}</b></div>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
          <select value={chosen?.target ?? ""} onChange={(event) => setTarget(event.target.value)} style={{ ...button, maxWidth: "11rem" }} aria-label={w.target}>
            {model.networks.map((entry) => <option key={entry.target} value={entry.target} style={{ color: "black" }}>{`${polity(entry.target)} · ${Math.round(entry.strength)}`}</option>)}
          </select>
          {chosen && (chosen.building
            ? <button type="button" style={button} disabled={pending} onClick={() => run((current) => applyPlayerEspionage(current, country, { op: "stop", target: chosen.target }, { date }))}>{w.stop}</button>
            : <button type="button" style={button} disabled={pending} onClick={() => run((current) => applyPlayerEspionage(current, country, { op: "build", target: chosen.target }, { date }))}>{w.build}</button>)}
        </div>
        {chosen && (
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
            <select value={kind} onChange={(event) => setKind(event.target.value)} style={button} aria-label={w.launch}>
              {Object.entries(w.missionKinds).map(([value, label]) => <option key={value} value={value} style={{ color: "black" }}>{`${label} (${w.success} ${pct(chosen.chances[value].success)}, ${w.capture} ${pct(chosen.chances[value].capture)})`}</option>)}
            </select>
            {kind === "party" && (
              <select value={party} onChange={(event) => setParty(event.target.value)} style={button} aria-label={w.party}>
                {["democratic", "communist", "fascist", "authoritarian"].map((ideology) => <option key={ideology} value={ideology} style={{ color: "black" }}>{ideology}</option>)}
              </select>
            )}
            <button type="button" style={button} disabled={pending || !chosen.chances[kind].ready}
              onClick={() => run((current) => applyPlayerEspionage(current, country, { op: "mission", target: chosen.target, kind, detail: kind === "party" ? party : "" }, { date }))}>{w.launch}</button>
          </div>
        )}
      </div>
      <div style={card}>
        <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{w.networks}</div>
        {!active.length && <div style={small}>{w.noNetwork}</div>}
        {active.map((entry) => (
          <div key={entry.target} style={{ display: "flex", fontSize: "0.72rem", justifyContent: "space-between" }}>
            <span>{polity(entry.target)}{entry.building ? ` · ${w.building}` : ""}{entry.compromised ? ` · ${w.compromised}` : ""}</span><span>{Math.round(entry.strength)}</span>
          </div>
        ))}
      </div>
      {model.missions.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{w.inProgress}</div>
          {model.missions.map((mission) => <div key={mission.id} style={{ fontSize: "0.72rem" }}>{`${w.missionKinds[mission.kind]} · ${polity(mission.target)} · ${mission.startDate} (+${mission.days} j)`}</div>)}
        </div>
      )}
      {model.reports.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{w.reports}</div>
          {model.reports.map((report, index) => <div key={index} style={{ fontSize: "0.72rem" }}>{`${report.date} · ${polity(report.target)} : ${w.report(report)}`}</div>)}
        </div>
      )}
      {model.held.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{w.held}</div>
          {model.held.map((agent) => (
            <div key={agent.id} style={{ marginTop: "0.3rem" }}>
              <div style={{ fontSize: "0.72rem" }}>{`${polity(agent.owner)} · ${w.missionKinds[agent.mission] ?? agent.mission} · ${agent.capturedAt}`}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.2rem" }}>
                {Object.entries(w.fates).map(([fate, label]) => <button key={fate} type="button" style={button} disabled={pending} onClick={() => run((current) => decidePlayerAgent(current, agent.id, fate, { date }))}>{label}</button>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {model.lost.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{w.lostAgents}</div>
          {model.lost.map((agent) => <div key={agent.id} style={{ fontSize: "0.72rem" }}>{`${polity(agent.holder)} · ${agent.capturedAt} · ${w.fates[agent.status] ?? agent.status}`}</div>)}
        </div>
      )}
    </>
  );
};

export const PoliticsPanel = ({ isOpen, onClose }) => {
  const world = useRuntimeState("world", selectWorld);
  const country = useRuntimeState("game", selectCountry);
  const language = getStoredLanguage();
  const w = wordsFor(language);
  const fr = /^fr\b/i.test(language);
  const [tab, setTab] = useState("politics");
  const model = useMemo(() => (world?.hoi ? politicsPanelModel(world, country, { language }) : null), [world, country, language]);
  const pct = (value) => `${value > 0 ? "+" : ""}${Math.round(value * 100)} %`;
  return (
    <div data-no-translate="" style={shell(isOpen, "26rem")}>
      <Header title={w.politics} onClose={onClose} closeLabel={w.close} />
      <div style={{ display: "grid", gap: "0.6rem", overflowY: "auto", padding: "0.8rem 1.1rem 1rem" }}>
        {!model && <p style={small}>{w.noCountry}</p>}
        {model && (
          <div style={{ display: "flex", gap: "0.35rem" }} role="tablist">
            {[["politics", w.politics], ["espionage", w.espionage]].map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} style={{ ...button, ...(tab === value ? { borderColor: "rgba(96,165,250,0.6)" } : {}) }} onClick={() => setTab(value)}>{label}</button>
            ))}
          </div>
        )}
        {model && tab === "espionage" && <EspionageTab world={world} country={country} language={language} />}
        {model && tab === "politics" && (
          <>
            <div style={card}>
              <div style={{ fontSize: "0.8rem" }}>{`${w.ideology} : `}<b>{model.ideologyName}</b></div>
              <div style={{ ...small, marginTop: "0.2rem" }}>{`${w.nextElection} : ${model.nextElection || w.none2}`}</div>
              {model.lastChange && <div style={{ ...small, marginTop: "0.2rem" }}>{`${w.lastChange} : ${model.lastChange.date} (${w[model.lastChange.kind] ?? model.lastChange.kind})`}</div>}
            </div>
            <div style={card}>
              <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{w.parties}</div>
              {model.parties.map((party) => <Gauge key={party.ideology} label={`${party.name}${party.ruling ? " ★" : ""}`} value={party.share} colour={PARTY_COLOURS[party.ideology]} />)}
            </div>
            <div style={card}>
              <Gauge label={w.stability} value={model.stability} colour="#22c55e" note={`${w.production} ${pct(model.production)}`} />
              <Gauge label={w.warSupport} value={model.warSupport} colour="#f97316" note={`${w.recruitment} ×${model.manpower}`} />
              <div style={{ ...small, color: model.canDeclareWar ? "#86efac" : "#fca5a5", marginTop: "0.45rem" }}>{model.canDeclareWar ? w.canDeclare : w.cannotDeclare}</div>
              {model.coupRisk && <div style={{ ...small, color: "#fca5a5", marginTop: "0.2rem" }}>{w.coupRisk}</div>}
            </div>
            {model.opinions.length > 0 && (
              <div style={card}>
                <div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{w.opinions}</div>
                {model.opinions.map(([name, opinion]) => (
                  <div key={name} style={{ display: "flex", fontSize: "0.72rem", justifyContent: "space-between" }}>
                    <span>{fr ? frenchPolityName(name) : name}</span><span style={{ color: opinion >= 0 ? "#86efac" : "#fca5a5" }}>{`${opinion > 0 ? "+" : ""}${opinion}`}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const dockButton = (isOpen, hovered) => ({
  alignItems: "center",
  background: isOpen ? "rgba(96,165,250,0.16)" : hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
  border: isOpen ? "1px solid rgba(96,165,250,0.4)" : "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)", color: "white", cursor: "pointer", display: "flex",
  fontFamily: "inherit", height: "3.3rem", justifyContent: "center", outline: "none",
  transform: hovered ? "translateY(-1px)" : "translateY(0)", transition: "all 0.12s ease", width: "3.3rem",
});
const FocusIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 7v4M6 16v-3h12v3" />
  </svg>
);
const PoliticsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6z" />
  </svg>
);

const DockPanel = ({ Panel, Icon, title, hovered, isOpen, onToggle, setHovered }) => {
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => { if (isOpen) setHasOpened(true); }, [isOpen]);
  return (
    <>
      {hasOpened && <Panel isOpen={isOpen} onClose={onToggle} />}
      <button type="button" title={title} style={dockButton(isOpen, hovered)} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onToggle}>
        <Icon />
      </button>
    </>
  );
};

export const FocusDock = (props) => <DockPanel Panel={FocusPanel} Icon={FocusIcon} title={wordsFor(getStoredLanguage()).focus} {...props} />;
export const PoliticsDock = (props) => <DockPanel Panel={PoliticsPanel} Icon={PoliticsIcon} title={wordsFor(getStoredLanguage()).politics} {...props} />;
