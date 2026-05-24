import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleFormatGroups,
  buildTbdAnnouncementSelectionId,
  expandScheduleAnnouncements,
  isAnnouncementScheduleMatch,
  isGeneratedScheduleMatrixRow,
  isUploadableScheduleEntry,
  isUploadReadyScheduleMatch,
  parseScheduleSelectionId,
} from "../src/lib/matches/scheduleView";

test("exact-time matches are upload-ready and not announcements", () => {
  const match = {
    id: "match-1",
    matchDate: null,
    matchDateTime: "May 23, 2026 - 13:00 CEST",
    rawText: "Alpha vs Beta",
    scoreA: null,
    scoreB: null,
    teamAName: "Alpha",
    teamBName: "Beta",
  };

  assert.equal(isUploadReadyScheduleMatch(match), true);
  assert.equal(isAnnouncementScheduleMatch(match), false);
  assert.equal(isUploadableScheduleEntry(match), true);
});

test("date-only schedule rows are announcements, not upload-ready matches", () => {
  const match = {
    id: "announcement-1",
    matchDate: new Date("2026-05-23T00:00:00.000Z"),
    matchDateTime: "May 23, 2026",
    rawText: "Alpha vs Beta announced match",
    scoreA: null,
    scoreB: null,
    teamAName: "Alpha",
    teamBName: "Beta",
  };

  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(isAnnouncementScheduleMatch(match), true);
  assert.equal(isUploadableScheduleEntry(match), false);
});

test("exact-time TBD slots are announcements, not upload-ready matches", () => {
  const match = {
    id: "announcement-tbd",
    matchDate: new Date("2026-06-02T18:55:00.000Z"),
    matchDateTime: "June 2, 2026 - 21:55 MSK",
    rawText: "TBD vs TBD playoff slot",
    scoreA: null,
    scoreB: null,
    teamAName: "TBD1",
    teamBName: "TBD2",
    hasPlaceholderTeams: true,
  };

  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(isAnnouncementScheduleMatch(match), true);
  assert.equal(isUploadableScheduleEntry(match), true);
});

test("exact-time TBD pairs expand into single-team announcement rows", () => {
  const entries = expandScheduleAnnouncements([
    {
      id: "db-row-1",
      matchId: "source-match-1",
      matchDate: new Date("2026-06-02T18:55:00.000Z"),
      matchDateTime: "June 2, 2026 - 21:55 MSK",
      rawText: "TBD1 vs TBD2 playoff slot",
      scoreA: null,
      scoreB: null,
      teamAName: "TBD1",
      teamBName: "TBD2",
      hasPlaceholderTeams: true,
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.singleAnnouncementTeamName), ["TBD1", "TBD2"]);
  assert.deepEqual(entries.map((entry) => entry.selectionId), [
    buildTbdAnnouncementSelectionId("source-match-1", "teamA"),
    buildTbdAnnouncementSelectionId("source-match-1", "teamB"),
  ]);
  assert.equal(entries.every((entry) => entry.isSingleTeamAnnouncement), true);
});

test("schedule selection parser preserves normal and virtual match IDs", () => {
  assert.deepEqual(parseScheduleSelectionId("match-1"), { matchId: "match-1" });
  assert.deepEqual(parseScheduleSelectionId("match-1::teamA"), { matchId: "match-1", side: "teamA" });
});

test("exact-time non-TBD placeholders remain non-uploadable announcements", () => {
  const match = {
    id: "announcement-seed",
    matchDate: new Date("2026-06-02T18:55:00.000Z"),
    matchDateTime: "June 2, 2026 - 21:55 MSK",
    rawText: "A1 vs B2 playoff slot",
    scoreA: null,
    scoreB: null,
    teamAName: "A1",
    teamBName: "B2",
    hasPlaceholderTeams: true,
  };

  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(isAnnouncementScheduleMatch(match), true);
  assert.equal(isUploadableScheduleEntry(match), false);
});

test("generated crosstable matrix rows are hidden from both schedule modes", () => {
  const match = {
    id: "matrix-1",
    format: "Round robin",
    matchDate: null,
    matchDateTime: null,
    rawText: "Group Stage crosstable row",
    scoreA: null,
    scoreB: null,
    teamAName: "Alpha",
    teamBName: "Beta",
  };

  assert.equal(isGeneratedScheduleMatrixRow(match), true);
  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(isAnnouncementScheduleMatch(match), false);
  assert.equal(isUploadableScheduleEntry(match), false);
});

test("format groups work for announcement rows", () => {
  const groups = buildScheduleFormatGroups([
    {
      id: "announcement-bo3",
      format: "Best of 3",
      matchDateTime: "May 23, 2026",
      teamAName: "Alpha",
      teamBName: "Beta",
    },
    {
      id: "announcement-bo1",
      format: "BO1",
      matchDateTime: "May 24, 2026",
      teamAName: "Gamma",
      teamBName: "Delta",
    },
  ]);

  assert.deepEqual(groups.map((group) => group.format), ["BO1", "BO3"]);
  assert.deepEqual(groups.map((group) => group.matches.length), [1, 1]);
});
