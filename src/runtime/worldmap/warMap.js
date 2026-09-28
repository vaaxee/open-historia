// Phase 7 — la carte telle que les armées la voient, pour les fronts (7.3), le
// combat (7.4) et le ravitaillement (7.2) : qui tient chaque état (le
// catalogue, puis les occupations et les transferts), qui en est souverain, ses
// voisins, ce qu'il est (terrain, rail, côte, fleuves ; supply-<scenario>.json),
// son nom et sa latitude. Import-free, pour les tests.

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// catalog : [{ id, country, name, adjacencies, lat, lng }] ; info : { [id]: { terrain, rail, coastal, neighbours, riverNeighbours } }
export const buildWarMap = ({ world = {}, catalog = [], info = {} } = {}) => {
  const byId = new Map(list(catalog).map((row) => [clean(row?.id), row]));
  const overrides = world?.regionOwnershipOverrides ?? {};
  const sovereignty = world?.regionSovereigntyOverrides ?? {};
  const states = Object.keys(info ?? {}).length ? Object.keys(info) : [...byId.keys()];
  return {
    states,
    controllerOf: (id) => clean(overrides[id]) || clean(byId.get(id)?.country),
    sovereignOf: (id) => clean(sovereignty[id]) || clean(overrides[id]) || clean(byId.get(id)?.country),
    neighboursOf: (id) => (Array.isArray(info?.[id]?.neighbours) ? info[id].neighbours : list(byId.get(id)?.adjacencies)),
    riverBetween: (a, b) => list(info?.[b]?.riverNeighbours).includes(a) || list(info?.[a]?.riverNeighbours).includes(b),
    infoOf: (id) => info?.[id] ?? {},
    nameOf: (id) => clean(byId.get(id)?.name) || id,
    latOf: (id) => (Number.isFinite(Number(info?.[id]?.lat)) ? Number(info[id].lat) : Number(byId.get(id)?.lat)),
    lngOf: (id) => (Number.isFinite(Number(info?.[id]?.lng)) ? Number(info[id].lng) : Number(byId.get(id)?.lng)),
  };
};
