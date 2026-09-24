// Run: node --test src/runtime/hoi/buildings.test.js
//
// Ce que ces tests tiennent : un chantier coûte ce qu'il coûte et avance selon les
// usines civiles (plafond par chantier, part des biens de consommation), un
// bâtiment terminé change l'économie, un bâtiment abîmé produit moins puis plus du
// tout, les dégâts sont bornés et les réparations passent d'elles-mêmes, les
// structures racontées entrent en chantier, l'installation crée les complexes et
// type l'existant sans le compter deux fois, et un type verrouillé par l'arbre
// attend sa tech.

import test from "node:test";
import assert from "node:assert/strict";

import { advanceHoiLayer, createNation, enableHoiLayer, effectiveFactories } from "./engine.js";
import { applyEconomyOps, normalizeEconomyOp } from "./economyOps.js";
import {
  BUILDING_TUNING,
  HOI_BUILDING_TYPES,
  advanceConstruction,
  applyBuildingDamage,
  buildingContribution,
  buildingTypeFor,
  constructionCapacity,
  installBuildings,
  isBuildingTypeUnlocked,
  newBuildingMarker,
  normalizeBuilding,
  startConstruction,
  statusForBuilding,
  syncBuildingsWithMarkers,
} from "./buildings.js";

const site = (type, extra = {}) => ({
  id: extra.id ?? `m-${type}`,
  name: extra.name ?? `${type} test`,
  ownerCode: "Germany",
  lng: 7,
  lat: 51,
  ...newBuildingMarker({ type, name: extra.name ?? `${type} test`, ownerCode: "Germany", lng: 7, lat: 51, id: extra.id ?? `m-${type}` }),
  ...extra,
});

test("les types sont reconnus d'après le récit, en anglais comme en français", () => {
  assert.equal(buildingTypeFor("refinery", "Leuna works"), "raffinerie");
  assert.equal(buildingTypeFor("military base", "Station Radar Verdun"), "radar");
  assert.equal(buildingTypeFor("usine d'armement", ""), "usine_militaire");
  assert.equal(buildingTypeFor("factory", "Usine Renault"), "usine_civile");
  assert.equal(buildingTypeFor("naval base", "Brest"), "port");
  assert.equal(buildingTypeFor("airbase", ""), "aerodrome");
  assert.equal(buildingTypeFor("coal mine", ""), "mine");
  assert.equal(buildingTypeFor("embassy", "Ambassade de France"), null);
  assert.equal(buildingTypeFor("usine_militaire", ""), "usine_militaire", "l'identifiant lui-même");
});

test("la capacité de construction suit les usines civiles, moins les biens de consommation", () => {
  const capacity = constructionCapacity(30);
  assert.equal(capacity.perDay, 30 * (1 - BUILDING_TUNING.consumerGoodsShare) * BUILDING_TUNING.pointsPerFactoryPerDay);
  assert.equal(capacity.perProjectPerDay, BUILDING_TUNING.maxFactoriesPerProject * BUILDING_TUNING.pointsPerFactoryPerDay);
});

test("un chantier avance au plafond par chantier et se termine au bout de son coût", () => {
  const entry = { index: 0, marker: site("usine_militaire") };
  const cost = HOI_BUILDING_TYPES.usine_militaire.cost;
  const perProject = BUILDING_TUNING.maxFactoriesPerProject * BUILDING_TUNING.pointsPerFactoryPerDay;
  const days = Math.ceil(cost / perProject);
  const half = advanceConstruction([entry], [entry.marker.id], 30, { effectiveCivilian: 100 });
  assert.equal(half.owned[0].marker.building.construction.progress, perProject * 30, "plafonné à 15 usines, même avec 100");
  const done = advanceConstruction([entry], [entry.marker.id], days, { effectiveCivilian: 100 });
  assert.equal(done.owned[0].marker.building.level, 1);
  assert.equal(done.owned[0].marker.building.construction, undefined);
  assert.deepEqual(done.report.built, ["usine_militaire test"]);
  assert.deepEqual(done.queue, []);
});

test("sans usine civile, rien ne se construit", () => {
  const entry = { index: 0, marker: site("fort") };
  const result = advanceConstruction([entry], [entry.marker.id], 30, { effectiveCivilian: 0 });
  assert.equal(result.owned[0].marker.building.construction.progress, 0);
});

test("un bâtiment terminé change l'économie, au prorata de son état", () => {
  const full = normalizeBuilding({ type: "usine_militaire", level: 3, condition: 100 });
  assert.equal(buildingContribution(full).military, 3);
  assert.equal(buildingContribution({ ...full, condition: 60 }).military, 1.8);
  assert.equal(buildingContribution({ ...full, condition: 20 }).military, 0, "sous 25 %, plus rien");
  assert.deepEqual(buildingContribution(normalizeBuilding({ type: "raffinerie", level: 2 })).extraction, { petrole: 6 });
  assert.deepEqual(buildingContribution(normalizeBuilding({ type: "mine", level: 1, resource: "chrome" })).extraction, { chrome: 3 });
  assert.equal(buildingContribution(normalizeBuilding({ type: "usine_civile", level: 2, legacy: true })).civilian, 0, "déjà compté");
});

test("les dégâts sont bornés, l'état affiché suit, et les réparations passent d'elles-mêmes, avant la file", () => {
  const markers = [{ ...site("usine_militaire"), building: normalizeBuilding({ type: "usine_militaire", level: 2 }) }];
  const hit = applyBuildingDamage(markers, [{ target: "USINE_MILITAIRE TEST", value: 5 }], { title: "Raid" });
  assert.equal(hit.markers[0].building.condition, 50, "au plus 50 % d'un coup");
  assert.equal(hit.markers[0].status, "damaged");
  assert.deepEqual(hit.notes.map((note) => note.kind), ["adjusted"]);
  const twice = applyBuildingDamage(hit.markers, [{ target: "usine_militaire test", value: 0.5 }]).markers;
  assert.equal(twice[0].building.condition, 0);
  assert.equal(statusForBuilding(twice[0].building), "destroyed");
  assert.match(applyBuildingDamage(markers, [{ target: "Fantôme" }]).notes[0].text, /no building named "Fantôme"/);

  const queued = { index: 1, marker: site("fort") };
  const repaired = advanceConstruction([{ index: 0, marker: hit.markers[0] }, queued], [queued.marker.id], 30, { effectiveCivilian: 18 });
  assert.ok(repaired.owned[0].marker.building.condition > 50, "la réparation a avancé");
  assert.equal(repaired.owned[1].marker.building.construction.progress, 0, "18 usines × 0,8 = 72 points/jour, tous pris par la réparation");
});

test("un chantier se lance sur un bâtiment existant, jamais au-delà du niveau maximal", () => {
  const level4 = normalizeBuilding({ type: "port", level: 4 });
  const started = startConstruction(level4);
  assert.equal(started.building.construction.targetLevel, 5);
  assert.equal(startConstruction({ ...level4, level: 5 }).error, "max-level");
  assert.equal(startConstruction(normalizeBuilding({ type: "complexe_industriel", capacity: { civilian: 5 } })).error, "not-upgradable");
  assert.equal(startConstruction(started.building).error, "already-building");
});

test("une structure racontée après l'installation devient un chantier de son propriétaire", () => {
  const markers = [
    { id: "a", name: "Raffinerie de Leuna", kind: "refinery", ownerCode: "germany", lng: 12, lat: 51.3, status: "active" },
    { id: "b", name: "Ambassade", kind: "embassy", ownerCode: "Germany", lng: 13, lat: 52, status: "active" },
    { id: "c", name: "Usine inconnue", kind: "factory", ownerCode: "Atlantis", lng: 0.5, lat: 0.5, status: "active" },
  ];
  const synced = syncBuildingsWithMarkers(markers, { resolveNation: (owner) => (owner.toLowerCase() === "germany" ? "Germany" : null), queues: { Germany: [] } });
  assert.equal(synced.markers[0].building.type, "raffinerie");
  assert.equal(synced.markers[0].building.level, 0);
  assert.equal(synced.markers[0].status, "under_construction");
  assert.deepEqual(synced.queues.Germany, ["a"]);
  assert.equal(synced.markers[1].building, undefined, "une ambassade reste une structure");
  assert.equal(synced.markers[2].building, undefined, "pas de propriétaire suivi, pas de chantier");
});

test("un état posé par le récit devient un état chiffré", () => {
  const building = normalizeBuilding({ type: "radar", level: 1 });
  const synced = syncBuildingsWithMarkers([
    { id: "r1", name: "Radar 1", status: "damaged", building },
    { id: "r2", name: "Radar 2", status: "destroyed", building },
  ], { resolveNation: () => "France" });
  assert.equal(synced.markers[0].building.condition, BUILDING_TUNING.narratedDamageCondition);
  assert.equal(synced.markers[1].building.condition, 0);
});

test("l'installation crée les complexes dans les grandes villes et type l'existant sans le recompter", () => {
  const nations = {
    Germany: createNation({ factories: { civilian: 30, military: 14 } }),
    Luxembourg: createNation({ factories: { civilian: 3, military: 1 } }),
  };
  const markers = [{ id: "p", name: "Kiel", kind: "naval base", ownerCode: "Germany", lng: 10.1, lat: 54.3, status: "active" }];
  const cities = {
    Germany: [
      { name: "Hamburg", coordinates: [10, 53.5], population: 1700000 },
      { name: "Berlin", coordinates: [13.4, 52.5], population: 4200000 },
      { name: "Munich", coordinates: [11.6, 48.1], population: 800000 },
      { name: "Essen", coordinates: [7, 51.4], population: 650000 },
      { name: "Dresden", coordinates: [13.7, 51], population: 630000 },
    ],
  };
  const result = installBuildings(markers, nations, {
    citiesOf: (key) => cities[key] ?? [],
    resolveNation: (owner) => (owner === "Germany" ? "Germany" : null),
    date: "1936-01-01",
    makeId: (key, index) => `${key}-${index}`,
  });
  const complexes = result.markers.filter((marker) => marker.building?.type === "complexe_industriel");
  assert.equal(complexes.length, 4, "44 usines, 12 par ville, 4 villes au plus");
  assert.equal(complexes[0].name, "Complexe industriel de Berlin", "la plus grande ville d'abord");
  const civilian = complexes.reduce((sum, marker) => sum + marker.building.capacity.civilian, 0);
  const military = complexes.reduce((sum, marker) => sum + marker.building.capacity.military, 0);
  assert.deepEqual([civilian, military], [30, 14], "aucune usine perdue ni ajoutée");
  assert.deepEqual(result.nations.Germany.factories, { civilian: 0, military: 0 });
  assert.deepEqual(result.nations.Luxembourg.factories, { civilian: 3, military: 1 }, "un petit pays garde ses usines abstraites");
  const kiel = result.markers.find((marker) => marker.id === "p");
  assert.equal(kiel.building.type, "port");
  assert.equal(kiel.building.legacy, true);
});

test("un pays sans ville connue garde ses usines abstraites", () => {
  const nations = { Germany: createNation({ factories: { civilian: 30, military: 14 } }) };
  const result = installBuildings([], nations, { citiesOf: () => [], resolveNation: () => "Germany", makeId: () => "x" });
  assert.equal(result.complexes, 0);
  assert.deepEqual(result.nations.Germany.factories, { civilian: 30, military: 14 });
});

test("un type réservé par l'arbre attend sa tech", () => {
  const tree = { techs: [{ id: "synth", effects: [{ type: "building", building: "raffinerie_synthetique" }] }] };
  assert.equal(isBuildingTypeUnlocked("raffinerie_synthetique", { research: { done: [] } }, tree), false);
  assert.equal(isBuildingTypeUnlocked("raffinerie_synthetique", { research: { done: ["synth"] } }, tree), true);
  assert.equal(isBuildingTypeUnlocked("usine_militaire", { research: { done: [] } }, tree), true);
});

test("dans le saut : les complexes font tourner l'économie, le joueur ne choisit pas de chantier à sa place", () => {
  const world = enableHoiLayer({
    markers: [
      { id: "cx", name: "Complexe industriel de Berlin", ownerCode: "Germany", lng: 13.5, lat: 52.5, status: "active", building: normalizeBuilding({ type: "complexe_industriel", capacity: { civilian: 20, military: 8 } }) },
      { id: "u1", name: "Usine d'Essen", ownerCode: "Germany", lng: 7, lat: 51.4, status: "active", building: normalizeBuilding({ type: "usine_militaire", level: 1 }) },
      { id: "u2", name: "Usine de Lille", ownerCode: "France", lng: 3, lat: 50.6, status: "active", building: normalizeBuilding({ type: "usine_militaire", level: 1 }) },
      { id: "cf", name: "Complexe industriel de Paris", ownerCode: "France", lng: 2.4, lat: 48.9, status: "active", building: normalizeBuilding({ type: "complexe_industriel", capacity: { civilian: 20, military: 8 } }) },
    ],
  }, {
    startDate: "1936-01-01",
    nations: {
      Germany: createNation({ factories: { civilian: 0, military: 0 }, stocks: { acier: 500 }, lines: [{ id: "fusils", equipment: "fusils", factories: 9, efficiency: 0.5, unitCost: 0.5, resources: { acier: 1 } }] }),
      France: createNation({ factories: { civilian: 0, military: 0 } }),
    },
  });
  world.hoi.buildingsInstalled = true;
  const next = advanceHoiLayer(world, { fromDate: "1936-01-01", toDate: "1936-03-01", player: "Germany" });
  const germany = next.hoi.nations.Germany;
  assert.deepEqual(effectiveFactories(germany), { civilian: 20, military: 9 });
  assert.ok(next.hoi.lastReport.nations.Germany.produced.fusils > 0, "les lignes tournent sur les usines des bâtiments");
  assert.equal(next.markers.find((m) => m.id === "u1").building.construction, undefined, "le joueur choisit ses chantiers");
  assert.ok(next.markers.find((m) => m.id === "u2").building.construction || next.markers.find((m) => m.id === "u2").building.level === 2,
    "la France, gérée par le moteur, agrandit son usine");
});

test("economyOps : damage est reconnu, mais laissé à la carte", () => {
  assert.deepEqual(normalizeEconomyOp({ op: "bombing", target: "Usine d'Essen", value: 0.3 }), { op: "damage", target: "Usine d'Essen", value: 0.3 });
  const result = applyEconomyOps({ nations: { Germany: createNation({}) } }, [{ op: "damage", target: "Usine d'Essen" }]);
  assert.equal(result.applied, 0);
  assert.deepEqual(result.notes, []);
});
