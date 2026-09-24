// Couche HOI4 — panneau « Production » (phase 1, lecture seule).
//
// Ce que le moteur (runtime/hoi/engine.js) tient pour une nation : stocks,
// extraction, usines, lignes de production, modificateurs actifs, et le rapport
// du dernier saut, pénuries en rouge. Le lanceur n'existe que pour une partie qui
// a world.hoi (useHoiLayerActive) ; une partie ordinaire ne voit rien de neuf.
//
// Lecture seule en phase 1 : réaffecter des usines depuis ce panneau viendra en
// phase 2. Pour l'instant, c'est l'IA qui le fait, par economyOps.

import React, { useEffect, useMemo, useState } from "react";

import { findNationKey } from "../../runtime/hoi/engine.js";
import { HOI_SERIES } from "../../runtime/hoi/presets.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";

const selectHoi = (world) => world?.hoi ?? null;
const selectHoiActive = (world) => Boolean(world?.hoi && typeof world.hoi === "object");
const selectCountry = (game) => String(game?.country ?? "");

// Pour chat.jsx (le dock) et search.jsx (qui se place à côté du dock).
export const useHoiLayerActive = () => useRuntimeState("world", selectHoiActive);

const muted = "rgba(255,255,255,0.5)";
const faint = "rgba(255,255,255,0.07)";
const shortageColor = "#f87171";

const formatNumber = (value) => {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
};

const Section = ({ title, children, aside = null }) => (
  <section style={{ borderBottom: `1px solid ${faint}`, padding: "0.75rem 1.25rem" }}>
    <div style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between", marginBottom: "0.45rem" }}>
      <span style={{ color: muted, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</span>
      {aside}
    </div>
    {children}
  </section>
);

const Empty = ({ children }) => (
  <div style={{ color: muted, fontSize: "0.78rem" }}>{children}</div>
);

const EfficiencyBar = ({ value }) => (
  <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 5, overflow: "hidden", width: "100%" }}>
    <div style={{ background: "#60a5fa", height: "100%", width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
  </div>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// A factory, in the same stroke family as the other launcher icons.
const ProductionDockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21V10l6 4V10l6 4V6h6v15Z" />
    <path d="M7 17h2" />
    <path d="M13 17h2" />
    <path d="M18 3v3" />
  </svg>
);

const ProductionPanel = ({ isOpen, onClose }) => {
  const hoi = useRuntimeState("world", selectHoi);
  const country = useRuntimeState("game", selectCountry);
  const isMobile = useIsMobile();

  const nationKeys = useMemo(() => {
    const nations = hoi?.nations ?? {};
    return Object.keys(nations).sort((a, b) => {
      const weight = (key) => (Number(nations[key]?.factories?.civilian) || 0) + (Number(nations[key]?.factories?.military) || 0);
      return weight(b) - weight(a) || a.localeCompare(b);
    });
  }, [hoi]);

  // The player's nation by default; game.country may be a picker code ("GBR").
  const playerKey = useMemo(
    () => findNationKey(hoi, country) ?? findNationKey(hoi, toCountryName(country)),
    [hoi, country],
  );
  // The picked country while it still exists, otherwise the player's own.
  const [picked, setSelected] = useState("");
  const selected = hoi?.nations?.[picked] ? picked : (playerKey ?? nationKeys[0] ?? "");

  const nation = hoi?.nations?.[selected] ?? null;
  const report = hoi?.lastReport?.nations?.[selected] ?? null;
  const shortages = report?.shortages ?? {};
  const resources = nation
    ? [...new Set([...Object.keys(nation.stocks ?? {}), ...Object.keys(nation.extraction ?? {}), ...Object.keys(shortages)])].sort()
    : [];
  const seriesLabel = hoi?.series ? HOI_SERIES[hoi.series]?.label : "";

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
        width: isMobile ? "calc(100vw - 1rem)" : "26.25rem",
        zIndex: 9998,
      }}
    >
      <div style={{ borderBottom: `1px solid ${faint}`, padding: "1rem 1.25rem 0.75rem" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.01em" }}>Production</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", display: "flex", padding: "0.2rem" }}
          >
            <CloseIcon />
          </button>
        </div>
        {seriesLabel && <div style={{ color: muted, fontSize: "0.7rem", marginTop: "0.2rem" }}>{seriesLabel}</div>}
        {nationKeys.length > 1 && (
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="Country"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              color: "white",
              fontSize: "0.8rem",
              marginTop: "0.6rem",
              padding: "0.35rem 0.5rem",
              width: "100%",
            }}
          >
            {nationKeys.map((key) => (
              <option key={key} value={key} style={{ background: "#18181b" }} data-no-translate>
                {key}{key === playerKey ? " (you)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "thin" }}>
        {!nation ? (
          <div style={{ padding: "1.25rem" }}>
            <Empty>No economy is tracked for this country.</Empty>
          </div>
        ) : (
          <>
            <Section title="Factories">
              <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.9rem" }}>
                <span><strong data-no-translate>{nation.factories?.civilian ?? 0}</strong> <span style={{ color: muted }}>civilian</span></span>
                <span><strong data-no-translate>{nation.factories?.military ?? 0}</strong> <span style={{ color: muted }}>military</span></span>
              </div>
            </Section>

            <Section title="Resources" aside={<span style={{ color: muted, fontSize: "0.66rem" }}>stock · per month</span>}>
              {resources.length === 0 ? <Empty>No resources.</Empty> : (
                <div style={{ display: "grid", gap: "0.3rem", gridTemplateColumns: "1fr auto auto", fontSize: "0.8rem" }}>
                  {resources.map((resource) => {
                    const short = shortages[resource];
                    return (
                      <React.Fragment key={resource}>
                        <span data-no-translate style={{ color: short ? shortageColor : "white" }}>
                          {resource}{short ? ` — short ${formatNumber(short)}` : ""}
                        </span>
                        <span data-no-translate style={{ textAlign: "right" }}>{formatNumber(nation.stocks?.[resource] ?? 0)}</span>
                        <span data-no-translate style={{ color: muted, minWidth: "3.5rem", textAlign: "right" }}>
                          {nation.extraction?.[resource] ? `+${formatNumber(nation.extraction[resource])}` : "—"}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Production lines">
              {(nation.lines ?? []).length === 0 ? <Empty>No production line.</Empty> : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {nation.lines.map((line) => (
                    <div key={line.id}>
                      <div style={{ display: "flex", fontSize: "0.82rem", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <span data-no-translate style={{ fontWeight: 700 }}>{line.equipment}</span>
                        <span style={{ color: muted }}>
                          <span data-no-translate>{line.factories}</span> factories · <span data-no-translate>{line.produced}</span> built
                        </span>
                      </div>
                      <EfficiencyBar value={line.efficiency} />
                      <div style={{ color: muted, fontSize: "0.66rem", marginTop: "0.15rem" }}>
                        Efficiency <span data-no-translate>{Math.round(line.efficiency * 100)}%</span>
                        {Object.keys(line.resources ?? {}).length > 0 && (
                          <span data-no-translate>
                            {" · "}
                            {Object.entries(line.resources).map(([key, value]) => `${key} ${formatNumber(value)}`).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Active modifiers">
              {(nation.modifiers ?? []).length === 0 ? <Empty>None.</Empty> : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.8rem" }}>
                  {nation.modifiers.map((modifier) => (
                    <div key={modifier.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                      <span data-no-translate>{modifier.label || modifier.id}</span>
                      <span data-no-translate style={{ color: modifier.value < 0 ? shortageColor : "#4ade80", whiteSpace: "nowrap" }}>
                        {modifier.value > 0 ? "+" : ""}{Math.round(modifier.value * 100)}%
                        {modifier.untilDate ? <span style={{ color: muted }}> → {modifier.untilDate}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Last jump"
              aside={report ? <span data-no-translate style={{ color: muted, fontSize: "0.66rem" }}>{hoi.lastReport.fromDate} → {hoi.lastReport.toDate}</span> : null}
            >
              {!report ? <Empty>No jump computed yet.</Empty> : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.8rem" }}>
                  <div>
                    <span style={{ color: muted }}>Built: </span>
                    <span data-no-translate>
                      {Object.entries(report.produced ?? {}).map(([key, value]) => `${value} ${key}`).join(", ") || "—"}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: muted }}>Extracted: </span>
                    <span data-no-translate>
                      {Object.entries(report.extracted ?? {}).map(([key, value]) => `${formatNumber(value)} ${key}`).join(", ") || "—"}
                    </span>
                  </div>
                  {Object.keys(shortages).length > 0 && (
                    <div style={{ color: shortageColor }}>
                      Shortages: <span data-no-translate>{Object.entries(shortages).map(([key, value]) => `${key} (${formatNumber(value)})`).join(", ")}</span>
                    </div>
                  )}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
};

// The launcher, with the same hasOpened latch as Projects: the panel body is
// never mounted until it is first opened.
const Production = ({ hovered, isOpen, onToggle, setHovered }) => {
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);

  return (
    <>
      {hasOpened && <ProductionPanel isOpen={isOpen} onClose={onToggle} />}
      <button
        type="button"
        title="Production"
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
        <ProductionDockIcon />
      </button>
    </>
  );
};

export { Production, ProductionPanel };
