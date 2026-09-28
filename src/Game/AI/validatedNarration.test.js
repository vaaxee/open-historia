import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  NARRATION_PROMPT,
  NARRATION_SCHEMA,
  applyNarration,
  buildNarrationItems,
  describeAppliedImpacts,
  validateNarration,
} from "./validatedNarration.js";
import { GAMEPLAY_TOOLS, getGameplayTool } from "./gameplaySchemas.js";
import { MAP_SETTING_KEYS, getMapSettingDefaultOn } from "../../runtime/mapSettings.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, ...parts), "utf8");

const events = () => [
  {
    date: "1936-01-15",
    title: "Lituanie : Chute de Vilnius et reddition sans conditions",
    description: "Les forces soviétiques prennent Vilnius ; le gouvernement lituanien capitule.",
    impacts: { unitOps: [{ op: "move" }, { op: "strength" }] },
  },
  {
    date: "1936-01-16",
    title: "Kaunas occupée",
    description: "L'Armée rouge entre dans Kaunas.",
    impacts: { regionControlOps: [{ op: "control", regionName: "Kaunas", toCode: "Soviet Union" }] },
  },
];

test("the narrator is shown, per event, exactly what the engine applied", () => {
  assert.deepEqual(describeAppliedImpacts({
    regionTransfers: [{ regionName: "Vyborg", fromCode: "Finland", toCode: "Soviet Union" }],
    regionControlOps: [{ op: "control", regionName: "Kaunas", toCode: "Soviet Union" }],
    regionClaims: [{ regionName: "Vilnius", claimantCode: "Soviet Union" }],
    unitOps: [{}, {}],
  }), [
    "Vyborg passes legally from Finland to Soviet Union",
    "Kaunas is now controlled by Soviet Union (occupation; legal owner unchanged)",
    "Soviet Union claims Vilnius (a claim only: no border moves)",
    "2 military unit operations (moves, new units, losses)",
  ]);
  const items = buildNarrationItems(events());
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].appliedChanges, ["2 military unit operations (moves, new units, losses)"]);
  assert.equal(items[1].appliedChanges[0], "Kaunas is now controlled by Soviet Union (occupation; legal owner unchanged)");
});

test("an answer is used only whole: one entry per event, each with a title and a description", () => {
  assert.equal(validateNarration({ events: [{ index: 0, title: "a", description: "b" }, { index: 1, title: "c", description: "d" }] }, 2), "");
  assert.match(validateNarration({ events: [{ index: 0, title: "a", description: "b" }] }, 2), /exactly 2 events/);
  assert.match(validateNarration({ events: [{ index: 0, title: "a", description: "b" }, { index: 0, title: "c", description: "d" }] }, 2), /appears twice/);
  assert.match(validateNarration({ events: [{ index: 0, title: "a", description: "" }, { index: 1, title: "c", description: "d" }] }, 2), /needs a title and a description/);
});

test("only titles and descriptions change; dates, impacts and events stay", () => {
  const list = events();
  const changed = applyNarration(list, { events: [
    { index: 0, title: "Lituanie : l'offensive sur Vilnius échoue", description: "Les forces soviétiques avancent vers Vilnius mais n'y entrent pas ; le gouvernement lituanien tient." },
    { index: 1, title: "Kaunas occupée", description: "L'Armée rouge entre dans Kaunas." },
  ] });
  assert.equal(changed, 1);
  assert.equal(list[0].title, "Lituanie : l'offensive sur Vilnius échoue");
  assert.equal(list[0].date, "1936-01-15");
  assert.equal(list[0].impacts.unitOps.length, 2);
  assert.equal(list[0].narratedFrom.title, "Lituanie : Chute de Vilnius et reddition sans conditions");
  assert.equal(list[1].narratedFrom, undefined, "an unchanged event is left alone");
});

test("the narrator may not bring back a change of hands the engine took out", () => {
  const list = [{ title: "Tensions à la frontière lituanienne", description: "Des divisions soviétiques se massent près de Kaunas.", impacts: {} }];
  const changed = applyNarration(list, { events: [{ index: 0, title: "Chute de Kaunas", description: "Les Soviétiques prennent Kaunas et la Lituanie capitule." }] });
  assert.equal(changed, 0);
  assert.equal(list[0].title, "Tensions à la frontière lituanienne");
});

test("the task is registered like every other: prompt, schema, tool, context profile, model pick", () => {
  assert.match(NARRATION_PROMPT, /\$\{narrationItems\}/);
  assert.match(NARRATION_PROMPT, /\$\{narrationRefusals\}/);
  assert.equal(JSON.parse(read("defaultPrompts.json")).tasks.validatedNarration, NARRATION_PROMPT);
  assert.equal(getGameplayTool("validatedNarration")?.schema, NARRATION_SCHEMA);
  assert.equal(GAMEPLAY_TOOLS.validatedNarration.name, "submit_narration");
  assert.match(read("contextDiagnostics.js"), /validatedNarration: Object\.freeze\(\["narrationItems", "narrationRefusals"\]\)/);
  assert.match(read("providerConfig.js"), /key: "validatedNarration"/);
});

test("the setting ships ON, and the skip narrates after validation only when it is on", () => {
  assert.equal(MAP_SETTING_KEYS.narrateAfterValidation, "ai_narrate_after_validation");
  assert.equal(getMapSettingDefaultOn(MAP_SETTING_KEYS.narrateAfterValidation), true);
  const source = read("gameplay.js");
  const accepted = source.indexOf("// Only now is the answer taken, so only now does its draft count.");
  const narrate = source.indexOf("await narrateValidatedSegment(payload", accepted);
  const screen = source.indexOf("screenSegmentPayload(payload, {", accepted);
  assert.ok(accepted > 0 && narrate > accepted && narrate < screen, "after the segment is validated, before it is screened and kept");
  assert.match(source.slice(accepted, narrate), /segmentGeneration\?\.source !== "fallback" && narrateAfterValidationEnabled\(\)/);
  assert.match(source, /\.\.\.jumpTaskOptions\(requests, "narration"\)/, "the request is asked of the skip's budget");
  assert.match(read("..", "GameUI", "settings.jsx"), /label="Write the story after validation"/);
});
