import test from "node:test";
import assert from "node:assert/strict";
import { dedupeTournamentMatches, getCanonicalMatchKey } from "../src/lib/matches/dedupe";

test("dedupeTournamentMatches collapses the same dated pair even when sides are swapped", () => {
  const matches = dedupeTournamentMatches([
    {
      matchId: "raw-a",
      teamAName: "G2",
      teamBName: "The MongolZ",
      matchDate: new Date("2026-05-11T08:00:00.000Z"),
    },
    {
      matchId: "raw-b",
      teamAName: "The MongolZ",
      teamBName: "G2",
      matchDate: new Date("2026-05-11T08:00:30.000Z"),
    },
  ]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchId, "raw-a");
});

test("dedupeTournamentMatches keeps repeated undated pairs in different rounds", () => {
  const matches = dedupeTournamentMatches([
    {
      matchId: "round-1",
      teamAName: "Team Spirit",
      teamBName: "Falcons",
      stage: "Group A",
      round: "Round 1",
    },
    {
      matchId: "round-2",
      teamAName: "Falcons",
      teamBName: "Team Spirit",
      stage: "Group A",
      round: "Round 2",
    },
  ]);

  assert.equal(matches.length, 2);
});

test("dedupeTournamentMatches removes generated crosstable slots covered by scheduled matches", () => {
  const matches = dedupeTournamentMatches([
    {
      matchId: "scheduled",
      teamAName: "Virtus.pro",
      teamBName: "Team Falcons",
      matchDate: new Date("2026-05-13T10:00:00.000Z"),
      matchDateTime: "May 13, 2026 - 12:00 CEST",
      rawText: "<div class=\"brkts-matchlist-match\"></div>",
    },
    {
      matchId: "generated-crosstable",
      teamAName: "Virtus.pro",
      teamBName: "Team Falcons",
      matchDate: null,
      matchDateTime: null,
      stage: "Group Stage",
      round: "Group A",
      format: "Round robin",
      status: "upcoming",
      rawText: "<table class=\"crosstable\"><tr class=\"crosstable-tr\"></tr></table>",
    },
  ]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchId, "scheduled");
});

test("dedupeTournamentMatches removes generated crosstable slots without schedule data", () => {
  const matches = dedupeTournamentMatches([
    {
      matchId: "generated-crosstable",
      teamAName: "Virtus.pro",
      teamBName: "Team Falcons",
      matchDate: null,
      matchDateTime: null,
      stage: "Group Stage",
      round: "Group A",
      format: "Round robin",
      status: "upcoming",
      rawText: "<table class=\"crosstable\"><tr class=\"crosstable-tr\"></tr></table>",
    },
  ]);

  assert.equal(matches.length, 0);
});

test("dedupeTournamentMatches collapses same visible time with and without timezone suffix", () => {
  const matches = dedupeTournamentMatches([
    {
      matchId: "html",
      teamAName: "Team Falcons",
      teamBName: "Virtus.pro",
      matchDate: new Date("2026-05-13T10:00:00.000Z"),
      matchDateTime: "May 13, 2026 - 12:00 CEST",
      stage: "May 13-A",
      rawText: "<div class=\"brkts-matchlist-match\"></div>",
    },
    {
      matchId: "wikitext",
      teamAName: "Virtus.pro",
      teamBName: "Team Falcons",
      matchDate: new Date("2026-05-13T15:00:00.000Z"),
      matchDateTime: "May 13, 2026 - 12:00",
    },
  ]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchId, "html");
  assert.deepEqual(matches[0].matchDate, new Date("2026-05-13T10:00:00.000Z"));
});

test("dedupeTournamentMatches keeps same pair on different days when visible time is time-only", () => {
  const matches = dedupeTournamentMatches([
    {
      matchId: "day-one",
      teamAName: "Alpha",
      teamBName: "Bravo",
      matchDate: new Date("2026-05-13T10:00:00.000Z"),
      matchDateTime: "12:00",
    },
    {
      matchId: "day-two",
      teamAName: "Bravo",
      teamBName: "Alpha",
      matchDate: new Date("2026-05-14T10:00:00.000Z"),
      matchDateTime: "12:00",
    },
  ]);

  assert.equal(matches.length, 2);
});

test("dedupeTournamentMatches prefers richer duplicate records and fills missing fields", () => {
  const datedMatches = dedupeTournamentMatches([
    {
      matchId: "old",
      teamAName: "MOUZ",
      teamBName: "9z",
      matchDate: new Date("2026-05-11T11:00:00.000Z"),
      stage: "Group Stage",
    },
    {
      matchId: "new",
      platformId: "436175",
      teamAName: "9z",
      teamBName: "MOUZ",
      matchDate: new Date("2026-05-11T11:00:00.000Z"),
      round: "Opening",
    },
  ]);

  assert.equal(datedMatches.length, 1);
  assert.equal(datedMatches[0].matchId, "new");
  assert.equal(datedMatches[0].platformId, "436175");
  assert.equal(datedMatches[0].stage, "Group Stage");
});

test("getCanonicalMatchKey separates undated repeats by round context", () => {
  const firstKey = getCanonicalMatchKey({
    teamAName: "TBD1",
    teamAId: "team_tbd1",
    teamBName: "TBD2",
    teamBId: "team_tbd2",
    round: "Round 1",
  });
  const secondKey = getCanonicalMatchKey({
    teamAName: "TBD2",
    teamAId: "team_tbd2",
    teamBName: "TBD1",
    teamBId: "team_tbd1",
    round: "Round 2",
  });

  assert.notEqual(firstKey, secondKey);
});

test("dedupeTournamentMatches keeps dated placeholder slots with different source text", () => {
  const matches = dedupeTournamentMatches([
    {
      matchId: "slot-a",
      teamAName: "TBD1",
      teamBName: "TBD2",
      matchDate: new Date("2026-05-15T12:00:00.000Z"),
      round: "Upper Bracket Round 1",
      rawText: "slot 1 upper bracket",
    },
    {
      matchId: "slot-b",
      teamAName: "TBD1",
      teamBName: "TBD2",
      matchDate: new Date("2026-05-15T12:00:00.000Z"),
      round: "Upper Bracket Round 1",
      rawText: "slot 2 upper bracket",
    },
  ]);

  assert.equal(matches.length, 2);
});
