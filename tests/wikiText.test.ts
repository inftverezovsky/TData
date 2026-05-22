import test from "node:test";
import assert from "node:assert/strict";
import { cleanWikiValue, parseWikiDate } from "../src/lib/normalizers/wikiText";

test("cleanWikiValue preserves Liquipedia timezone abbreviation templates", () => {
  assert.equal(
    cleanWikiValue("May 13, 2026 - 12:00 {{Abbr/CEST}}"),
    "May 13, 2026 - 12:00 CEST",
  );
});

test("parseWikiDate respects explicit Liquipedia timezone abbreviations", () => {
  assert.equal(
    parseWikiDate("May 13, 2026 - 12:00 {{Abbr/CEST}}")?.toISOString(),
    "2026-05-13T10:00:00.000Z",
  );
});

test("parseWikiDate preserves known Liquipedia date template fields", () => {
  assert.equal(
    parseWikiDate("{{Date|2026-05-13|12:00|CEST}}")?.toISOString(),
    "2026-05-13T10:00:00.000Z",
  );
  assert.equal(
    parseWikiDate("{{Start date|2026|05|13}}")?.toISOString(),
    "2026-05-13T00:00:00.000Z",
  );
  assert.equal(parseWikiDate("2026"), null);
});
