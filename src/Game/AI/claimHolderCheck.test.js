import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { checkClaimHolder, describeClaimHolderFeedback, describeClaimHolderReceipt } from "./claimHolderCheck.js";
import { mentionedPolities } from "../../runtime/polityExonyms.js";

const world = {
  polityOverrides: {
    Lithuania: { name: "Lithuania", aliases: [] },
    Poland: { name: "Poland", aliases: [] },
    "Soviet Union": { name: "Soviet Union", aliases: [] },
    France: { name: "France", aliases: [] },
  },
};
// Game F, 1936-01-02, as the model wrote it.
const fieldEvent = "Lituanie : Revendication soviétique et mobilisation générale. L'Union soviétique formule une revendication territoriale ; le gouvernement lituanien ordonne la mobilisation générale.";

test("the polities a text names, in any language, as the map's names", () => {
  assert.deepEqual(mentionedPolities(fieldEvent, world).sort(), ["Lithuania", "Soviet Union"]);
  assert.deepEqual(mentionedPolities("La France et le Royaume-Uni condamnent", world), ["France"], "only polities of this world");
  assert.deepEqual(mentionedPolities("", world), []);
});

test("a claim on Polish Vilnius told as Lithuania's affair is flagged, with the real holder", () => {
  const problem = checkClaimHolder({
    regionName: "Vilnius", holder: "Poland", claimant: "Soviet Union",
    mentioned: mentionedPolities(fieldEvent, world), neighbourOwners: ["Lithuania", "Poland", "Soviet Union"],
  });
  assert.equal(problem, "Vilnius belongs to Poland, not to Lithuania: Soviet Union's claim is a claim on Poland's land");
  const feedback = describeClaimHolderFeedback({ path: "$.events[0].impacts", regionName: "Vilnius", holder: "Poland", claimant: "Soviet Union", problem });
  assert.match(feedback, /^\$\.events\[0\]\.impacts\.regionClaims: Vilnius belongs to Poland/);
  assert.match(feedback, /make Poland the one who reacts/);
  assert.equal(
    describeClaimHolderReceipt({ title: "Lituanie : Revendication", problem, regionName: "Vilnius", holder: "Poland" }),
    `Event "Lituanie : Revendication": the claim stands, but ${problem}. Later events must treat Vilnius as Poland's land.`,
  );
});

test("no flag when the holder is named, when only a distant power reacts, or when the claimant holds it", () => {
  const base = { regionName: "Vilnius", holder: "Poland", claimant: "Soviet Union", neighbourOwners: ["Lithuania", "Poland"] };
  assert.equal(checkClaimHolder({ ...base, mentioned: ["Soviet Union", "Poland", "Lithuania"] }), "");
  assert.equal(checkClaimHolder({ ...base, mentioned: ["Soviet Union", "France"] }), "", "France does not border Vilnius");
  assert.equal(checkClaimHolder({ ...base, holder: "Soviet Union", mentioned: ["Lithuania"] }), "");
});

test("claims are checked in validation, before the guard, and each claim carries its region's name and holder", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  const start = source.indexOf("export const validateGeneratedWorldChanges");
  const check = source.indexOf("const claimProblems = checkClaimsAgainstHolders(containers, world);", start);
  const guard = source.indexOf("guardRefusedTerritory(containers, refused", start);
  assert.ok(check > start && check < guard);
  assert.match(source.slice(check, guard), /if \(strict && claimProblems\.length\) \{\s*return claimProblems\.slice\(0, 3\)\.map\(describeClaimHolderFeedback\)/);
  const helper = source.slice(source.indexOf("const checkClaimsAgainstHolders = "), source.indexOf("const enforceWarRules = "));
  assert.match(helper, /claim\.regionName = regionName;/);
  assert.match(helper, /claim\.holder = holder;/);
});
