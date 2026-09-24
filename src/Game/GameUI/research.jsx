// Couche HOI4 — panneau « Recherche » (phase 2).
//
// Le premier panneau interactif de la couche : le joueur choisit ce que son pays
// recherche (emplacements, file d'attente). Tous les autres pays, c'est le moteur
// qui choisit (runtime/hoi/research.js). Les écritures passent par hoiWrites.js.
// Le lanceur n'existe que dans une partie qui a world.hoi, comme Production.

import React, { useEffect, useMemo, useState } from "react";

import { findNationKey } from "../../runtime/hoi/engine.js";
import {
  HOI_TECH_BRANCHES,
  aheadPenalty,
  dequeueResearch,
  effectiveTechCost,
  enqueueResearch,
  researchSlotCount,
  startResearch,
  stopResearch,
  techStatus,
} from "../../runtime/hoi/research.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { HOI_WRITE_ERRORS, updateHoiLayer } from "./hoiWrites.js";

const selectHoi = (world) => world?.hoi ?? null;
const selectGame = (game) => `${String(game?.country ?? "")}|${String(game?.gameDate ?? "")}`;

const muted = "rgba(255,255,255,0.5)";
const faint = "rgba(255,255,255,0.07)";
const accent = "#60a5fa";

const BRANCH_LABELS = Object.freeze({
  infanterie: "Infantry",
  artillerie: "Artillery",
  blindes: "Armour",
  aviation: "Air",
  industrie: "Industry",
});

const STATUS_STYLE = Object.freeze({
  done: { color: "#4ade80", label: "Researched" },
  active: { color: accent, label: "In progress" },
  queued: { color: "#facc15", label: "Queued" },
  available: { color: "white", label: "Available" },
  locked: { color: "rgba(255,255,255,0.35)", label: "Locked" },
});

const pct = (value) => `${Math.round(value * 100)}%`;

const describeEffect = (effect, equipment) => {
  if (effect.type === "unlock") return `Unlocks ${effect.label || effect.equipment}`;
  if (effect.type === "efficiency") return `+${pct(effect.value)} efficiency cap`;
  if (effect.type === "extraction") return `+${pct(effect.value)} ${effect.resource} extraction`;
  if (effect.type === "cost") return `−${pct(effect.value)} cost of ${equipment?.[effect.equipment]?.label || effect.equipment}`;
  return "";
};

const smallButton = (primary = false) => ({
  background: primary ? "rgba(59,130,246,0.22)" : "rgba(255,255,255,0.06)",
  border: `1px solid ${primary ? "rgba(96,165,250,0.45)" : "rgba(255,255,255,0.12)"}`,
  borderRadius: 7,
  color: "white",
  cursor: "pointer",
  fontSize: "0.7rem",
  padding: "0.2rem 0.5rem",
  whiteSpace: "nowrap",
});

const ProgressBar = ({ value }) => (
  <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 5, overflow: "hidden", width: "100%" }}>
    <div style={{ background: accent, height: "100%", width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
  </div>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// A flask, in the same stroke family as the other launcher icons.
const ResearchDockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3h6" />
    <path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" />
    <path d="M7.5 15h9" />
  </svg>
);

const ResearchPanel = ({ isOpen, onClose }) => {
  const hoi = useRuntimeState("world", selectHoi);
  const [country, gameDate] = useRuntimeState("game", selectGame).split("|");
  const isMobile = useIsMobile();
  const [branch, setBranch] = useState(HOI_TECH_BRANCHES[0]);
  // A message is about the last click; it is shown only while the world it was
  // written against is still the current one.
  const [feedback, setFeedback] = useState({ text: "", hoi: null });
  const [pending, setPending] = useState(false);
  const message = feedback.hoi === hoi ? feedback.text : "";

  const tree = hoi?.tech?.tree ?? null;
  const playerKey = useMemo(
    () => findNationKey(hoi, country) ?? findNationKey(hoi, toCountryName(country)),
    [hoi, country],
  );
  const nation = playerKey ? hoi?.nations?.[playerKey] : null;
  const byId = useMemo(() => new Map((tree?.techs ?? []).map((tech) => [tech.id, tech])), [tree]);
  const branchTechs = useMemo(
    () => (tree?.techs ?? []).filter((tech) => tech.branch === branch).sort((a, b) => a.year - b.year || a.name.localeCompare(b.name)),
    [tree, branch],
  );

  const act = async (mutateNation) => {
    if (!playerKey || pending) return;
    setPending(true);
    try {
      const result = await updateHoiLayer((current) => {
        const key = findNationKey(current, playerKey);
        if (!key) return { error: "unknown-nation" };
        const { nation: next, error } = mutateNation(current.nations[key], current.tech?.tree);
        if (error) return { error };
        return { hoi: { ...current, nations: { ...current.nations, [key]: next } } };
      });
      setFeedback({ text: result.ok ? "" : (HOI_WRITE_ERRORS[result.error] ?? result.error), hoi });
    } finally {
      setPending(false);
    }
  };

  const slots = nation?.research?.slots ?? [];
  const capacity = nation ? researchSlotCount(nation) : 0;
  const queue = nation?.research?.queue ?? [];
  const freeSlot = slots.length < capacity;

  return (
    <div
      style={{
        backdropFilter: "blur(8px)",
        backgroundColor: "rgba(24, 24, 27, 0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px",
        bottom: isOpen ? "4.25rem" : "-30rem",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        fontFamily: "sans-serif",
        height: "min(calc(100vh - 9rem), max(calc(100vh - 16rem), 30rem))",
        left: "0rem",
        maxWidth: "calc(100vw - 1rem)",
        minHeight: "10rem",
        opacity: isOpen ? 1 : 0,
        overflow: "hidden",
        pointerEvents: isOpen ? "auto" : "none",
        position: "fixed",
        transition: "bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease",
        width: isMobile ? "calc(100vw - 1rem)" : "28rem",
        zIndex: 9998,
      }}
    >
      <div style={{ borderBottom: `1px solid ${faint}`, padding: "1rem 1.25rem 0.75rem" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.01em" }}>Research</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", display: "flex", padding: "0.2rem" }}
          >
            <CloseIcon />
          </button>
        </div>
        {tree && (
          <div style={{ color: muted, fontSize: "0.7rem", marginTop: "0.2rem" }}>
            <span data-no-translate>{tree.techs.length}</span> technologies ·{" "}
            {tree.source === "ai" ? "tree written by the AI" : "standard tree for this era"}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "thin" }}>
        {!tree ? (
          <div style={{ color: muted, fontSize: "0.8rem", padding: "1.25rem", lineHeight: 1.5 }}>
            The research tree is being prepared for this campaign. It appears here a few seconds after the game loads, or on the next load if the AI could not answer.
          </div>
        ) : !nation ? (
          <div style={{ color: muted, fontSize: "0.8rem", padding: "1.25rem" }}>Your country has no tracked economy.</div>
        ) : (
          <>
            <section style={{ borderBottom: `1px solid ${faint}`, padding: "0.75rem 1.25rem" }}>
              <div style={{ color: muted, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "0.45rem", textTransform: "uppercase" }}>
                Slots <span data-no-translate>{slots.length} / {capacity}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {slots.map((slot) => {
                  const tech = byId.get(slot.techId);
                  if (!tech) return null;
                  const cost = effectiveTechCost(tech, gameDate);
                  return (
                    <div key={slot.techId}>
                      <div style={{ alignItems: "center", display: "flex", fontSize: "0.82rem", gap: "0.5rem", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <span data-no-translate style={{ fontWeight: 700 }}>{tech.name}</span>
                        <button type="button" disabled={pending} style={smallButton()} onClick={() => act((current) => stopResearch(current, tech.id))}>
                          Stop
                        </button>
                      </div>
                      <ProgressBar value={slot.progress / cost} />
                      <div style={{ color: muted, fontSize: "0.66rem", marginTop: "0.15rem" }}>
                        <span data-no-translate>{Math.floor(slot.progress)} / {Math.round(cost)}</span> days
                      </div>
                    </div>
                  );
                })}
                {Array.from({ length: Math.max(0, capacity - slots.length) }, (_, index) => (
                  <div key={`free-${index}`} style={{ border: "1px dashed rgba(255,255,255,0.18)", borderRadius: 8, color: muted, fontSize: "0.74rem", padding: "0.4rem 0.6rem" }}>
                    Free slot — pick a technology below. An empty slot researches nothing.
                  </div>
                ))}
              </div>
            </section>

            {queue.length > 0 && (
              <section style={{ borderBottom: `1px solid ${faint}`, padding: "0.75rem 1.25rem" }}>
                <div style={{ color: muted, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "0.45rem", textTransform: "uppercase" }}>
                  Queue
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {queue.map((id, index) => (
                    <div key={id} style={{ alignItems: "center", display: "flex", fontSize: "0.78rem", justifyContent: "space-between" }}>
                      <span data-no-translate>{index + 1}. {byId.get(id)?.name ?? id}</span>
                      <button type="button" disabled={pending} style={smallButton()} onClick={() => act((current) => dequeueResearch(current, id))}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section style={{ padding: "0.75rem 1.25rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.65rem" }}>
                {HOI_TECH_BRANCHES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBranch(key)}
                    style={{ ...smallButton(key === branch), fontSize: "0.72rem", padding: "0.3rem 0.6rem" }}
                  >
                    {BRANCH_LABELS[key]}
                  </button>
                ))}
              </div>
              {message && <div style={{ color: "#fca5a5", fontSize: "0.72rem", marginBottom: "0.5rem" }}>{message}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {branchTechs.map((tech) => {
                  const status = techStatus(nation, tech);
                  const style = STATUS_STYLE[status];
                  const penalty = aheadPenalty(tech, gameDate);
                  const missing = (tech.requires ?? []).filter((id) => !(nation.research?.done ?? []).includes(id));
                  return (
                    <div
                      key={tech.id}
                      style={{
                        background: status === "active" ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${status === "active" ? "rgba(96,165,250,0.35)" : faint}`,
                        borderRadius: 9,
                        opacity: status === "locked" ? 0.7 : 1,
                        padding: "0.5rem 0.6rem",
                      }}
                    >
                      <div style={{ alignItems: "baseline", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                        <span data-no-translate style={{ fontSize: "0.82rem", fontWeight: 700 }}>{tech.name}</span>
                        <span style={{ color: style.color, fontSize: "0.66rem", whiteSpace: "nowrap" }}>{style.label}</span>
                      </div>
                      <div style={{ color: muted, fontSize: "0.68rem", marginTop: "0.15rem" }}>
                        <span data-no-translate>{tech.year}</span> · <span data-no-translate>{Math.round(effectiveTechCost(tech, gameDate))}</span> days
                        {penalty > 0 && <span style={{ color: "#fbbf24" }}> (ahead of its time: +<span data-no-translate>{pct(penalty)}</span>)</span>}
                      </div>
                      <div style={{ fontSize: "0.72rem", marginTop: "0.2rem" }}>
                        {(tech.effects ?? []).map((effect) => describeEffect(effect, tree.equipment)).filter(Boolean).join(" · ")}
                      </div>
                      {status === "locked" && missing.length > 0 && (
                        <div style={{ color: muted, fontSize: "0.66rem", marginTop: "0.15rem" }}>
                          Needs: <span data-no-translate>{missing.map((id) => byId.get(id)?.name ?? id).join(", ")}</span>
                        </div>
                      )}
                      {status !== "done" && status !== "active" && (
                        <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem" }}>
                          {status === "available" || status === "queued" ? (
                            <button
                              type="button"
                              disabled={pending || !freeSlot}
                              title={freeSlot ? "" : "Every research slot is taken"}
                              style={{ ...smallButton(true), opacity: freeSlot ? 1 : 0.5 }}
                              onClick={() => act((current, currentTree) => startResearch(current, tech.id, currentTree))}
                            >
                              Research
                            </button>
                          ) : null}
                          {status !== "queued" && (
                            <button type="button" disabled={pending} style={smallButton()} onClick={() => act((current, currentTree) => enqueueResearch(current, tech.id, currentTree))}>
                              Queue
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

// The launcher, with the same hasOpened latch as Projects and Production.
const Research = ({ hovered, isOpen, onToggle, setHovered }) => {
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);

  return (
    <>
      {hasOpened && <ResearchPanel isOpen={isOpen} onClose={onToggle} />}
      <button
        type="button"
        title="Research"
        style={{
          alignItems: "center",
          background: isOpen
            ? "rgba(59,130,246,0.16)"
            : hovered
              ? "rgba(255,255,255,0.08)"
              : "rgba(255,255,255,0.04)",
          border: isOpen ? "1px solid rgba(96,165,250,0.34)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          color: "white",
          cursor: "pointer",
          display: "flex",
          fontFamily: "inherit",
          fontSize: "1.2rem",
          height: "3.3rem",
          justifyContent: "center",
          outline: "none",
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
          transition: "all 0.12s ease",
          width: "3.3rem",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onToggle}
      >
        <ResearchDockIcon />
      </button>
    </>
  );
};

export { Research, ResearchPanel };
