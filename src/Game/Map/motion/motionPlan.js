// Phase 9 — le motion design de la carte, en plans purs (testables sans carte).
//
// Le moteur d'animation (motionEngine.js) ne fait qu'exécuter ces plans avec les
// transitions de MapLibre (feature-state, propriétés de peinture) :
//   - prise ou occupation : la couleur du vainqueur se répand depuis l'état voisin
//     qu'il tenait (ordre de propagation par les limites entre provinces), puis
//     les hachures apparaissent ;
//   - annexion ou traité : fondu de couleur, et la frontière redessinée d'un trait
//     qui avance ;
//   - bataille : pulsation sur le lieu, puis un éclair selon le résultat ;
//   - fronts : flèches animées vers l'axe, ligne qui ondule selon la posture ;
//   - divisions : pions qui glissent d'un état à l'autre ;
//   - blocus : onde sur la zone de mer ; flottes qui dérivent ;
//   - capitulation : le pays se désature, puis un tampon « Capitulation » ;
//   - après un tour : la caméra survole les changements, dans l'ordre des événements.
// Réglage « Animations » : complètes, réduites (plus courtes, sans ambiance ni
// survol), désactivées (tout est posé d'un coup).

export const MOTION_LEVELS = Object.freeze(["full", "reduced", "off"]);

export const MOTION_TIMINGS = Object.freeze({
  full: Object.freeze({ spreadStep: 90, spreadFade: 500, hatchFade: 600, annexFade: 900, borderDraw: 1200, battlePulse: 1400, battleFlash: 500, glide: 900, stamp: 2600, desaturate: 1200, tourStop: 2200, ambient: true, tour: true }),
  reduced: Object.freeze({ spreadStep: 30, spreadFade: 250, hatchFade: 250, annexFade: 400, borderDraw: 500, battlePulse: 500, battleFlash: 250, glide: 350, stamp: 1500, desaturate: 500, tourStop: 0, ambient: false, tour: false }),
  off: Object.freeze({ spreadStep: 0, spreadFade: 0, hatchFade: 0, annexFade: 0, borderDraw: 0, battlePulse: 0, battleFlash: 0, glide: 0, stamp: 0, desaturate: 0, tourStop: 0, ambient: false, tour: false }),
});

export const normalizeMotionLevel = (value) => (MOTION_LEVELS.includes(value) ? value : "full");
export const motionTimings = (level) => MOTION_TIMINGS[normalizeMotionLevel(level)];

const list = (value) => (Array.isArray(value) ? value : []);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Les provinces voisines, d'après les limites de la carte ([id, a, b], 0 = la mer).
export const adjacencyFromArcs = (arcs) => {
  const out = new Map();
  for (const [, a, b] of list(arcs)) {
    if (!a || !b || a === b) continue;
    if (!out.has(a)) out.set(a, new Set());
    if (!out.has(b)) out.set(b, new Set());
    out.get(a).add(b);
    out.get(b).add(a);
  }
  return out;
};

// L'ordre dans lequel la couleur du vainqueur gagne les provinces prises : en
// largeur depuis celles qui touchent une province qu'il tenait déjà (l'état
// voisin) ; sans voisin à lui (un débarquement), toutes partent ensemble.
// `changed` : ids ; `newOwnerOf(id)`, `oldOwnerOf(id)`. Renvoie Map id → rang.
export const spreadOrder = (changed, { adjacency, newOwnerOf, oldOwnerOf }) => {
  const set = new Set(changed);
  const rank = new Map();
  let wave = [];
  for (const id of changed) {
    const owner = newOwnerOf(id);
    const touches = [...(adjacency.get(id) ?? [])].some((next) => !set.has(next) && oldOwnerOf(next) === owner);
    if (touches) { rank.set(id, 0); wave.push(id); }
  }
  if (!wave.length) {
    for (const id of changed) rank.set(id, 0);
    return rank;
  }
  let step = 0;
  while (wave.length) {
    step += 1;
    const next = [];
    for (const id of wave) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (!set.has(neighbour) || rank.has(neighbour)) continue;
        rank.set(neighbour, step);
        next.push(neighbour);
      }
    }
    wave = next;
  }
  // Ce que la propagation n'atteint pas (une île) part en dernier.
  for (const id of changed) if (!rank.has(id)) rank.set(id, step);
  return rank;
};

// Les changements de mains d'un tour, classés : une prise (le contrôle change,
// la souveraineté non) ou une annexion (les deux). `before`/`after` :
// { owners: [propriétaire par province], sovereign: [souverain par province] }.
export const classifyOwnerChanges = (before, after) => {
  const captures = [];
  const annexations = [];
  const n = Math.max(list(before.owners).length, list(after.owners).length);
  for (let i = 0; i < n; i += 1) {
    const from = before.owners?.[i] ?? ""; const to = after.owners?.[i] ?? "";
    if (from === to) continue;
    const id = i + 1;
    const sovereignChanged = (before.sovereign?.[i] ?? from) !== (after.sovereign?.[i] ?? to);
    (sovereignChanged ? annexations : captures).push(id);
  }
  return { captures, annexations };
};

// La valeur d'une animation au temps `elapsed` : 0 avant `delay`, 1 après
// `delay + duration`, adoucie entre les deux.
export const easeAt = (elapsed, delay = 0, duration = 0) => {
  if (duration <= 0) return elapsed >= delay ? 1 : 0;
  const t = clamp((elapsed - delay) / duration, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
};

// La pulsation d'une bataille : un rayon et une opacité, trois battements, puis
// l'éclair de la couleur du résultat.
export const RESULT_FLASH = Object.freeze({ captured: "#ef4444", stalemate: "#e5e7eb", repelled: "#60a5fa" });
export const battlePulseAt = (elapsed, { pulse, flash }) => {
  if (elapsed < pulse) {
    const phase = (elapsed / pulse) * 3 * Math.PI * 2;
    return { radius: 10 + 8 * (0.5 + 0.5 * Math.sin(phase - Math.PI / 2)), opacity: 0.55, flash: 0 };
  }
  if (elapsed < pulse + flash) {
    const t = (elapsed - pulse) / Math.max(1, flash);
    return { radius: 18 + 22 * t, opacity: 0.9 * (1 - t), flash: 1 };
  }
  return { radius: 0, opacity: 0, flash: 0 };
};

// La position d'un pion qui glisse de `from` à `to` ([lng, lat]).
export const glideAt = (from, to, progress) => {
  const t = easeAt(progress, 0, 1);
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
};

// Les pions qui changent d'état entre deux tours, regroupés (pays, départ,
// arrivée, nombre). `centers` : { stateId: [lng, lat] }.
export const divisionMoves = (beforeArmies, afterArmies, centers) => {
  const where = new Map();
  for (const [owner, army] of Object.entries(beforeArmies ?? {})) for (const division of list(army?.divisions)) where.set(division.id, { owner, stateId: division.stateId });
  const moves = new Map();
  for (const [owner, army] of Object.entries(afterArmies ?? {})) {
    for (const division of list(army?.divisions)) {
      const was = where.get(division.id);
      if (!was || was.stateId === division.stateId || !centers?.[was.stateId] || !centers?.[division.stateId]) continue;
      const key = `${owner}|${was.stateId}|${division.stateId}`;
      const entry = moves.get(key) ?? { owner, from: was.stateId, to: division.stateId, count: 0 };
      entry.count += 1;
      moves.set(key, entry);
    }
  }
  return [...moves.values()];
};

// La suite de tirets d'une ligne animée (l'astuce « ant path » de MapLibre) :
// `steps` motifs qui, pris dans l'ordre, font avancer les tirets.
export const dashSequence = (dash = 3, gap = 3, steps = 12) => {
  const period = dash + gap;
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const offset = (i / steps) * period;
    if (offset <= gap) out.push([0, offset, dash, gap - offset]);
    else out.push([offset - gap, gap, period - offset, 0].map((value) => Math.max(0, value)));
  }
  return out.map((pattern) => pattern.map((value) => Math.round(value * 100) / 100));
};
// La vitesse d'ondulation d'un front selon sa posture (millisecondes par pas).
export const FRONT_DASH_SPEED = Object.freeze({ hold: 0, attack: 110, breakthrough: 55 });

// Le survol après un tour : les lieux à survoler, dans l'ordre des événements
// (la date, puis l'ordre dans le tour), sans doublon. Chaque étape : { lng, lat,
// zoom, label, kind }. `events` : les événements du tour ; `centers` : les états.
export const tourStops = (events, centers, { max = 8 } = {}) => {
  const stops = [];
  const seen = new Set();
  list(events).forEach((event, index) => {
    const ids = [
      ...list(event?.impacts?.regionControlOps).map((op) => op?.regionId),
      ...list(event?.impacts?.regionTransfers).map((op) => op?.regionId),
      event?.battle?.stateId,
    ].filter(Boolean);
    const id = ids.find((entry) => centers?.[entry] && !seen.has(entry));
    if (!id) return;
    seen.add(id);
    stops.push({ order: index, date: String(event?.date ?? ""), lng: centers[id][0], lat: centers[id][1], zoom: 5, label: String(event?.title ?? ""), kind: event?.battle ? "battle" : "change" });
  });
  return stops.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).slice(0, max);
};

// Une couleur désaturée (capitulation) : la même, grisée à `amount`.
export const desaturate = (colour, amount = 0.85) => {
  const m = String(colour ?? "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  let rgb = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  if (!rgb && /^#[0-9a-f]{6}$/i.test(String(colour))) rgb = [1, 3, 5].map((i) => parseInt(String(colour).slice(i, i + 2), 16));
  if (!rgb) return colour;
  const grey = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
  const mixed = rgb.map((value) => Math.round(value + (grey - value) * amount));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
};

// Un point est-il à l'écran ? `bounds` : [[ouest, sud], [est, nord]].
export const onScreen = (point, bounds, margin = 0.5) => {
  if (!bounds || !point) return false;
  const [[west, south], [east, north]] = bounds;
  return point[1] >= south - margin && point[1] <= north + margin
    && (west <= east ? point[0] >= west - margin && point[0] <= east + margin : point[0] >= west - margin || point[0] <= east + margin);
};

// Les images par seconde sur une fenêtre de temps : { fps, min, frames }.
export const fpsFrom = (timestamps) => {
  const times = list(timestamps);
  if (times.length < 2) return { fps: 0, min: 0, frames: times.length };
  const span = times[times.length - 1] - times[0];
  let worst = 0;
  for (let i = 1; i < times.length; i += 1) worst = Math.max(worst, times[i] - times[i - 1]);
  return { fps: Math.round(((times.length - 1) / span) * 1000), min: worst > 0 ? Math.round(1000 / worst) : 0, frames: times.length };
};
