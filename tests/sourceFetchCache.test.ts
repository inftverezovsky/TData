import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceFetchCacheKey } from "../backend/src/utils/sourceFetchCache";
import {
  computeMatchSetQuality,
  hasPlaceholderTeams,
  shouldKeepPreviousMatches,
} from "../backend/src/matches/quality";

test("buildSourceFetchCacheKey normalizes source resource identity", () => {
  assert.equal(
    buildSourceFetchCacheKey({
      source: "Liquipedia",
      disciplineSlug: "CounterStrike",
      resourceType: "Page",
      resourceKey: "PGL/2026/Astana",
    }),
    "liquipedia:counterstrike:page:cache-first:pgl/2026/astana"
  );
});

test("match quality marks TBD as placeholder but does not make the set invalid", () => {
  const matches = [
    {
      teamAName: "TBD1",
      teamBName: "TBD2",
      matchDate: new Date("2026-05-15T12:00:00.000Z"),
      rawText: "slot 1",
    },
  ];

  assert.equal(hasPlaceholderTeams(matches[0]), true);
  assert.ok(computeMatchSetQuality(matches) > 0);
});

test("quality gate keeps previous matches when new scrape is empty", () => {
  assert.equal(
    shouldKeepPreviousMatches({
      newMatches: [],
      previousMatches: [{ teamAName: "G2", teamBName: "MOUZ", matchDate: new Date("2026-05-15T12:00:00.000Z") }],
      newQualityScore: 0,
      sourceHadError: true,
    }),
    true
  );
});

test("quality gate allows one-match snapshots to refresh without count regression", () => {
  assert.equal(
    shouldKeepPreviousMatches({
      newMatches: [{ teamAName: "Alpha", teamBName: "TBD", matchDate: new Date("2026-05-31T00:00:00.000Z") }],
      previousMatches: [{ teamAName: "TBD1", teamBName: "TBD2", matchDateTime: "May 31, 2026" }],
      newQualityScore: 0.47,
      sourceHadError: false,
    }),
    false,
  );
});
