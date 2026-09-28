import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { formatGameDateForDisplay, formatGameDateReadable } from "./gameDates.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));

// Test F, 15–22 January 1936: "Jan 17, 1936" in the French events list.
test("an event's date is written in the player's language", () => {
  assert.equal(formatGameDateForDisplay("1936-01-17", "fr"), "17 janv. 1936");
  assert.equal(formatGameDateForDisplay("1936-01-17", "fr", { month: "long" }), "17 janvier 1936");
  assert.equal(formatGameDateForDisplay("1936-01-17", "de"), "17. Jan. 1936");
  assert.equal(formatGameDateForDisplay("1936-01-17", "en"), "Jan 17, 1936");
  assert.equal(formatGameDateForDisplay("0200-03-01", "fr"), "1 mars 200", "an early year is not read as 1900 + 200");
  assert.equal(formatGameDateForDisplay("-0218-03-01", "fr"), formatGameDateReadable("-0218-03-01", "MMM D, YYYY"), "BC keeps its own words");
  assert.equal(formatGameDateForDisplay("not a date", "fr"), "");
});

test("the events list uses it, and keeps the date away from the interface translator", () => {
  const source = fs.readFileSync(path.join(here, "..", "Game", "GameUI", "time.jsx"), "utf8");
  assert.match(source, /const shown = formatGameDateForDisplay\(value, getStoredLanguage\(\)\);/);
  assert.match(source, /<span data-no-translate="">\{formatDate\(event\.date\)\}<\/span>/);
  // Prompts keep the English form.
  assert.equal(formatGameDateReadable("1936-01-17", "MMM D, YYYY"), "Jan 17, 1936");
});
