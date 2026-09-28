// Phase 7.6 — la fiche d'une bataille du moteur, dans la carte de son événement.
import React from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { battleSheetRows, findBattle } from "./battleSheet.js";

const selectBattleLog = (world) => world?.hoi?.battleLog ?? null;

const BattleSheet = ({ battleId }) => {
    const log = useRuntimeState("world", selectBattleLog);
    const battle = findBattle(log, battleId);
    const [open, setOpen] = React.useState(false);
    if (!battle) return null;
    const rows = battleSheetRows(battle);
    return (
        <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "12px", padding: "0.5rem 0.7rem" }}>
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                style={{ background: "none", border: "none", color: "#fecaca", cursor: "pointer", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em", padding: 0, textTransform: "uppercase" }}
            >
                Battle sheet {open ? "▴" : "▾"}
            </button>
            {open && (
                <div style={{ display: "grid", gap: "0.2rem", marginTop: "0.4rem" }}>
                    {rows.map((row) => (
                        <div key={row.label} style={{ display: "flex", fontSize: "0.72rem", gap: "0.5rem", lineHeight: 1.4 }}>
                            <span style={{ color: "rgba(254,202,202,0.75)", flexShrink: 0, minWidth: "7.5rem" }}>{row.label}</span>
                            <span data-no-translate="" style={{ color: "rgba(244,244,245,0.9)" }}>{row.value}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default BattleSheet;
