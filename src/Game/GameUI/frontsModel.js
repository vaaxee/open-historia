// Phase 7.7 — ce que le panneau Fronts montre et fait, sans React : les ennemis
// avec qui le joueur est en guerre, ses fronts (ligne, cibles, divisions), ses
// divisions libres par gabarit, et l'ordre qu'il donne, appliqué au monde par
// les mêmes règles que ceux des IA (runtime/hoi/fronts.js). Import-free.

import { applyFrontOp, frontLine, normalizeFronts } from "../../runtime/hoi/fronts.js";
import { templatesFor } from "../../runtime/hoi/armies.js";
import { atWar, enemiesOf, warsFor } from "../../runtime/worldmap/warRules.js";
import { buildWarMap } from "../../runtime/worldmap/warMap.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);

// La carte vue du panneau : les états du scénario (propriétaires, noms) et les
// données de ravitaillement (voisins), plus les occupations du monde.
export const panelMap = (world, { info = {}, stateOwners = {}, stateNames = {} } = {}) => buildWarMap({
  world,
  info,
  catalog: Object.entries(stateOwners ?? {}).map(([id, country]) => ({ id, country, name: stateNames?.[id] ?? id })),
});

const armyKeyOf = (world, polity) => Object.keys(world?.hoi?.armies ?? {}).find((name) => key(name) === key(polity)) ?? "";

// Le modèle du panneau pour le pays du joueur.
export const frontsPanelModel = (world, player, map) => {
  const owner = armyKeyOf(world, player);
  if (!owner) return null;
  const wars = warsFor(world);
  const templates = templatesFor(world.hoi.series);
  const fronts = normalizeFronts(world.hoi.fronts).filter((front) => key(front.owner) === key(owner));
  const enemies = enemiesOf(wars, owner).map((name) => ({ name, hasFront: fronts.some((front) => key(front.enemy) === key(name)) }));
  const army = world.hoi.armies[owner];
  const free = {};
  for (const division of list(army?.divisions)) {
    if (templates[division.template]?.kind !== "land" || division.frontId || division.encircledDays > 0) continue;
    free[division.template] = (free[division.template] ?? 0) + 1;
  }
  return {
    owner,
    enemies,
    free,
    fronts: fronts.map((front) => {
      const line = map ? frontLine(front, map) : { own: [], enemy: [], pairs: [] };
      return {
        ...front,
        atWar: atWar(wars, owner, front.enemy),
        ownStates: line.own.map((id) => ({ id, name: map?.nameOf(id) ?? id })),
        targets: line.enemy.map((id) => ({ id, name: map?.nameOf(id) ?? id })),
      };
    }),
  };
};

// Un ordre du joueur appliqué au monde : { world, note } (note.kind "dropped" si refusé).
export const applyPlayerFrontOp = (world, op, map) => {
  const wars = warsFor(world);
  const result = applyFrontOp(op, {
    armies: world?.hoi?.armies ?? {},
    fronts: world?.hoi?.fronts ?? [],
    atWar: (a, b) => atWar(wars, a, b),
    templates: templatesFor(world?.hoi?.series),
    date: clean(world?.hoi?.lastDate),
    map,
  });
  if (result.note.kind === "dropped") return { world, note: result.note };
  return { world: { ...world, hoi: { ...world.hoi, fronts: result.fronts, armies: result.armies } }, note: result.note };
};
