import test from "node:test";
import assert from "node:assert/strict";
import { matchesToCsv } from "../backend/src/exporters/tournament";

test("matchesToCsv exports normalized Moscow datetime with discipline lead", () => {
  const csv = matchesToCsv({
    name: "Test Cup",
    sourceTitle: "Test Cup",
    sourceUrl: "https://liquipedia.net/counterstrike/Test_Cup",
    startDate: null,
    endDate: null,
    location: null,
    region: null,
    organizer: null,
    prizePool: null,
    formatText: null,
    status: null,
    participants: [],
    matches: [
      {
        matchId: "match-1",
        matchDate: new Date("2026-05-31T17:00:00.000Z"),
        matchDateTime: "May 31, 2026 - 14:00 {{Abbr/BRT}}",
        stage: "Playoffs",
        round: "Grand Final",
        teamAId: null,
        teamAName: "Alpha",
        teamBId: null,
        teamBName: "Beta",
        scoreA: null,
        scoreB: null,
        format: "BO3",
        status: "upcoming",
        court: null,
        sourceUrl: null,
      },
    ],
  }, "counterstrike");

  assert.match(csv, /"31\.05\.2026 19:55:00","2026-05-31"/);
  assert.doesNotMatch(csv, /BRT/);
});
