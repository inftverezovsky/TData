import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceFetchCacheKey } from "../src/lib/utils/sourceFetchCache";
import {
  computeMatchSetQuality,
  hasPlaceholderTeams,
  shouldKeepPreviousMatches,
} from "../src/lib/matches/quality";

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
