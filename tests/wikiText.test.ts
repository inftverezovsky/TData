import test from "node:test";
import assert from "node:assert/strict";
import { cleanWikiValue, hasUnknownExplicitTimezone, parseWikiDate } from "../src/lib/normalizers/wikiText";

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
  assert.equal(
    parseWikiDate("May 31, 2026 - 14:00 {{Abbr/BRT}}")?.toISOString(),
    "2026-05-31T17:00:00.000Z",
  );
  assert.equal(
    parseWikiDate("May 31, 2026 - 20:00 {{Abbr/MSK}}")?.toISOString(),
    "2026-05-31T17:00:00.000Z",
  );
  assert.equal(
    parseWikiDate("May 31, 2026 - 17:00 UTC")?.toISOString(),
    "2026-05-31T17:00:00.000Z",
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

test("parseWikiDate rejects unknown explicit timezones instead of assuming UTC", () => {
  assert.equal(parseWikiDate("May 31, 2026 - 14:00 {{Abbr/XYZ}}"), null);
  assert.equal(parseWikiDate("{{Date|2026-05-31|14:00|XYZ}}"), null);
  assert.equal(parseWikiDate("2026-05-31 14:00 XYZ"), null);
});

test("parseWikiDate rejects ambiguous CST timezone", () => {
  assert.equal(parseWikiDate("May 31, 2026 - 14:00 {{Abbr/CST}}"), null);
  assert.equal(hasUnknownExplicitTimezone("May 31, 2026 - 14:00 {{Abbr/CST}}"), true);
});

test("parseWikiDate can resolve CST only with a source-specific override", () => {
  const options = { timezoneOffsets: { CST: 480 } };

  assert.equal(
    parseWikiDate("May 29, 2026 - 18:00 {{Abbr/CST}}", options)?.toISOString(),
    "2026-05-29T10:00:00.000Z",
  );
  assert.equal(hasUnknownExplicitTimezone("May 29, 2026 - 18:00 {{Abbr/CST}}", options), false);
});

test("parseWikiDate handles English date-only text deterministically", () => {
  assert.equal(
    parseWikiDate("May 31, 2026")?.toISOString(),
    "2026-05-31T00:00:00.000Z",
  );
});
