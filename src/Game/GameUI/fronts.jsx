// Phase 7.7 — le panneau Fronts : ouvrir un front contre un pays en guerre avec
// le joueur (toute la frontière, ou un tracé dessiné sur la carte), y envoyer des
// divisions, choisir la posture et l'axe, retracer, fermer. Les ordres passent
// par les mêmes règles que ceux des IA (frontsModel.js → runtime/hoi/fronts.js)
// et s'enregistrent dans la partie ; le moteur livre les batailles au tour.

import React, { useEffect, useMemo, useState } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { loadWorldMapSeas, loadWorldMapSupply } from "../../runtime/worldmap/supplyData.js";
import { useWorldMapState } from "../Map/worldMapStore.js";
import { startFrontDraw, stopFrontDraw, useFrontDraw } from "../Map/frontDrawStore.js";
import { airPanelModel, applyPlayerAirOp, applyPlayerFrontOp, applyPlayerNavalOp, frontsPanelModel, navalPanelModel, panelMap } from "./frontsModel.js";
import { HOI_WRITE_ERRORS, updateHoiWorld } from "./hoiWrites.js";
import { getStoredLanguage } from "../../runtime/i18n.js";
import { placeNameFor } from "../../runtime/worldmap/placeNames.js";
import { frenchPolityName } from "../../runtime/polityExonyms.js";

const selectWorld = (world) => world ?? null;
const selectCountry = (game) => String(game?.country ?? "");
const selectHasArmies = (world) => Boolean(world?.hoi?.armies);
export const useArmiesActive = () => useRuntimeState("world", selectHasArmies);

const POSTURES = [["hold", "Hold"], ["attack", "Attack"], ["breakthrough", "Break through"]];
const TABS = [["land", "Land"], ["air", "Air"], ["sea", "Sea"]];
const NAVAL_LABELS = { escort: "Convoy escort", blockade: "Blockade", support: "Landing support" };
const templateName = (template) => ({ chasse: "fighters", bombardement: "bombers", flotte: "fleets" })[template] ?? template;
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
    if (!isOpen || tab !== "sea" || seas) return undefined;
    let alive = true;
    loadWorldMapSeas().then((data) => { if (alive) setSeas(data ?? { zones: {}, stateSeas: {} }); }).catch(() => {});
    return () => { alive = false; };
  }, [isOpen, tab, seas]);
  useEffect(() => { if (!isOpen && draw.drawing) { stopFrontDraw(); setDrawingFor(null); } }, [isOpen, draw.drawing]);

  const map = useMemo(
    () => (world && info && worldMap.stateOwners ? panelMap(world, { info, stateOwners: worldMap.stateOwners, stateNames: worldMap.stateNames }) : null),
    [world, info, worldMap.stateOwners, worldMap.stateNames],
  );
  const model = useMemo(() => (world?.hoi?.armies ? frontsPanelModel(world, country, map) : null), [world, country, map]);
  const air = useMemo(() => (tab === "air" && world?.hoi?.armies ? airPanelModel(world, country, map) : null), [tab, world, country, map]);
  const sea = useMemo(() => (tab === "sea" && world?.hoi?.armies && seas ? navalPanelModel(world, country, map, seas) : null), [tab, world, country, map, seas]);
  // Les lieux et les pays dans la langue du joueur (test G : « axe imp-rgb-AA7700 »).
  const language = getStoredLanguage();
  const place = (name) => placeNameFor(name, language);
  const polity = (name) => (/^fr\b/i.test(language) ? frenchPolityName(name) : name);
  const openable = (model?.enemies ?? []).filter((entry) => !entry.hasFront);
  const chosenEnemy = openable.some((entry) => entry.name === enemy) ? enemy : openable[0]?.name ?? "";

  // Un ordre, appliqué au monde du moment par `apply(current, op, map)`.
  const order = async (op, apply = applyPlayerFrontOp) => {
    if (pending || !model) return;
    setPending(true);
    setMessage("");
    try {
      let note = "";
      const result = await updateHoiWorld((current) => {
        const currentMap = info && worldMap.stateOwners ? panelMap(current, { info, stateOwners: worldMap.stateOwners, stateNames: worldMap.stateNames }) : null;
        const applied = apply(current, { polity: model.owner, ...op }, currentMap);
        note = applied.note.text.replace(/^(frontOps|airOps|navalOps) — /, "");
        return applied.note.kind === "dropped" ? { error: "refused" } : { world: applied.world };
      });
      setMessage(result.ok ? note : (result.error === "refused" ? note : HOI_WRITE_ERRORS[result.error] ?? result.error));
    } finally {
      setPending(false);
    }
  };
  const run = (op) => order(op);
  const runAir = (op) => order(op, (current, full) => applyPlayerAirOp(current, full));
  const runSea = (op) => order(op, (current, full, currentMap) => applyPlayerNavalOp(current, full, currentMap, seas));
  const beginDraw = (target, sector = []) => { setDrawingFor(target); startFrontDraw(sector); setMessage("Click your states along the border on the map, then save."); };
  const endDraw = () => { stopFrontDraw(); setDrawingFor(null); };

  return (
    <div style={{
      backdropFilter: "blur(8px)", backgroundColor: "rgba(24,24,27,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px",
      bottom: isOpen ? "5.2rem" : "-40rem", boxShadow: "-4px 0 24px rgba(0,0,0,0.4)", color: "white", display: "flex", flexDirection: "column",
      fontFamily: "sans-serif", height: "min(calc(100vh - 9rem), 36rem)", left: "0.5rem", maxWidth: "calc(100vw - 1rem)", opacity: isOpen ? 1 : 0,
      overflow: "hidden", pointerEvents: isOpen ? "auto" : "none", position: "fixed", transition: "bottom 0.35s ease, opacity 0.35s ease", width: "26rem", zIndex: 9998,
    }}>
      <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", padding: "0.9rem 1.1rem 0.7rem" }}>
        <span style={{ fontSize: "1rem", fontWeight: 700 }}>Fronts</span>
        <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1rem" }}>✕</button>
      </div>
      <div style={{ display: "grid", gap: "0.7rem", overflowY: "auto", padding: "0.8rem 1.1rem 1rem" }}>
        {!model && <p style={small}>This game has no armies tracked by the engine.</p>}
        {model && !map && <p style={small}>Loading the map…</p>}
        {model && (
          <div style={{ display: "flex", gap: "0.35rem" }} role="tablist">
            {TABS.map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} style={button(tab === value)} onClick={() => { setTab(value); setMessage(""); }}>{label}</button>
            ))}
          </div>
        )}
        {message && <div style={{ ...card, color: "#fde68a", fontSize: "0.74rem" }}>{message}</div>}

        {tab === "air" && model && !air && <p style={small}>Loading…</p>}
        {tab === "air" && air && (() => {
          const zone = airForm.zone || (air.fronts[0] ? `front:${air.fronts[0].id}` : "");
          const [kind, id] = zone.split(/:(.*)/s);
          const lost = Object.entries(air.losses).filter(([, count]) => count > 0);
          return (
            <>
              <div style={card}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>Air wings</div>
                <div style={small}>
                  <span>Free: </span>
                  <span data-no-translate="">{Object.entries(air.free).map(([template, count]) => `${templateName(template)} ${count}`).join(", ") || "—"}</span>
                </div>
                {lost.length > 0 && (
                  <div style={{ ...small, color: "#fca5a5" }}>
                    <span>Aircraft lost last turn: </span><span data-no-translate="">{lost.map(([item, count]) => `${item} ${Math.round(count)}`).join(", ")}</span>
                  </div>
                )}
                {air.fronts.length === 0 && air.states.length === 0 && <p style={small}>Open a front first: wings fly over a front or the states along it.</p>}
                {(air.fronts.length > 0 || air.states.length > 0) && (
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                    <input type="number" min={1} max={40} value={airForm.count} aria-label="Wings" style={{ ...select, width: "3.2rem" }}
                      onChange={(event) => setAirForm((form) => ({ ...form, count: Number(event.target.value) || 1 }))} />
                    <select value={airForm.template} style={select} aria-label="Wing type" onChange={(event) => setAirForm((form) => ({ ...form, template: event.target.value }))}>
                      <option value="chasse">Fighters: air superiority</option>
                      <option value="bombardement">Bombers: ground support</option>
                    </select>
                    <select value={zone} style={select} aria-label="Air zone" onChange={(event) => setAirForm((form) => ({ ...form, zone: event.target.value }))}>
                      {air.fronts.map((front) => <option key={front.id} value={`front:${front.id}`} data-no-translate="">{`Front → ${polity(front.enemy)}`}</option>)}
                      {air.states.map((state) => <option key={state.id} value={`state:${state.id}`} data-no-translate="">{place(state.name)}</option>)}
                    </select>
                    <button type="button" style={button()} disabled={pending || !zone}
                      onClick={() => runAir({ op: "assign", ...(kind === "front" ? { frontId: id } : { stateId: id }), mission: airForm.template === "bombardement" ? "support" : "superiority", template: airForm.template, count: airForm.count })}>Send</button>
                  </div>
                )}
              </div>
              {air.missions.map((mission) => (
                <div key={mission.id} style={{ ...card, alignItems: "center", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.75rem" }}>
                    <span>{mission.mission === "support" ? "Ground support" : "Air superiority"}</span>
                    <span data-no-translate="">{` · ${mission.wingIds.length} · ${mission.over.kind === "front" ? `Front → ${polity(mission.over.enemy)}` : place(mission.over.name)}`}</span>
                  </span>
                  <button type="button" style={button()} disabled={pending} onClick={() => runAir({ op: "recall", missionId: mission.id })}>Recall</button>
                </div>
              ))}
            </>
          );
        })()}

        {tab === "sea" && model && !sea && <p style={small}>{seas && !Object.keys(seas.zones ?? {}).length ? "This map has no sea zones." : "Loading…"}</p>}
        {tab === "sea" && sea && (() => {
          const zoneId = sea.zones.some((zone) => zone.zoneId === seaForm.zoneId) ? seaForm.zoneId : sea.zones[0]?.zoneId ?? "";
          const coast = sea.coasts.some((entry) => entry.id === landForm.stateId) ? landForm.stateId : sea.coasts[0]?.id ?? "";
          const controlText = (control) => (!control ? "" : control.contested ? " · contested" : ` · held by ${control.owners.map(polity).join(", ")}`);
          return (
            <>
              <div style={card}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>Fleets</div>
                <div style={small}><span>Free fleets: </span><span data-no-translate="">{sea.freeFleets}</span></div>
                {sea.zones.length === 0 && <p style={small}>No sea zone borders your coasts.</p>}
                {sea.zones.length > 0 && (
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                    <input type="number" min={1} max={40} value={seaForm.count} aria-label="Fleets" style={{ ...select, width: "3.2rem" }}
                      onChange={(event) => setSeaForm((form) => ({ ...form, count: Number(event.target.value) || 1 }))} />
                    <select value={seaForm.mission} style={select} aria-label="Naval mission" onChange={(event) => setSeaForm((form) => ({ ...form, mission: event.target.value }))}>
                      <option value="escort">Convoy escort</option>
                      <option value="blockade">Blockade</option>
                      <option value="support">Landing support</option>
                    </select>
                    <select value={zoneId} style={{ ...select, maxWidth: "11rem" }} aria-label="Sea zone" onChange={(event) => setSeaForm((form) => ({ ...form, zoneId: event.target.value }))}>
                      {sea.zones.map((zone) => <option key={zone.zoneId} value={zone.zoneId} data-no-translate="">{`${zone.zoneId} · ${place(zone.name)}${zone.enemy ? " ⚔" : ""}${controlText(zone.control)}`}</option>)}
                    </select>
                    <button type="button" style={button()} disabled={pending || !zoneId || !sea.freeFleets}
                      onClick={() => runSea({ op: "assign", zoneId, mission: seaForm.mission, count: seaForm.count })}>Send</button>
                  </div>
                )}
              </div>
              {sea.missions.map((mission) => (
                <div key={mission.id} style={{ ...card, alignItems: "center", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.75rem" }}>
                    <span>{NAVAL_LABELS[mission.mission] ?? mission.mission}</span>
                    <span data-no-translate="">{` · ${mission.fleetIds.length} · ${mission.zoneId} ${place(mission.name)}${controlText(mission.control)}`}</span>
                  </span>
                  <button type="button" style={button()} disabled={pending} onClick={() => runSea({ op: "recall", missionId: mission.id })}>Recall</button>
                </div>
              ))}
              {sea.blockades.map((blockade) => (
                <div key={`${blockade.owner}-${blockade.zoneId}`} style={{ ...card, color: blockade.against ? "#fca5a5" : "#86efac", fontSize: "0.74rem" }}>
                  <span>{blockade.against ? "Blockade against you" : "Your blockade holds"}</span>
                  <span data-no-translate="">{` · ${blockade.zoneId} ${place(blockade.name)} · ${blockade.states.length}`}</span>
                </div>
              ))}
              <div style={card}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.35rem" }}>Landing</div>
                <div style={small}><span>Free divisions on your coasts: </span><span data-no-translate="">{sea.onCoast}</span></div>
                {sea.coasts.length === 0 && <p style={small}>No enemy coast to land on.</p>}
                {sea.coasts.length > 0 && (
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                    <input type="number" min={1} max={6} value={landForm.count} aria-label="Divisions to land" style={{ ...select, width: "3.2rem" }}
                      onChange={(event) => setLandForm((form) => ({ ...form, count: Number(event.target.value) || 1 }))} />
                    <select value={coast} style={{ ...select, maxWidth: "12rem" }} aria-label="Coast" onChange={(event) => setLandForm((form) => ({ ...form, stateId: event.target.value }))}>
                      {sea.coasts.map((entry) => <option key={entry.id} value={entry.id} data-no-translate="">{`${place(entry.name)} (${polity(entry.owner)})`}</option>)}
                    </select>
                    <button type="button" style={button()} disabled={pending || !coast || !sea.onCoast}
                      onClick={() => runSea({ op: "land", stateId: coast, count: landForm.count })}>Prepare</button>
                  </div>
                )}
                {sea.landings.map((landing) => (
                  <div key={landing.id} style={{ ...small, marginTop: "0.3rem" }}>
                    <span>Embarked for next turn: </span><span data-no-translate="">{`${landing.divisionIds.length} → ${place(landing.stateName)}`}</span>
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {model && map && tab === "land" && (
          <div style={card}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>Open a front</div>
            {model.enemies.length === 0 && <p style={small}>You are at war with no one: declare a war first.</p>}
            {openable.length > 0 && (
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                <select value={chosenEnemy} onChange={(event) => setEnemy(event.target.value)} style={select} aria-label="Enemy">
                  {openable.map((entry) => <option key={entry.name} value={entry.name} data-no-translate="">{polity(entry.name)}</option>)}
                </select>
                {drawingFor === "new" ? (
                  <>
                    <span style={small}>{draw.sector.length} state(s) drawn</span>
                    <button type="button" style={button(true)} disabled={pending} onClick={() => { const sector = draw.sector; endDraw(); run({ op: "create", enemy: chosenEnemy, sector }); }}>Open on this line</button>
                    <button type="button" style={button()} onClick={endDraw}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" style={button()} disabled={pending} onClick={() => run({ op: "create", enemy: chosenEnemy })}>Whole border</button>
                    <button type="button" style={button()} onClick={() => beginDraw("new")}>Draw on the map</button>
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
                <span style={{ fontSize: "0.85rem", fontWeight: 700 }} data-no-translate="">{polity(front.owner)} → {polity(front.enemy)}</span>
                <span style={small}>{front.divisionIds.length} division(s)</span>
              </div>
              <div style={{ ...small, marginTop: "0.2rem" }}>
                <span>Line: </span><span data-no-translate="">{front.ownStates.map((s) => place(s.name)).join(", ") || "—"}</span>
              </div>
              <div style={{ ...small, marginTop: "0.15rem" }}>
                <span>Axis: </span><span data-no-translate="">{front.axis ? place(front.axisName || front.targets.find((t) => t.id === front.axis)?.name || "?") : "—"}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                {POSTURES.map(([value, label]) => (
                  <button key={value} type="button" style={button(front.posture === value)} disabled={pending || front.posture === value}
                    onClick={() => run({ op: "posture", frontId: front.id, posture: value })}>{label}</button>
                ))}
              </div>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                <span style={small}>Axis</span>
                <select value={front.axis} style={select} aria-label="Axis" disabled={pending}
                  onChange={(event) => run({ op: "posture", frontId: front.id, posture: front.posture, axis: event.target.value })}>
                  <option value="">—</option>
                  {front.targets.map((target) => <option key={target.id} value={target.id} data-no-translate="">{place(target.name)}</option>)}
                </select>
              </div>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.45rem" }}>
                <span style={small}>Send</span>
                <input type="number" min={1} max={60} value={pick.count} aria-label="Divisions"
                  onChange={(event) => setAssign((all) => ({ ...all, [front.id]: { ...pick, count: Number(event.target.value) || 1 } }))}
                  style={{ ...select, width: "3.5rem" }} />
                <select value={pick.template} style={select} aria-label="Template"
                  onChange={(event) => setAssign((all) => ({ ...all, [front.id]: { ...pick, template: event.target.value } }))}>
                  {Object.entries(model.free).map(([template, count]) => <option key={template} value={template}>{template} ({count} free)</option>)}
                </select>
                <button type="button" style={button()} disabled={pending || !Object.keys(model.free).length}
                  onClick={() => run({ op: "assign", frontId: front.id, count: pick.count, template: pick.template })}>Send</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                {drawingFor === front.id ? (
                  <>
                    <span style={small}>{draw.sector.length} state(s)</span>
                    <button type="button" style={button(true)} disabled={pending} onClick={() => { const sector = draw.sector; endDraw(); run({ op: "sector", frontId: front.id, sector }); }}>Save the line</button>
                    <button type="button" style={button()} onClick={endDraw}>Cancel</button>
                  </>
                ) : (
                  <button type="button" style={button()} onClick={() => beginDraw(front.id, front.sector)}>Redraw</button>
                )}
                <button type="button" style={button()} disabled={pending} onClick={() => run({ op: "disband", frontId: front.id })}>Close the front</button>
              </div>
              {!front.atWar && <div style={{ ...small, color: "#fca5a5", marginTop: "0.3rem" }}>No longer at war: it will close at the next turn.</div>}
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
