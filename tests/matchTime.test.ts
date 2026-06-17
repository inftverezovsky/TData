import test from "node:test";
import assert from "node:assert/strict";
import { hasExactMatchTime, resolveDisplayMatchDate, resolveExactMatchDate } from "../backend/src/matches/time";

test("hasExactMatchTime rejects date-only announcements", () => {
  assert.equal(hasExactMatchTime({
    matchDate: new Date("2026-05-23T00:00:00.000Z"),
    matchDateTime: "May 23, 2026",
    rawText: "announced match",
  }), false);
});

test("hasExactMatchTime keeps explicit midnight times", () => {
  assert.equal(hasExactMatchTime({
    matchDate: new Date("2026-06-04T00:00:00.000Z"),
    matchDateTime: "June 4, 2026 - 00:00 UTC",
    rawText: "TBD vs TBD Quarterfinals",
  }), true);
});

test("resolveExactMatchDate restores Liquipedia timer timestamps from raw HTML", () => {
  assert.equal(resolveExactMatchDate({
    matchDate: null,
    matchDateTime: "May 22 - 17:00 KST",
    rawText: '<span class="timer-object" data-timestamp="1779436800">May 22 - 17:00 KST</span>',
  })?.toISOString(), "2026-05-22T08:00:00.000Z");
});

test("resolveExactMatchDate parses explicit Liquipedia date text", () => {
  assert.equal(resolveExactMatchDate({
    matchDate: null,
    matchDateTime: "May 13, 2026 - 12:00 {{Abbr/CEST}}",
  })?.toISOString(), "2026-05-13T10:00:00.000Z");
});

test("resolveExactMatchDate does not trust unknown explicit timezones", () => {
  assert.equal(hasExactMatchTime({
    matchDate: null,
    matchDateTime: "May 31, 2026 - 14:00 {{Abbr/XYZ}}",
  }), false);
});

test("resolveExactMatchDate does not let stored dates bypass unknown timezones", () => {
  assert.equal(resolveExactMatchDate({
    matchDate: new Date("2026-05-31T14:00:00.000Z"),
    matchDateTime: "May 31, 2026 - 14:00 {{Abbr/XYZ}}",
  }), null);
});

test("resolveExactMatchDate trusts normalized date text before raw source text", () => {
  assert.equal(resolveExactMatchDate({
    matchDate: new Date("2026-05-29T10:00:00.000Z"),
    matchDateTime: "May 29, 2026 - 18:00 +0800",
    rawText: "{{Match|date=May 29, 2026 - 18:00 {{Abbr/CST}}}}",
  })?.toISOString(), "2026-05-29T10:00:00.000Z");
});

test("resolveExactMatchDate prefers stored exact date over localized display text", () => {
  assert.equal(resolveExactMatchDate({
    matchDate: new Date("2026-06-04T14:00:00.000Z"),
    matchDateTime: "04.06.2026 17:00:00",
  })?.toISOString(), "2026-06-04T14:00:00.000Z");
});

test("resolveExactMatchDate prefers source timestamps over text timezone parsing", () => {
  assert.equal(resolveExactMatchDate({
    matchDate: null,
    matchDateTime: "May 31, 2026 - 14:00 {{Abbr/XYZ}}",
    rawText: '<span class="timer-object" data-timestamp="1780246800">May 31 - 14:00 XYZ</span>',
  })?.toISOString(), "2026-05-31T17:00:00.000Z");
});

test("hasExactMatchTime trusts non-midnight parsed dates", () => {
  assert.equal(hasExactMatchTime({
    matchDate: new Date("2026-05-23T12:15:00.000Z"),
    matchDateTime: null,
  }), true);
});

test("hasExactMatchTime trusts HLTV timestamps when stored as exact dates", () => {
  assert.equal(hasExactMatchTime({
    matchDate: new Date("2026-05-23T00:00:00.000Z"),
    sourceUrl: "https://www.hltv.org/matches/123/test",
  }), true);
});

test("date-only matches can have a display date without becoming exact", () => {
  const match = {
    matchDate: null,
    matchDateTime: "May 31, 2026",
    rawText: "WHU.Crychic vs 焦阳人类科学院",
  };

  assert.equal(resolveExactMatchDate(match), null);
  assert.equal(resolveDisplayMatchDate(match)?.toISOString(), "2026-05-31T00:00:00.000Z");
});
