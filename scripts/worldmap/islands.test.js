import assert from "node:assert/strict";
import test from "node:test";
import { FLAGS_1936 } from "./flags-1936.mjs";
import { ISLANDS, tidyName } from "./islands.mjs";

test("les noms d'archipels de Natural Earth sont remis en forme", () => {
  assert.equal(tidyName("BRITISH ISLES"), "British Isles");
  assert.equal(tidyName("Shetland Is."), "Shetland Islands");
  assert.equal(tidyName("AÇORES"), "Açores");
  assert.equal(tidyName("Sylt"), "Sylt");
});

test("la liste des îles : un nom et un point sur terre ferme par île, sans doublon", () => {
  const names = ISLANDS.map(([name]) => name);
  assert.equal(new Set(names).size, names.length);
  for (const [name, lng, lat] of ISLANDS) {
    assert.ok(name.trim(), "nom vide");
    assert.ok(lng >= -180 && lng <= 180 && lat >= -58 && lat <= 84, `${name} hors de la carte`);
  }
  for (const island of ["Bornholm", "Sylt", "Pantelleria", "Madeira", "Elba", "Djerba"]) assert.ok(names.includes(island), island);
});

test("les drapeaux de 1936 sont des images PNG en adresse data:", () => {
  for (const owner of ["Free City of Danzig", "Tangier International Zone"]) {
    const url = FLAGS_1936[owner];
    assert.match(url, /^data:image\/png;base64,/);
    const bytes = Buffer.from(url.split(",")[1], "base64");
    assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.equal(bytes.readUInt32BE(16), 120);
    assert.equal(bytes.readUInt32BE(20), 80);
  }
});
