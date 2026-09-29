// Phase 7.7 — le panneau Fronts : ouvrir un front contre un pays en guerre avec
// le joueur (toute la frontière, ou un tracé dessiné sur la carte), y envoyer des
// divisions, choisir la posture et l'axe, retracer, fermer. Les ordres passent
// par les mêmes règles que ceux des IA (frontsModel.js → runtime/hoi/fronts.js)
// et s'enregistrent dans la partie ; le moteur livre les batailles au tour.
// Phase 7.8 : les onglets Air et Mer. Test G avec Jev : le panneau est écrit dans
// la langue du joueur (frontsPanelText.js) et soustrait au traducteur ; un ordre
// donné pendant qu'une tâche occupe le jeu attend sa fin au lieu d'être refusé.

import React, { useEffect, useMemo, useState } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { loadWorldMapSeas, loadWorldMapSupply } from "../../runtime/worldmap/supplyData.js";
import { useWorldMapState } from "../Map/worldMapStore.js";
import { startFrontDraw, stopFrontDraw, useFrontDraw } from "../Map/frontDrawStore.js";
import { airPanelModel, applyPlayerAirOp, applyPlayerFrontOp, applyPlayerNavalOp, frontsPanelModel, navalPanelModel, panelMap } from "./frontsModel.js";
import { HOI_WRITE_ERRORS, updateHoiWorld } from "./hoiWrites.js";
import { getStoredLanguage } from "../../runtime/i18n.js";
import { placeNameFor } from "../../runtime/worldmap/placeNames.js";
import { seaZoneLabel } from "../../runtime/worldmap/seaNames.js";
import { describeBusy, frontsPanelWords, panelNoteText, panelPolity } from "./frontsPanelText.js";

const selectWorld = (world) => world ?? null;
const selectCountry = (game) => String(game?.country ?? "");
const selectHasArmies = (world) => Boolean(world?.hoi?.armies);
export const useArmiesActive = () => useRuntimeState("world", selectHasArmies);

const POSTURES = ["hold", "attack", "breakthrough"];
const TABS = ["land", "air", "sea"];
const NAVAL_MISSIONS = ["escort", "blockade", "support"];
const card = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "12px", padding: "0.7rem 0.8rem" };
const small = { color: "rgba(255,255,255,0.55)", fontSize: "0.7rem" };
const button = (active = false) => ({
  background: active ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.06)",
  border: `1px solid ${active ? "rgba(248,113,113,0.55)" : "rgba(255,255,255,0.14)"}`,
  borderRadius: "8px", color: "white", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, padding: "0.3rem 0.6rem",
});
const select = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "8px", color: "white", fontSize: "0.72rem", padding: "0.25rem 0.4rem" };

const FrontsPanel = ({ isOpen, onClose }) => {
  const world = useRuntimeState("world", selectWorld);
  const country = useRuntimeState("game", selectCountry);
  const worldMap = useWorldMapState();
  const draw = useFrontDraw();
  const [info, setInfo] = useState(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [enemy, setEnemy] = useState("");
  const [drawingFor, setDrawingFor] = useState(null); // "new" or a front id
  const [assign, setAssign] = useState({});
  // Phase 7.8 : Terre, Air, Mer.
  const [tab, setTab] = useState("land");
  const [seas, setSeas] = useState(null);
  const [airForm, setAirForm] = useState({ template: "chasse", count: 1, zone: "" });
  const [seaForm, setSeaForm] = useState({ zoneId: "", mission: "escort", count: 1 });
  const [landForm, setLandForm] = useState({ stateId: "", count: 3 });

  useEffect(() => {
    if (!isOpen || info) return undefined;
    let alive = true;
    loadWorldMapSupply().then((states) => { if (alive) setInfo(states); }).catch(() => {});
    return () => { alive = false; };
  }, [isOpen, info]);
  useEffect(() => {
    if (!isOpen || seas) return undefined;
    let alive = true;
    loadWorldMapSeas().then((data) => { if (alive) setSeas(data ?? { zones: {}, stateSeas: {} }); }).catch(() => {});
    return () => { alive = false; };
  }, [isOpen, seas]);
  useEffect(() => { if (!isOpen && draw.drawing) { stopFrontDraw(); setDrawingFor(null); } }, [isOpen, draw.drawing]);

  const map = useMemo(
    () => (world && info && worldMap.stateOwners ? panelMap(world, { info, stateOwners: worldMap.stateOwners, stateNames: worldMap.stateNames }) : null),
    [world, info, worldMap.stateOwners, worldMap.stateNames],
  );
  const model = useMemo(() => (world?.hoi?.armies ? frontsPanelModel(world, country, map) : null), [world, country, map]);
  const air = useMemo(() => (tab === "air" && world?.hoi?.armies ? airPanelModel(world, country, map) : null), [tab, world, country, map]);
  const sea = useMemo(() => (tab === "sea" && world?.hoi?.armies && seas ? navalPanelModel(world, country, map, seas) : null), [tab, world, country, map, seas]);
  // Tout dans la langue du joueur : libellés, pays, lieux, mers, messages.
  const language = getStoredLanguage();
  const w = frontsPanelWords(language);
  const place = (name) => placeNameFor(name, language);
  const polity = (name) => panelPolity(name, language);
  const zoneName = (zoneId, coast = "") => seaZoneLabel(seas?.zones?.[zoneId], { language, coastName: coast ? place(coast) : "" });
  const openable = (model?.enemies ?? []).filter((entry) => !entry.hasFront);
  const chosenEnemy = openable.some((entry) => entry.name === enemy) ? enemy : openable[0]?.name ?? "";
  const jev = world?.hoi?.lastLocalDecisions ?? null;

  // Un ordre, appliqué au monde du moment par `apply(current, op, map)`. Si une
  // tâche occupe le jeu, il attend qu'elle finisse (test G : « un saut est en
  // cours » jusqu'au rechargement de la page).
  const order = async (op, apply = applyPlayerFrontOp) => {
    if (pending || !model) return;
    setPending(true);
    setMessage("");
    try {
      let note = "";
      const result = await updateHoiWorld((current) => {
        const currentMap = info && worldMap.stateOwners ? panelMap(current, { info, stateOwners: worldMap.stateOwners, stateNames: worldMap.stateNames }) : null;
        const applied = apply(current, { polity: model.owner, ...op }, currentMap);
        note = panelNoteText(applied.note.text, { language, zoneName: (id) => zoneName(id) });
        return applied.note.kind === "dropped" ? { error: "refused" } : { world: applied.world };
      }, { onWait: (reasons) => setMessage(w.waiting(describeBusy(reasons, language))) });
      setMessage(result.ok || result.error === "refused" ? note
        : result.error === "busy" ? w.busy(describeBusy(result.reasons, language))
          : HOI_WRITE_ERRORS[result.error] ?? result.error);
    } finally {
      setPending(false);
    }
  };
  const run = (op) => order(op);
  const runAir = (op) => order(op, (current, full) => applyPlayerAirOp(current, full));
  const runSea = (op) => order(op, (current, full, currentMap) => applyPlayerNavalOp(current, full, currentMap, seas));
  const beginDraw = (target, sector = []) => { setDrawingFor(target); startFrontDraw(sector); setMessage(w.drawHint); };
  const endDraw = () => { stopFrontDraw(); setDrawingFor(null); };

  return (
    <div data-no-translate="" style={{
      backdropFilter: "blur(8px)", backgroundColor: "rgba(24,24,27,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px",
      bottom: isOpen ? "5.2rem" : "-40rem", boxShadow: "-4px 0 24px rgba(0,0,0,0.4)", color: "white", display: "flex", flexDirection: "column",
      fontFamily: "sans-serif", height: "min(calc(100vh - 9rem), 36rem)", left: "0.5rem", maxWidth: "calc(100vw - 1rem)", opacity: isOpen ? 1 : 0,
      overflow: "hidden", pointerEvents: isOpen ? "auto" : "none", position: "fixed", transition: "bottom 0.35s ease, opacity 0.35s ease", width: "26rem", zIndex: 9998,
    }}>
      <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", padding: "0.9rem 1.1rem 0.7rem" }}>
        <span style={{ fontSize: "1rem", fontWeight: 700 }}>{w.title}</span>
        <button type="button" aria-label={w.close} onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1rem" }}>✕</button>
      </div>
      <div style={{ display: "grid", gap: "0.7rem", overflowY: "auto", padding: "0.8rem 1.1rem 1rem" }}>
        {!model && <p style={small}>{w.noArmies}</p>}
        {model && !map && <p style={small}>{w.loadingMap}</p>}
        {model && (
          <div style={{ display: "flex", gap: "0.35rem" }} role="tablist">
            {TABS.map((value) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} style={button(tab === value)} onClick={() => { setTab(value); setMessage(""); }}>{w.tabs[value]}</button>
            ))}
          </div>
        )}
        {message && <div style={{ ...card, color: "#fde68a", fontSize: "0.74rem" }}>{message}</div>}

        {tab === "air" && model && !air && <p style={small}>{w.loading}</p>}
        {tab === "air" && air && (() => {
          const zone = airForm.zone || (air.fronts[0] ? `front:${air.fronts[0].id}` : "");
          const [kind, id] = zone.split(/:(.*)/s);
          const lost = Object.entries(air.losses).filter(([, count]) => count > 0);
          return (
            <>
              <div style={card}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>{w.airWings}</div>
                <div style={small}>
                  {`${w.freeNow} : ${Object.entries(air.free).map(([template, count]) => `${w.templates[template] ?? template} ${count}`).join(", ") || "—"}`}
                </div>
                {lost.length > 0 && (
                  <div style={{ ...small, color: "#fca5a5" }}>{`${w.aircraftLost} : ${lost.map(([item, count]) => `${item} ${Math.round(count)}`).join(", ")}`}</div>
                )}
                {air.fronts.length === 0 && air.states.length === 0 && <p style={small}>{w.needFront}</p>}
                {(air.fronts.length > 0 || air.states.length > 0) && (
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                    <input type="number" min={1} max={40} value={airForm.count} aria-label={w.wings} style={{ ...select, width: "3.2rem" }}
                      onChange={(event) => setAirForm((form) => ({ ...form, count: Number(event.target.value) || 1 }))} />
                    <select value={airForm.template} style={select} aria-label={w.wingType} onChange={(event) => setAirForm((form) => ({ ...form, template: event.target.value }))}>
                      <option value="chasse">{w.fighterMission}</option>
                      <option value="bombardement">{w.bomberMission}</option>
                    </select>
                    <select value={zone} style={select} aria-label={w.airZone} onChange={(event) => setAirForm((form) => ({ ...form, zone: event.target.value }))}>
                      {air.fronts.map((front) => <option key={front.id} value={`front:${front.id}`}>{w.frontAgainst(polity(front.enemy))}</option>)}
                      {air.states.map((state) => <option key={state.id} value={`state:${state.id}`}>{place(state.name)}</option>)}
                    </select>
                    <button type="button" style={button()} disabled={pending || !zone}
                      onClick={() => runAir({ op: "assign", ...(kind === "front" ? { frontId: id } : { stateId: id }), mission: airForm.template === "bombardement" ? "support" : "superiority", template: airForm.template, count: airForm.count })}>{w.send}</button>
                  </div>
                )}
              </div>
              {air.missions.map((mission) => (
                <div key={mission.id} style={{ ...card, alignItems: "center", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.75rem" }}>
                    {`${mission.mission === "support" ? w.support : w.superiority} · ${mission.wingIds.length} · ${mission.over.kind === "front" ? w.frontAgainst(polity(mission.over.enemy)) : place(mission.over.name)}`}
                  </span>
                  <button type="button" style={button()} disabled={pending} onClick={() => runAir({ op: "recall", missionId: mission.id })}>{w.recall}</button>
                </div>
              ))}
            </>
          );
        })()}

        {tab === "sea" && model && !sea && <p style={small}>{seas && !Object.keys(seas.zones ?? {}).length ? w.noSeaZones : w.loading}</p>}
        {tab === "sea" && sea && (() => {
          const zoneId = sea.zones.some((zone) => zone.zoneId === seaForm.zoneId) ? seaForm.zoneId : sea.zones[0]?.zoneId ?? "";
          const coast = sea.coasts.some((entry) => entry.id === landForm.stateId) ? landForm.stateId : sea.coasts[0]?.id ?? "";
          const controlText = (control) => (!control ? "" : control.contested ? ` · ${w.contested}` : ` · ${w.heldBy(control.owners.map(polity).join(", "))}`);
          return (
            <>
              <div style={card}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>{w.fleets}</div>
                <div style={small}>{`${w.freeFleets} : ${sea.freeFleets}`}</div>
                {sea.zones.length === 0 && <p style={small}>{w.noZone}</p>}
                {sea.zones.length > 0 && (
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                    <input type="number" min={1} max={40} value={seaForm.count} aria-label={w.fleets} style={{ ...select, width: "3.2rem" }}
                      onChange={(event) => setSeaForm((form) => ({ ...form, count: Number(event.target.value) || 1 }))} />
                    <select value={seaForm.mission} style={select} aria-label={w.naval} onChange={(event) => setSeaForm((form) => ({ ...form, mission: event.target.value }))}>
                      {NAVAL_MISSIONS.map((mission) => <option key={mission} value={mission}>{w.missions[mission]}</option>)}
                    </select>
                    <select value={zoneId} style={{ ...select, maxWidth: "13rem" }} aria-label={w.seaZone} onChange={(event) => setSeaForm((form) => ({ ...form, zoneId: event.target.value }))}>
                      {sea.zones.map((zone) => <option key={zone.zoneId} value={zone.zoneId}>{`${zoneName(zone.zoneId, zone.name)}${zone.enemy ? " ⚔" : ""}${controlText(zone.control)}`}</option>)}
                    </select>
                    <button type="button" style={button()} disabled={pending || !zoneId || !sea.freeFleets}
                      onClick={() => runSea({ op: "assign", zoneId, mission: seaForm.mission, count: seaForm.count })}>{w.send}</button>
                  </div>
                )}
              </div>
              {sea.missions.map((mission) => (
                <div key={mission.id} style={{ ...card, alignItems: "center", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.75rem" }}>{`${w.missions[mission.mission] ?? mission.mission} · ${mission.fleetIds.length} · ${zoneName(mission.zoneId, mission.name)}${controlText(mission.control)}`}</span>
                  <button type="button" style={button()} disabled={pending} onClick={() => runSea({ op: "recall", missionId: mission.id })}>{w.recall}</button>
                </div>
              ))}
              {sea.blockades.map((blockade) => (
                <div key={`${blockade.owner}-${blockade.zoneId}`} style={{ ...card, color: blockade.against ? "#fca5a5" : "#86efac", fontSize: "0.74rem" }}>
                  {`${blockade.against ? w.blockadeAgainst : w.blockadeHolds} · ${zoneName(blockade.zoneId)} · ${w.coastsCut(blockade.states.length)} (${blockade.stateNames.map(place).join(", ")})`}
                </div>
              ))}
              <div style={card}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>{w.landing}</div>
                <div style={small}>{`${w.onCoast} : ${sea.onCoast}`}</div>
                {sea.coasts.length === 0 && <p style={small}>{w.noCoast}</p>}
                {sea.coasts.length > 0 && (
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                    <input type="number" min={1} max={6} value={landForm.count} aria-label={w.divisionsToLand} style={{ ...select, width: "3.2rem" }}
                      onChange={(event) => setLandForm((form) => ({ ...form, count: Number(event.target.value) || 1 }))} />
                    <select value={coast} style={{ ...select, maxWidth: "12rem" }} aria-label={w.coast} onChange={(event) => setLandForm((form) => ({ ...form, stateId: event.target.value }))}>
                      {sea.coasts.map((entry) => <option key={entry.id} value={entry.id}>{`${place(entry.name)} (${polity(entry.owner)})`}</option>)}
                    </select>
                    <button type="button" style={button()} disabled={pending || !coast || !sea.onCoast}
                      onClick={() => runSea({ op: "land", stateId: coast, count: landForm.count })}>{w.prepare}</button>
                  </div>
                )}
                {sea.landings.map((landing) => (
                  <div key={landing.id} style={{ ...small, marginTop: "0.3rem" }}>{`${w.embarked} : ${landing.divisionIds.length} → ${place(landing.stateName)}`}</div>
                ))}
              </div>
            </>
          );
        })()}

        {/* Test G avec Jev : ses décisions ne se voyaient nulle part. */}
        {tab === "land" && jev && (
          <div style={{ ...card, fontSize: "0.72rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{w.jevTitle}</div>
            <div style={small}>{`${w.jevLine(jev.decisions?.length ?? 0, ((jev.ms ?? 0) / 1000).toFixed(1))}${jev.stopped ? ` · ${w.jevStopped(jev.stopped)}` : ""}`}</div>
          </div>
        )}

        {model && map && tab === "land" && (
          <div style={card}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>{w.openFront}</div>
            {model.enemies.length === 0 && <p style={small}>{w.noWar}</p>}
            {openable.length > 0 && (
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                <select value={chosenEnemy} onChange={(event) => setEnemy(event.target.value)} style={select} aria-label={w.enemy}>
                  {openable.map((entry) => <option key={entry.name} value={entry.name}>{polity(entry.name)}</option>)}
                </select>
                {drawingFor === "new" ? (
                  <>
                    <span style={small}>{w.statesDrawn(draw.sector.length)}</span>
                    <button type="button" style={button(true)} disabled={pending} onClick={() => { const sector = draw.sector; endDraw(); run({ op: "create", enemy: chosenEnemy, sector }); }}>{w.openOnLine}</button>
                    <button type="button" style={button()} onClick={endDraw}>{w.cancel}</button>
                  </>
                ) : (
                  <>
                    <button type="button" style={button()} disabled={pending} onClick={() => run({ op: "create", enemy: chosenEnemy })}>{w.wholeBorder}</button>
                    <button type="button" style={button()} onClick={() => beginDraw("new")}>{w.drawOnMap}</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "land" && model?.fronts.map((front) => {
          const pick = assign[front.id] ?? { template: Object.keys(model.free)[0] ?? "infanterie", count: 5 };
          return (
            <div key={front.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{polity(front.owner)} → {polity(front.enemy)}</span>
                <span style={small}>{w.divisions(front.divisionIds.length)}</span>
              </div>
              <div style={{ ...small, marginTop: "0.2rem" }}>{`${w.line} : ${front.ownStates.map((s) => place(s.name)).join(", ") || "—"}`}</div>
              <div style={{ ...small, marginTop: "0.15rem" }}>{`${w.axis} : ${front.axis ? place(front.axisName || front.targets.find((t) => t.id === front.axis)?.name || "?") : "—"}`}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                {POSTURES.map((value) => (
                  <button key={value} type="button" style={button(front.posture === value)} disabled={pending || front.posture === value}
                    onClick={() => run({ op: "posture", frontId: front.id, posture: value })}>{w.postures[value]}</button>
                ))}
              </div>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                <span style={small}>{w.axis}</span>
                <select value={front.axis} style={select} aria-label={w.axis} disabled={pending}
                  onChange={(event) => run({ op: "posture", frontId: front.id, posture: front.posture, axis: event.target.value })}>
                  <option value="">—</option>
                  {front.targets.map((target) => <option key={target.id} value={target.id}>{place(target.name)}</option>)}
                </select>
              </div>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                <span style={small}>{w.send}</span>
                <input type="number" min={1} max={60} value={pick.count} aria-label={w.divisions(pick.count)}
                  onChange={(event) => setAssign((all) => ({ ...all, [front.id]: { ...pick, count: Number(event.target.value) || 1 } }))}
                  style={{ ...select, width: "3.5rem" }} />
                <select value={pick.template} style={select} aria-label={w.wingType}
                  onChange={(event) => setAssign((all) => ({ ...all, [front.id]: { ...pick, template: event.target.value } }))}>
                  {Object.entries(model.free).map(([template, count]) => <option key={template} value={template}>{w.free(w.templates[template] ?? template, count)}</option>)}
                </select>
                <button type="button" style={button()} disabled={pending || !Object.keys(model.free).length}
                  onClick={() => run({ op: "assign", frontId: front.id, count: pick.count, template: pick.template })}>{w.send}</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                {drawingFor === front.id ? (
                  <>
                    <span style={small}>{w.states(draw.sector.length)}</span>
                    <button type="button" style={button(true)} disabled={pending} onClick={() => { const sector = draw.sector; endDraw(); run({ op: "sector", frontId: front.id, sector }); }}>{w.saveLine}</button>
                    <button type="button" style={button()} onClick={endDraw}>{w.cancel}</button>
                  </>
                ) : (
                  <button type="button" style={button()} onClick={() => beginDraw(front.id, front.sector)}>{w.redraw}</button>
                )}
                <button type="button" style={button()} disabled={pending} onClick={() => run({ op: "disband", frontId: front.id })}>{w.closeFront}</button>
              </div>
              {!front.atWar && <div style={{ ...small, color: "#fca5a5", marginTop: "0.3rem" }}>{w.noLongerAtWar}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FrontsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 17c3-1 4-5 7-5s4 4 7 4 3-2 4-3" />
    <path d="M14 6l4 3-4 3" />
    <path d="M4 7h14" />
  </svg>
);

const Fronts = ({ hovered, isOpen, onToggle, setHovered }) => {
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => { if (isOpen) setHasOpened(true); }, [isOpen]);
  return (
    <>
      {hasOpened && <FrontsPanel isOpen={isOpen} onClose={onToggle} />}
      <button
        type="button"
        title="Fronts"
        style={{
          alignItems: "center",
          background: isOpen ? "rgba(248,113,113,0.16)" : hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
          border: isOpen ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)", color: "white", cursor: "pointer", display: "flex",
          fontFamily: "inherit", height: "3.3rem", justifyContent: "center", outline: "none",
          transform: hovered ? "translateY(-1px)" : "translateY(0)", transition: "all 0.12s ease", width: "3.3rem",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onToggle}
      >
        <FrontsIcon />
      </button>
    </>
  );
};

export { Fronts, FrontsPanel };
