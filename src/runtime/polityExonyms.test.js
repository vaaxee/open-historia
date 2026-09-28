import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { EXONYMS, canonicalizePayloadPolityNames, createPolityNameTranslator } from "./polityExonyms.js";

// The polities of the WW2+ 1936 scenario that the field report involved.
const world = {
  polityOverrides: {
    Lithuania: { name: "Lithuania", aliases: ["Lithuania"] },
    Poland: { name: "Poland", aliases: [] },
    "Soviet Union": { name: "Soviet Union", aliases: [] },
    "United Kingdom": { name: "United Kingdom", aliases: [] },
    France: { name: "France", aliases: [] },
    Finland: { name: "Finland", aliases: [] },
    "Imperialist Japan": { name: "Imperialist Japan", aliases: [] },
    "Kuomintang China": { name: "Kuomintang China", aliases: [] },
    "Free City of Danzig": { name: "Free City of Danzig", aliases: ["Danzig"] },
  },
  regionOwnershipOverrides: { "imp-rgb-0066DD": "Poland", "imp-rgb-BB33CC": "Lithuania" },
};

test("a polity named in French, German or Spanish is read as the map's exact name", () => {
  const translate = createPolityNameTranslator(world);
  assert.equal(translate("Lituanie"), "Lithuania");
  assert.equal(translate("Royaume-Uni"), "United Kingdom");
  assert.equal(translate("royaume uni"), "United Kingdom");
  assert.equal(translate("Union soviétique"), "Soviet Union");
  assert.equal(translate("URSS"), "Soviet Union");
  assert.equal(translate("Litauen"), "Lithuania");
  assert.equal(translate("Polonia"), "Poland");
  assert.equal(translate("Finlande"), "Finland");
  assert.equal(translate("Dantzig"), "Free City of Danzig");
});

test("a generic name reaches the one polity whose name ends with it, and only then", () => {
  const translate = createPolityNameTranslator(world);
  assert.equal(translate("Japon"), "Imperialist Japan");
  assert.equal(translate("Chine"), "Kuomintang China");
  const twoChinas = createPolityNameTranslator({
    polityOverrides: { ...world.polityOverrides, "Communist China": { name: "Communist China", aliases: [] } },
  });
  assert.equal(twoChinas("Chine"), "Chine", "two polities end with China: nobody is picked");
});

test("exact names, unknown names and a foreign name with no polity on the map are left as written", () => {
  const translate = createPolityNameTranslator(world);
  assert.equal(translate("Lithuania"), "Lithuania");
  assert.equal(translate("Republic of Karelia"), "Republic of Karelia");
  assert.equal(translate("Allemagne"), "Allemagne", "Germany is not in this world, so nothing is invented");
  assert.equal(translate(""), "");
});

test("every polity field of a turn is translated: transfers, control, claims, chats, units, combatants, wars", () => {
  const candidate = {
    events: [{
      title: "Chute de Vilnius",
      combatants: ["Union soviétique", "Lituanie"],
      impacts: {
        regionTransfers: [{ regionId: "Vilnius", fromCode: "Lituanie", toCode: "URSS" }],
        regionControlOps: [{ op: "contest", regionId: "Kaunas", fromCode: "Lituanie", actorCode: "Union soviétique" }],
        regionClaims: [{ regionId: "Vilnius", claimantCode: "Union soviétique" }],
        createdChats: [{ countries: ["Royaume-Uni", { code: "France", name: "France" }], speaker: "Royaume-Uni", title: "Médiation" }],
        unitOps: [{ op: "spawn", unit: { ownerCode: "Union soviétique" } }],
        polityChanges: [
          { operation: "update", code: "Royaume-Uni", reputation: 40 },
          { operation: "create", code: "Lituanie libre", name: "Lituanie libre" },
        ],
      },
    }],
    diplomaticOutreach: [{ countries: [{ code: "Finlande", name: "Finlande" }], speaker: "Finlande" }],
    warUpdates: "war-1~start~Union soviétique~Lituanie~1~Invasion of Lituanie",
  };
  const made = canonicalizePayloadPolityNames(candidate, world);
  const impacts = candidate.events[0].impacts;
  assert.deepEqual(impacts.regionTransfers[0], { regionId: "Vilnius", fromCode: "Lithuania", toCode: "Soviet Union" });
  assert.equal(impacts.regionControlOps[0].fromCode, "Lithuania");
  assert.equal(impacts.regionControlOps[0].actorCode, "Soviet Union");
  assert.equal(impacts.regionClaims[0].claimantCode, "Soviet Union");
  assert.deepEqual(impacts.createdChats[0].countries, ["United Kingdom", { code: "France", name: "France" }]);
  assert.equal(impacts.createdChats[0].speaker, "United Kingdom");
  assert.equal(impacts.unitOps[0].unit.ownerCode, "Soviet Union");
  assert.equal(impacts.polityChanges[0].code, "United Kingdom");
  assert.equal(impacts.polityChanges[1].code, "Lituanie libre", "a creation names its own polity");
  assert.deepEqual(candidate.events[0].combatants, ["Soviet Union", "Lithuania"]);
  assert.equal(candidate.diplomaticOutreach[0].speaker, "Finland");
  assert.equal(candidate.warUpdates, "war-1~start~Soviet Union~Lithuania~1~Invasion of Lituanie", "free text in the note is left alone");
  assert.deepEqual(made.map((m) => `${m.from}>${m.to}`).sort(), [
    "Finlande>Finland", "Lituanie>Lithuania", "Royaume-Uni>United Kingdom", "URSS>Soviet Union", "Union soviétique>Soviet Union",
  ]);
});

test("war records sent as objects are translated too", () => {
  const candidate = { warUpdates: [{ id: "w", op: "start", actors: ["URSS"], opponents: ["Lituanie"] }] };
  canonicalizePayloadPolityNames(candidate, world);
  assert.deepEqual(candidate.warUpdates[0].actors, ["Soviet Union"]);
  assert.deepEqual(candidate.warUpdates[0].opponents, ["Lithuania"]);
});

test("exonym keys are folded like owner identities", () => {
  assert.equal(EXONYMS.lituanie, "Lithuania");
  assert.equal(EXONYMS.royaumeuni, "United Kingdom");
});

test("the turn's validation translates names before anything reads them", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "Game", "AI", "gameplay.js"), "utf8");
  const start = source.indexOf("export const validateGeneratedWorldChanges");
  const translate = source.indexOf("canonicalizePayloadPolityNames(candidate", start);
  const resolve = source.indexOf("resolveRegionTransfers(containers", start);
  assert.ok(start > 0 && translate > start && translate < resolve, "names are translated before the region resolver runs");
});
