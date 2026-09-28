// Phase 7.6 — ce que la carte mondiale dessine des armées, en GeoJSON.
//
// Import-free, pour les tests : les pions (les divisions d'un pays dans un état,
// empilées), les fronts (un trait sur chaque frontière de contact, et des
// flèches d'attaque, l'axe en gras), et les lieux des dernières batailles.
// `centers` : { [stateId]: [lng, lat] } (supply-<scenario>.json).

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);
const round5 = (value) => Math.round(value * 1e5) / 1e5;

const point = (coordinates, properties) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates } });
const line = (coordinates, properties) => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates } });

// Les pions : une entité par (état, pays), avec le nombre de divisions et leur
// force moyenne ; plusieurs pays dans un même état sont décalés côte à côte.
export const armyStackFeatures = (armies, centers, { strengthOf = () => 1, colourOf = () => "#888" } = {}) => {
  const stacks = new Map();
  for (const [owner, army] of Object.entries(armies ?? {})) {
    for (const division of list(army?.divisions)) {
      const stateId = clean(division.stateId);
      if (!stateId || !centers?.[stateId]) continue;
      const id = `${stateId}|${owner}`;
      const stack = stacks.get(id) ?? { stateId, owner, count: 0, strength: 0, onFront: 0 };
      stack.count += 1;
      stack.strength += strengthOf(division);
      if (division.frontId) stack.onFront += 1;
      stacks.set(id, stack);
    }
  }
  const byState = new Map();
  for (const stack of stacks.values()) byState.set(stack.stateId, [...(byState.get(stack.stateId) ?? []), stack]);
  const features = [];
  for (const [stateId, group] of byState) {
    const [lng, lat] = centers[stateId];
    group.sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
    group.forEach((stack, index) => {
      const offset = (index - (group.length - 1) / 2) * 0.6;
      features.push(point([round5(lng + offset), round5(lat)], {
        stateId,
        owner: stack.owner,
        count: stack.count,
        label: String(stack.count),
        strength: Math.round((stack.strength / stack.count) * 100) / 100,
        onFront: stack.onFront,
        colour: colourOf(stack.owner),
      }));
    });
  }
  return { type: "FeatureCollection", features };
};

// Les fronts : pour chaque paire d'états au contact (le pays / l'ennemi), un
// trait au milieu, perpendiculaire à la paire (la frontière) ; pour un front qui
// attaque ou perce, une flèche vers chaque cible (l'axe marqué).
//   ownerOf(stateId) : qui tient l'état ; neighboursOf(stateId) : ses voisins.
export const frontFeatures = (fronts, { centers, ownerOf, neighboursOf, colourOf = () => "#c00" } = {}) => {
  const features = [];
  for (const front of list(fronts)) {
    const sector = new Set(list(front.sector));
    const targets = new Set();
    for (const [stateId, center] of Object.entries(centers ?? {})) {
      if (key(ownerOf(stateId)) !== key(front.owner)) continue;
      if (sector.size && !sector.has(stateId)) continue;
      for (const next of list(neighboursOf(stateId))) {
        if (key(ownerOf(next)) !== key(front.enemy) || !centers[next]) continue;
        const [x1, y1] = center; const [x2, y2] = centers[next];
        const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
        const dx = x2 - x1; const dy = y2 - y1;
        const length = Math.hypot(dx, dy) || 1;
        const half = Math.min(1.2, length * 0.3);
        const nx = (-dy / length) * half; const ny = (dx / length) * half;
        features.push(line([[round5(mx - nx), round5(my - ny)], [round5(mx + nx), round5(my + ny)]], {
          kind: "front", frontId: front.id, owner: front.owner, posture: front.posture, colour: colourOf(front.owner),
        }));
        if (front.posture !== "hold" && !targets.has(next)) {
          targets.add(next);
          const axis = front.axis === next;
          features.push(line([[round5(x1 + dx * 0.15), round5(y1 + dy * 0.15)], [round5(x1 + dx * 0.85), round5(y1 + dy * 0.85)]], {
            kind: "arrow", frontId: front.id, owner: front.owner, posture: front.posture, axis, colour: colourOf(front.owner),
          }));
        }
      }
    }
  }
  return { type: "FeatureCollection", features };
};

const RESULT_MARKS = Object.freeze({ captured: "⚔ ✓", stalemate: "⚔ =", repelled: "⚔ ✗" });

// Les batailles du dernier tour, là où elles ont eu lieu.
export const battleFeatures = (battles, centers) => ({
  type: "FeatureCollection",
  features: list(battles)
    .filter((battle) => centers?.[battle.stateId])
    .map((battle) => point(centers[battle.stateId], {
      battleId: battle.id,
      result: battle.result,
      label: `${RESULT_MARKS[battle.result] ?? "⚔"} ${battle.stateName}`,
    })),
});
