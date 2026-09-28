import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describeCapitals, loadWorldMapCapitals } from "./capitals.js";
import { buildRegionOwnershipText } from "../../Game/AI/regionVocab.js";
import { CAPITALS_1936 } from "../../../scripts/worldmap/capitals-1936.mjs";
import { PERIOD_ALIASES_1936 } from "../../../scripts/worldmap/aliases-1936.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));

test("every polity's capital is listed for the AI, with who holds it when that is someone else", () => {
  const capitals = {
    Lithuania: { city: "Kaunas", state: "imp-rgb-BB33CC", stateName: "Kaunas" },
    Poland: { city: "Warsaw", state: "imp-rgb-POL", stateName: "Warszawa" },
  };
  const text = describeCapitals(capitals, (state) => (state === "imp-rgb-POL" ? "Germany" : "Lithuania"));
  assert.equal(text, "- Lithuania: Kaunas\n- Poland: Warsaw, region Warszawa — held by Germany");
  assert.equal(describeCapitals({}), "");
});

test("1936 capitals: Kaunas for Lithuania, Ankara for Turkey, one entry per polity", () => {
  assert.equal(CAPITALS_1936.Lithuania[0], "Kaunas");
  assert.equal(CAPITALS_1936.Turkey[0], "Ankara");
  assert.equal(CAPITALS_1936["Free City of Danzig"][0], "Danzig");
  for (const [polity, [city, lng, lat]] of Object.entries(CAPITALS_1936)) {
    assert.ok(city && Number.isFinite(lng) && Number.isFinite(lat), polity);
  }
});

test("period names of 1936 for places the map names after today", () => {
  assert.deepEqual(PERIOD_ALIASES_1936.Vilnius, ["Wilno", "Vilna"]);
  assert.deepEqual(PERIOD_ALIASES_1936["Saint Petersburg"], ["Leningrad"]);
  assert.deepEqual(PERIOD_ALIASES_1936.Kaliningrad, ["Königsberg"]);
  assert.deepEqual(PERIOD_ALIASES_1936.Lviv, ["Lwów", "Lemberg"]);
});

test("the region list the AI reads shows a region's period names", () => {
  const text = buildRegionOwnershipText(
    [
      { id: "imp-rgb-0066DD", name: "Vilnius", country: "Poland", aliases: ["Wilno", "Vilna"] },
      { id: "imp-rgb-BB33CC", name: "Kaunas", country: "Lithuania", aliases: [] },
    ],
    {},
    { focusCodes: ["poland", "lithuania"] },
  );
  assert.match(text, /Vilnius \[also Wilno \/ Vilna\] \(imp-rgb-0066DD\)/);
  assert.match(text, /Kaunas \(imp-rgb-BB33CC\)/);
});

test("without a server (a game off the world map, or the tests) there are no capitals", async () => {
  assert.deepEqual(await loadWorldMapCapitals({ force: true }), {});
});

test("the world summary gives the capitals, and the correction writes and checks them", () => {
  const summary = fs.readFileSync(path.join(here, "..", "..", "Game", "AI", "promptContext.js"), "utf8");
  assert.match(summary, /describeCapitals\(\s*await loadWorldMapCapitals\(\)/);
  assert.match(summary, /Capitals \(the seat of each government/);
  const correction = fs.readFileSync(path.join(here, "..", "..", "..", "scripts", "worldmap", "correct-1936.mjs"), "utf8");
  assert.match(correction, /if \(owner !== polity\) \{ capitalErrors\.push/);
  // The capital is the province of the city itself (today's or 1936 name), the point only failing that.
  assert.match(correction, /const id = cityProvince\(polity, city\) \|\| at\(lng, lat\);/);
  // Liberia keeps its 1936 borders (today's): Monrovia was British and the north French in the old regions.
  assert.match(correction, /else if \(today === "LBR"\) \{ owner = "Liberia";/);
  assert.match(correction, /\["Monrovia", -10\.8, 6\.3, "Liberia"\]/);
  // British and Portuguese West Africa keep their colonial borders (today's).
  assert.match(correction, /NGA: "United Kingdom", GHA: "United Kingdom", SLE: "United Kingdom", GMB: "United Kingdom", SHN: "United Kingdom", GNB: "Portugal"/);
  assert.match(correction, /else if \(WEST_AFRICA_1936\[today\]\) \{ owner = WEST_AFRICA_1936\[today\];/);
  for (const place of ["Freetown", "Lagos", "Accra", "Bathurst", "Bissau"]) assert.match(correction, new RegExp(`\\["${place} \\(`), place);
  // The other colonial territories of 1936, split by admin-1 region where today's country joins two.
  assert.match(correction, /CMR: \{ owner: "France", byRegion: \{ "Sud-Ouest": "United Kingdom", "Nord-Ouest": "United Kingdom" \} \}/);
  assert.match(correction, /YEM: \{ owner: "Yemen", byRegion: \{ Lahij: "United Kingdom", Abyan: "United Kingdom"/);
  for (const [code, owner] of [["ERI", "Italy"], ["SAH", "Spain"], ["GNQ", "Spain"], ["CPV", "Portugal"], ["STP", "Portugal"], ["COM", "France"], ["PNG", "Dominion of Australia"], ["OMN", "Oman"], ["MMR", "British Raj"]]) {
    assert.match(correction, new RegExp(`${code}: "${owner}"`), code);
  }
  // Bahrain, absent from the scenario, is added like Danzig and Tangier: a new polity with its profile.
  assert.match(correction, /BHR: "Bahrain",/);
  assert.match(correction, /  Bahrain: \{\n    color: \[196, 60, 70\],\n    label: "Bahreïn",/);
  assert.match(correction, /tags: \["british puppet"\],\n    flag: FLAGS_1936\.Bahrain,/);
  assert.equal(CAPITALS_1936.Bahrain[0], "Manama");
  for (const place of ["Buea (Cameroun britannique)", "Aden (protectorat)", "Rangoun (Birmanie)", "Port Moresby (Papouasie)"]) assert.ok(correction.includes(`["${place}"`), place);
  assert.match(correction, /newOwners: NEW_OWNERS, capitals,/);
  const server = fs.readFileSync(path.join(here, "..", "..", "..", "server", "worldMap.js"), "utf8");
  assert.match(server, /app\.get\("\/api\/worldmap\/capitals"/);
});
