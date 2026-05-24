import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleFormatGroups,
  buildTbdAnnouncementSelectionId,
  expandScheduleAnnouncements,
  expandScheduleAnnouncementsForDiscipline,
  getStageSlotAnnouncementLabel,
  getUploadableTbdAnnouncementSides,
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

test("date-only schedule rows are hidden from schedule modes", () => {
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
  assert.equal(isAnnouncementScheduleMatch(match), false);
  assert.equal(isUploadableScheduleEntry(match), false);
});

test("exact-time matches with one real team and one TBD are upload-ready pairs", () => {
  const match = {
    id: "match-known-tbd",
    matchDate: new Date("2026-06-02T10:30:00.000Z"),
    matchDateTime: null,
    rawText: "Monte vs TBD",
    scoreA: null,
    scoreB: null,
    teamAName: "Monte",
    teamBName: "TBD",
    hasPlaceholderTeams: true,
  };

  assert.equal(isUploadReadyScheduleMatch(match), true);
  assert.equal(isAnnouncementScheduleMatch(match), false);
  assert.equal(isUploadableScheduleEntry(match), true);
  assert.deepEqual(getUploadableTbdAnnouncementSides(match), []);
  assert.deepEqual(expandScheduleAnnouncements([match]), []);
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
  assert.deepEqual(getUploadableTbdAnnouncementSides(match), ["teamA", "teamB"]);
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

test("DLTV exact-time TBD rows expand into uploadable announcements", () => {
  const entries = expandScheduleAnnouncements([
    {
      id: "dltv-db-row",
      matchId: "dltv-426647",
      matchDate: new Date("2026-06-05T09:00:00.000Z"),
      matchDateTime: "2026-06-05 09:00:00",
      rawText: "Blast Slam 7 Semifinals TBD 0 - 0 Best of 3 Предстоящие",
      scoreA: null,
      scoreB: null,
      teamAName: "TBD1",
      teamBName: "TBD2",
      hasPlaceholderTeams: true,
    },
  ]);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.selectionId), [
    buildTbdAnnouncementSelectionId("dltv-426647", "teamA"),
    buildTbdAnnouncementSelectionId("dltv-426647", "teamB"),
  ]);
  assert.equal(entries.every((entry) => isUploadableScheduleEntry(entry)), true);
});

test("all sourced TBD-vs-TBD slots render as one stage announcement", () => {
  const baseMatch = {
    id: "source-stage-row",
    matchId: "source-stage-1",
    matchDate: new Date("2026-06-04T09:00:00.000Z"),
    matchDateTime: "2026-06-04 12:00 MSK",
    rawText: "TBD vs TBD Quarterfinals Best of 3",
    scoreA: null,
    scoreB: null,
    teamAName: "TBD1",
    teamBName: "TBD2",
    stage: "Playoffs",
    round: "Quarterfinals (bo3)",
    hasPlaceholderTeams: true,
  };

  const cases = [
    ["counterstrike", "liquipedia"],
    ["counterstrike", "hltv"],
    ["dota2", "dltv"],
    ["leagueoflegends", "fandom"],
    ["valorant", "vlr"],
  ] as const;

  for (const [disciplineSlug, source] of cases) {
    const entries = expandScheduleAnnouncementsForDiscipline([baseMatch], disciplineSlug, source);

    assert.equal(entries.length, 1, source);
    assert.equal(entries[0].isStageAnnouncement, true, source);
    assert.equal(entries[0].isSingleTeamAnnouncement, true, source);
    assert.equal(entries[0].singleAnnouncementTeamName, "Quarterfinals", source);
    assert.equal(entries[0].selectionId, buildTbdAnnouncementSelectionId("source-stage-1", "stage"), source);
    assert.equal(isUploadableScheduleEntry(entries[0], { disciplineSlug, source }), true, source);
    assert.deepEqual(getUploadableTbdAnnouncementSides(entries[0], { disciplineSlug, source }), ["stage"], source);
  }
});

test("source-less TBD-vs-TBD slots keep numbered TBD announcements", () => {
  const entries = expandScheduleAnnouncementsForDiscipline([
    {
      id: "unknown-stage-row",
      matchId: "unknown-stage-1",
      matchDate: new Date("2026-06-04T09:00:00.000Z"),
      matchDateTime: "2026-06-04 12:00 MSK",
      rawText: "TBD vs TBD Quarterfinals Best of 3",
      scoreA: null,
      scoreB: null,
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "Playoffs",
      round: "Quarterfinals (bo3)",
      hasPlaceholderTeams: true,
    },
  ], "dota2");

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.singleAnnouncementTeamName), ["TBD1", "TBD2"]);
});

test("sourced TBD-vs-TBD slots without explicit stage keep numbered TBD announcements", () => {
  const entries = expandScheduleAnnouncementsForDiscipline([
    {
      id: "liquipedia-placeholder-row",
      matchId: "liquipedia-placeholder-1",
      matchDate: new Date("2026-05-30T12:00:00.000Z"),
      matchDateTime: "May 30, 2026 - 14:00 CEST",
      rawText: "{{Match|opponent1={{LiteralOpponent|#8}}|opponent2={{LiteralOpponent|#9}}|date=May 30, 2026 - 14:00 CEST}}",
      scoreA: null,
      scoreB: null,
      teamAName: "TBD1",
      teamBName: "TBD2",
      hasPlaceholderTeams: true,
    },
  ], "dota2", "liquipedia");

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.singleAnnouncementTeamName), ["TBD1", "TBD2"]);
  assert.deepEqual(entries.map((entry) => entry.selectionId), [
    buildTbdAnnouncementSelectionId("liquipedia-placeholder-1", "teamA"),
    buildTbdAnnouncementSelectionId("liquipedia-placeholder-1", "teamB"),
  ]);
  assert.equal(entries.some((entry) => entry.isStageAnnouncement), false);
});

test("Team-vs-TBD stays an uploadable normal match for stage-supporting sources", () => {
  const match = {
    id: "dota-known-tbd",
    matchDate: new Date("2026-06-04T09:00:00.000Z"),
    matchDateTime: "2026-06-04 12:00 MSK",
    rawText: "Monte vs TBD",
    scoreA: null,
    scoreB: null,
    teamAName: "Monte",
    teamBName: "TBD",
    stage: "Swiss Round 2 #1",
    hasPlaceholderTeams: true,
  };

  for (const source of ["liquipedia", "hltv", "dltv", "fandom", "vlr"] as const) {
    assert.equal(isUploadReadyScheduleMatch(match), true, source);
    assert.equal(isUploadableScheduleEntry(match, { disciplineSlug: "dota2", source }), true, source);
    assert.deepEqual(expandScheduleAnnouncementsForDiscipline([match], "dota2", source), [], source);
  }
});

test("stage slots without exact time or with results are not uploadable", () => {
  const baseMatch = {
    id: "stage-row",
    matchId: "stage-1",
    rawText: "TBD vs TBD Semifinals Best of 3",
    teamAName: "TBD1",
    teamBName: "TBD2",
    round: "Semifinals",
    hasPlaceholderTeams: true,
  };

  assert.equal(
    isUploadableScheduleEntry({ ...baseMatch, matchDate: null }, { disciplineSlug: "counterstrike", source: "hltv" }),
    false,
  );
  assert.deepEqual(
    expandScheduleAnnouncementsForDiscipline([{ ...baseMatch, matchDate: null }], "counterstrike", "hltv"),
    [],
  );
  assert.equal(
    isUploadableScheduleEntry(
      { ...baseMatch, matchDate: new Date("2026-06-04T09:00:00.000Z"), scoreA: 1, scoreB: 0 },
      { disciplineSlug: "counterstrike", source: "hltv" },
    ),
    false,
  );
});

test("stage slot labels prefer round and normalize group stage", () => {
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "DreamLeague 29 Group Stage (Round-Robin)",
    }),
    "Group Stage",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Blast Slam 7 Losers' Round 1",
    }),
    "Losers' Round 1",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "Blast Slam 7 Round of 6 TBD vs TBD Best of 3",
    }),
    "Round of 6",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "Esports World Cup 2026 Regular Season TBD vs TBD BO1",
    }),
    "Regular Season",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "League Season Week 1 TBD vs TBD BO1",
    }),
    "Week 1",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: '#8 #9 May 30, 2026 - 14:00 CEST #8 ( ) #9 Game 1 <div class="generic-label" data',
      stage: "Upper Bracket Semifinals",
    }),
    "Upper Bracket Semifinals",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "Regional Finals LCQ Round 1 TBD vs TBD BO3",
    }),
    "LCQ Round 1",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: '<div class="brkts-header">Upper Bracket Semifinals</div><div class="brkts-match">TBD vs TBD</div>',
    }),
    "Upper Bracket Semifinals",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "Advance to Playoffs TBD vs TBD",
    }),
    "To Playoff",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "TBD vs TBD BO1",
    }),
    "Group Stage",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "IEM Cologne Major 2026 Stage 2 TBD vs TBD BO1",
    }),
    "Stage 2",
  );
});
