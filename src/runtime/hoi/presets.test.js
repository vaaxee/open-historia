// Run: node --test src/runtime/hoi/presets.test.js
//
// Runs without node_modules: presets.js only imports engine.js.
//
// Ce que ces tests tiennent : chaque série détaillée passe par normalizeNation sans
// rien perdre, chaque ligne vise un équipement du catalogue, la bonne série est
// choisie d'après la date, et tous les pays d'une carte reçoivent une économie.

import test from "node:test";
import assert from "node:assert/strict";

import { advanceNation, normalizeNation } from "./engine.js";
import {
  HOI_EQUIPMENT,
  HOI_NEUTRAL_NATION,
  HOI_SERIES,
  buildPresetNation,
  enableHoiLayerFromPresets,
  findPresetNation,
  listWorldPolities,
  pickHoiSeries,
} from "./presets.js";

test("chaque pays détaillé survit à la normalisation sans rien perdre", () => {
  for (const series of Object.values(HOI_SERIES)) {
    for (const { aliases, data } of series.nations) {
      const nation = buildPresetNation(series.id, aliases[0]);
      assert.deepEqual(nation.factories, data.factories, `${series.id} ${aliases[0]} : usines`);
      assert.deepEqual(nation.stocks, data.stocks, `${series.id} ${aliases[0]} : stocks`);
      assert.deepEqual(nation.extraction, data.extraction, `${series.id} ${aliases[0]} : extraction`);
      assert.equal(nation.lines.length, data.lines.length, `${series.id} ${aliases[0]} : lignes`);
      assert.deepEqual(normalizeNation(nation), nation, "déjà normalisée");
    }
  }
});

test("chaque ligne vise un équipement du catalogue et tient dans les usines militaires", () => {
  for (const series of Object.values(HOI_SERIES)) {
    for (const { aliases, data } of series.nations) {
      const used = data.lines.reduce((sum, line) => sum + line.factories, 0);
      assert.ok(used <= data.factories.military, `${series.id} ${aliases[0]} : ${used} > ${data.factories.military}`);
      for (const line of data.lines) assert.ok(HOI_EQUIPMENT[line.equipment], line.equipment);
    }
  }
});

test("la série suit la date de départ", () => {
  assert.equal(pickHoiSeries("1936-01-01"), "1936");
  assert.equal(pickHoiSeries("1911-10-08"), "1912");
  assert.equal(pickHoiSeries("1914-07-28"), "1912");
  assert.equal(pickHoiSeries("2014-01-01"), null);
  assert.equal(pickHoiSeries("pas une date"), null);
});

test("les pays sont reconnus par leur nom sur la carte ou un alias, sans tenir compte de la casse", () => {
  assert.ok(findPresetNation("1936", "Germany"));
  assert.ok(findPresetNation("1936", "imperialist japan"));
  assert.ok(findPresetNation("1912", "Austrian Empire"));
  assert.ok(findPresetNation("1912", "French Republic"));
  assert.equal(findPresetNation("1936", "Luxembourg"), null);
  assert.equal(findPresetNation(null, "Germany"), null);
});

test("un pays absent de la série reçoit la base neutre", () => {
  const nation = buildPresetNation("1936", "Luxembourg");
  assert.deepEqual(nation.factories, HOI_NEUTRAL_NATION.factories);
  assert.equal(nation.lines.length, 1);
  const { report } = advanceNation(nation, 30);
  assert.ok((report.produced.fusils ?? 0) > 0, "la base neutre produit quelque chose");
});

test("l'activation couvre tous les pays de la carte et dit ce qu'elle a fait", () => {
  const world = {
    ownerCodes: ["Germany", "France", "Luxembourg", "Soviet Union"],
    polityOverrides: { "Free Danzig": { name: "Free Danzig" } },
    units: [],
  };
  const result = enableHoiLayerFromPresets(world, { startDate: "1936-01-01" });
  assert.equal(result.series, "1936");
  assert.deepEqual(result.detailed.sort(), ["France", "Germany", "Soviet Union"]);
  assert.equal(result.neutral, 2);
  assert.deepEqual(Object.keys(result.world.hoi.nations).sort(), ["France", "Free Danzig", "Germany", "Luxembourg", "Soviet Union"]);
  assert.equal(result.world.hoi.series, "1936");
  assert.equal(result.world.hoi.lastDate, "1936-01-01");
  assert.deepEqual(result.world.units, [], "le reste du monde est conservé");
  assert.equal(world.hoi, undefined, "le monde d'origine n'est pas modifié");
});

test("une date hors séries donne la base neutre partout", () => {
  const result = enableHoiLayerFromPresets({ ownerCodes: ["Canada", "France"] }, { startDate: "2014-01-01" });
  assert.equal(result.series, null);
  assert.deepEqual(result.detailed, []);
  assert.equal(result.neutral, 2);
});

test("la liste des pays est dédoublonnée et triée", () => {
  assert.deepEqual(
    listWorldPolities({ ownerCodes: ["b", "a", "b", " "], polityOverrides: { a: {}, c: {} } }),
    ["a", "b", "c"],
  );
  assert.deepEqual(listWorldPolities({}), []);
});
