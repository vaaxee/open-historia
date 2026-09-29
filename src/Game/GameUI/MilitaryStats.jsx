// Phase 7.6 — le sous-onglet militaire des Statistiques (militaryStats.js).
import React from "react";
import { militaryStats } from "./militaryStats.js";
import { sheetWords } from "./battleSheet.js";
import { getStoredLanguage } from "../../runtime/i18n.js";
import { placeNameFor } from "../../runtime/worldmap/placeNames.js";
import { jevChoiceText } from "./frontsPanelText.js";
import { focusPanelModel, politicsPanelModel } from "./focusPoliticsModel.js";

const box = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", marginTop: "0.8rem", padding: "0.65rem 0.8rem" };
const heading = { color: "rgba(255,255,255,0.5)", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em", marginBottom: "0.4rem", textTransform: "uppercase" };
const row = { display: "flex", fontSize: "0.78rem", gap: "0.6rem", justifyContent: "space-between", lineHeight: 1.55 };
const num = (value) => Math.round(Number(value) || 0).toLocaleString();
const NAVAL_MISSION_LABELS = { escort: "Convoy escort", blockade: "Blockade", support: "Landing support" };

const MilitaryStats = ({ world, targetCountry }) => {
    const stats = militaryStats(world, targetCountry);
    if (!stats) {
        return <p style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.76rem", marginTop: "1rem" }}>This country has no army tracked by the engine.</p>;
    }
    // Valeurs dans la langue du joueur : lieux, pays, postures, résultats.
    const language = getStoredLanguage();
    const words = sheetWords(language);
    const produced = Object.entries(stats.produced).filter(([, count]) => count > 0);
    const reserve = Object.entries(stats.stockpile).filter(([, count]) => count > 0);
    // Phase 8 : la politique et le focus national du pays consulté.
    const politics = politicsPanelModel(world, targetCountry, { language });
    const focus = focusPanelModel(world, targetCountry, { language });
    return (
        <div>
            {politics && (
                <div style={box}>
                    <div style={heading}>Politics</div>
                    <div style={row}><span>In power</span><span data-no-translate="">{politics.ideologyName}</span></div>
                    <div style={row}><span>Stability / war support</span><span data-no-translate="">{Math.round(politics.stability)} % / {Math.round(politics.warSupport)} %</span></div>
                    {politics.nextElection && <div style={row}><span>Next election</span><span data-no-translate="">{politics.nextElection}</span></div>}
                    <div style={row}><span>National focus</span><span data-no-translate="">{focus?.current?.name ?? "—"}</span></div>
                </div>
            )}
            <div style={box}>
                <div style={heading}>Armed forces</div>
                <div style={row}><span>Divisions and wings</span><span data-no-translate="">{stats.totalDivisions}</span></div>
                <div style={row}><span>Men under arms</span><span data-no-translate="">{num(stats.men)}</span></div>
                <div style={row}><span>Manpower available</span><span data-no-translate="">{num(stats.manpower)}</span></div>
                {stats.divisions.map((group) => (
                    <div key={group.template} style={row}>
                        <span data-no-translate="">{words.templates[group.template] ?? group.label}</span>
                        <span data-no-translate="">{group.count} · {Math.round(group.strength * 100)}% · org {group.organisation}</span>
                    </div>
                ))}
            </div>
            <div style={box}>
                <div style={heading}>Supply</div>
                <div style={row}><span>Encircled divisions</span><span data-no-translate="">{stats.supply.encircled}</span></div>
                <div style={row}><span>Poorly supplied divisions</span><span data-no-translate="">{stats.supply.poorlySupplied}</span></div>
                {stats.supply.needed !== null && (
                    <div style={row}><span>Supplies used / needed (last turn)</span><span data-no-translate="">{num(stats.supply.consumed)} / {num(stats.supply.needed)}</span></div>
                )}
            </div>
            <div style={box}>
                <div style={heading}>Production (last turn) and reserve</div>
                {produced.length === 0 && <div style={row}><span>No output recorded yet</span></div>}
                {produced.map(([item, count]) => <div key={`p-${item}`} style={row}><span>{item}</span><span data-no-translate="">+{num(count)}</span></div>)}
                {reserve.map(([item, count]) => <div key={`r-${item}`} style={{ ...row, color: "rgba(255,255,255,0.6)" }}><span>{item} in reserve</span><span data-no-translate="">{num(count)}</span></div>)}
            </div>
            <div style={box}>
                <div style={heading}>Air force</div>
                <div style={row}><span>Air wings</span><span data-no-translate="">{stats.air.wings}</span></div>
                <div style={row}><span>On mission: air superiority / ground support</span><span data-no-translate="">{stats.air.superiority} / {stats.air.support}</span></div>
                {Object.entries(stats.air.lostLastTurn).filter(([, count]) => count > 0).map(([item, count]) => (
                    <div key={`air-${item}`} style={{ ...row, color: "#fca5a5" }}><span>Aircraft lost last turn</span><span data-no-translate="">{item} {num(count)}</span></div>
                ))}
            </div>
            <div style={box}>
                <div style={heading}>Navy</div>
                <div style={row}><span>Fleets</span><span data-no-translate="">{stats.navy.fleets}</span></div>
                {stats.navy.missions.map((mission) => (
                    <div key={`sea-${mission.zoneId}-${mission.mission}`} style={row}>
                        <span>{NAVAL_MISSION_LABELS[mission.mission] ?? mission.mission}</span>
                        <span data-no-translate="">{mission.count} · {mission.zoneId}</span>
                    </div>
                ))}
                <div style={row}><span>Sea zones held</span><span data-no-translate="">{stats.navy.zonesHeld}</span></div>
                {stats.navy.blockading > 0 && <div style={row}><span>Enemy coastal states under blockade</span><span data-no-translate="">{stats.navy.blockading}</span></div>}
                {stats.navy.shipsLost > 0 && <div style={{ ...row, color: "#fca5a5" }}><span>Ships lost in naval battles</span><span data-no-translate="">{stats.navy.shipsLost}</span></div>}
                {stats.navy.battles.map((battle) => (
                    <div key={battle.id} style={row}>
                        <span data-no-translate="">{battle.date} · {battle.zoneId}{battle.zoneName ? ` · ${placeNameFor(battle.zoneName, language)}` : ""}</span>
                        <span data-no-translate="">{words.navalResults[battle.result] ?? battle.result}</span>
                    </div>
                ))}
            </div>
            {stats.localDecisions.length > 0 && (
                <div style={box}>
                    <div style={heading}>Local decider (Jev), last turn</div>
                    {stats.localDecisions.map((decision, index) => (
                        <div key={`jev-${index}`} style={{ ...row, justifyContent: "flex-start" }}><span data-no-translate="">{jevChoiceText(decision.choice, language)}</span></div>
                    ))}
                </div>
            )}
            <div style={box}>
                <div style={heading}>Fronts</div>
                {stats.fronts.length === 0 && <div style={row}><span>No front</span></div>}
                {stats.fronts.map((front) => (
                    <div key={front.id} style={row}>
                        <span data-no-translate="">{words.polity(front.owner)} → {words.polity(front.enemy)}</span>
                        <span data-no-translate="">{words.postures[front.posture] ?? front.posture} · {front.divisionIds.length}</span>
                    </div>
                ))}
            </div>
            <div style={box}>
                <div style={heading}>Recent battles</div>
                {stats.battles.length === 0 && <div style={row}><span>No battle yet</span></div>}
                {stats.battles.map((battle) => (
                    <div key={battle.id} style={row}>
                        <span data-no-translate="">{battle.date} · {placeNameFor(battle.stateName, language)}</span>
                        <span data-no-translate="">{words.results[battle.result] ?? battle.result}</span>
                    </div>
                ))}
                {stats.lostInBattle > 0 && <div style={{ ...row, color: "#fca5a5" }}><span>Men lost in these battles</span><span data-no-translate="">{num(stats.lostInBattle)}</span></div>}
            </div>
        </div>
    );
};

export default MilitaryStats;
