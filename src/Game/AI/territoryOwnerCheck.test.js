import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  createForeignPlaceFinder,
  createOwnerMismatchCheck,
  describeOwnerMismatchFeedback,
  describeOwnerMismatchReceipt,
} from "./territoryOwnerCheck.js";

// The 1936 map around the field report: Vilnius (alias Wilno) is Polish, Kaunas Lithuanian.
const regions = [
  { id: "imp-rgb-0066DD", name: "Vilnius", aliases: ["Wilno", "Vilna"], owner: "Poland" },
  { id: "imp-rgb-BB33CC", name: "Kaunas", aliases: ["Kovno"], owner: "Lithuania" },
  { id: "imp-rgb-552200", name: "Klaipėda", aliases: ["Memel"], owner: "Lithuania" },
];
const key = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const byId = new Map(regions.map((region) => [region.id, region]));
const byName = new Map();
for (const region of regions) {
  for (const name of [region.name, ...region.aliases]) byName.set(key(name), [...(byName.get(key(name)) ?? []), region]);
}
const check = createOwnerMismatchCheck({
  canonicalOwnerKey: (token) => (["Poland", "Lithuania", "Soviet Union"].includes(token) ? key(token) : ""),
  ownerKeyOf: (regionId) => key(byId.get(regionId)?.owner),
  ownerNameOf: (regionId) => byId.get(regionId)?.owner ?? "",
  regionNameOf: (regionId) => byId.get(regionId)?.name ?? "",
});
const cities = [{ name: "Wilno Old Town", aliases: ["Vilniaus senamiestis"] }];
const find = createForeignPlaceFinder({
  byName,
  catalog: regions,
  regionKey: key,
  matchExact: () => null,
  cities,
  containingRegionIds: (city) => (city.name === "Wilno Old Town" ? ["imp-rgb-0066DD"] : []),
});

test("a transfer whose named loser does not hold the region is refused, with the real holder", () => {
  const refusal = check({ regionId: "Vilnius", fromCode: "Lithuania", toCode: "Soviet Union" }, "imp-rgb-0066DD");
  assert.deepEqual(refusal, {
    label: "Vilnius",
    fromCode: "Lithuania",
    candidates: [],
    ownerMismatch: { regionId: "imp-rgb-0066DD", regionName: "Vilnius", actualOwner: "Poland" },
  });
});

test("a transfer from the real holder, an unnamed loser or an unknown power is not this check's business", () => {
  assert.equal(check({ regionId: "Vilnius", fromCode: "Poland", toCode: "Soviet Union" }, "imp-rgb-0066DD"), null);
  assert.equal(check({ regionId: "Vilnius", fromCode: "", toCode: "Soviet Union" }, "imp-rgb-0066DD"), null);
  assert.equal(check({ regionId: "Vilnius", fromCode: "Lituanie", toCode: "Soviet Union" }, "imp-rgb-0066DD"), null);
  assert.equal(check({ regionId: "Vilnius", fromCode: "Unresolved polity" }, "imp-rgb-0066DD"), null);
});

test("a place the whole map knows is found wherever it is: name, period alias, map city", () => {
  assert.equal(find("Vilnius"), "imp-rgb-0066DD");
  assert.equal(find("Wilno"), "imp-rgb-0066DD");
  assert.equal(find("Memel"), "imp-rgb-552200");
  assert.equal(find("Vilniaus senamiestis"), "imp-rgb-0066DD");
  assert.equal(find("Samogitia"), "", "an unknown name is not guessed");
});

test("the retry names the real owner and offers no other region", () => {
  const refusal = { ...check({ regionId: "Vilnius", fromCode: "Lithuania" }, "imp-rgb-0066DD"), path: "$.events[0].impacts" };
  const line = describeOwnerMismatchFeedback(refusal);
  assert.match(line, /belongs to Poland, not to Lithuania/);
  assert.match(line, /will not take another region instead/);
  assert.match(line, /write fromCode "Poland"/);
  assert.doesNotMatch(line, /Kaunas|Klaipėda|Regions currently owned/, "no list of the named side's regions");
});

test("the receipt says it did NOT change hands", () => {
  const refusal = check({ regionId: "Vilnius", fromCode: "Lithuania" }, "imp-rgb-0066DD");
  assert.equal(
    describeOwnerMismatchReceipt(refusal, "transfer of", 'Event "Chute de Vilnius": '),
    'Event "Chute de Vilnius": the transfer of "Vilnius" was refused — Vilnius belongs to Poland, not to Lithuania. It did NOT change hands.',
  );
});

test("the resolver refuses a mismatch both after an exact match and before the semantic pass", () => {
  const source = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"), "utf8");
  const start = source.indexOf("const resolveRegionTransfers = async");
  const end = source.indexOf("const semanticPlans = [];", start);
  const body = source.slice(start, end);
  const deterministic = body.indexOf("const regionId = deterministicResolve(transfer, event);");
  const exactCheck = body.indexOf("const mismatch = ownerMismatch(transfer, regionId);", deterministic);
  const pushResolved = body.indexOf("pushUniqueTransfer(resolved, normalized);", deterministic);
  assert.ok(deterministic > 0 && exactCheck > deterministic && exactCheck < pushResolved, "checked before the resolved transfer is kept");
  const foreign = body.indexOf("foreignPlace(label)");
  const semantic = body.indexOf("semanticPending.push(record);");
  assert.ok(foreign > 0 && foreign < semantic, "checked before the semantic resolver may map it onto the named side's regions");
});
