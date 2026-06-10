import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleCourtGroups,
  buildScheduleFormatGroups,
  buildTbdAnnouncementSelectionId,
  expandScheduleAnnouncements,
  expandScheduleAnnouncementsForDiscipline,
  getStageSlotAnnouncementLabel,
  getUploadableTbdAnnouncementSides,
  isAnnouncementScheduleMatch,
  isDisplayableScheduleMatch,
  isGeneratedScheduleMatrixRow,
  isScheduleMatchInUpcomingWindow,
  isUploadableScheduleEntry,
  isUploadReadyScheduleMatch,
  parseScheduleSelectionId,
  resolveStageSlotAnnouncement,
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

test("date-only schedule rows are visible but not uploadable", () => {
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

  assert.equal(isDisplayableScheduleMatch(match), true);
  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(isAnnouncementScheduleMatch(match), false);
  assert.equal(isUploadableScheduleEntry(match), false);
});

test("finished schedule rows are hidden from display and upload", () => {
  const match = {
    id: "finished-1",
    matchDate: new Date("2026-06-10T10:00:00.000Z"),
    matchDateTime: "10.06.2026 13:00:00",
    rawText: "Alpha vs Beta",
    scoreA: null,
    scoreB: null,
    status: "Official",
    teamAName: "Alpha",
    teamBName: "Beta",
  };

  assert.equal(isDisplayableScheduleMatch(match), false);
  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(isAnnouncementScheduleMatch(match), false);
  assert.equal(isUploadableScheduleEntry(match), false);
});

test("date-only placeholder announcements stay hidden until exact time appears", () => {
  const match = {
    id: "date-only-placeholder",
    matchDate: new Date("2026-05-31T00:00:00.000Z"),
    matchDateTime: "May 31, 2026",
    rawText: "TBD vs TBD Grand Final",
    scoreA: null,
    scoreB: null,
    teamAName: "TBD1",
    teamBName: "TBD2",
    round: "Grand Final",
    hasPlaceholderTeams: true,
  };

  assert.equal(isDisplayableScheduleMatch(match), false);
  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(isAnnouncementScheduleMatch(match), false);
  assert.equal(isUploadableScheduleEntry(match, { disciplineSlug: "dota2", source: "liquipedia" }), false);
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

test("court groups sort numbered beach volleyball courts naturally", () => {
  const groups = buildScheduleCourtGroups([
    {
      id: "beach-court-2-a",
      court: "Court 2",
      matchDateTime: "May 24, 2026",
      teamAName: "Alpha",
      teamBName: "Beta",
    },
    {
      id: "beach-no-court",
      court: null,
      matchDateTime: "May 24, 2026",
      teamAName: "Gamma",
      teamBName: "Delta",
    },
    {
      id: "beach-court-1",
      court: "Court 1",
      matchDateTime: "May 24, 2026",
      teamAName: "Echo",
      teamBName: "Foxtrot",
    },
    {
      id: "beach-court-2-b",
      court: "Court 2",
      matchDateTime: "May 24, 2026",
      teamAName: "Golf",
      teamBName: "Hotel",
    },
  ]);

  assert.deepEqual(groups.map((group) => group.court), ["Court 1", "Court 2", "Без корта"]);
  assert.deepEqual(groups.map((group) => group.matches.length), [1, 2, 1]);
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
    ["beachvolleyball", "volleyballworld"],
    ["beachvolleyball", "beachvolleyru"],
    ["beachvolleyball", "germanbeachtour"],
    ["beachvolleyball", "twelvendrcsvp"],
    ["beachvolleyball", "twelvendroevv"],
    ["beachvolleyball", "cbv"],
    ["beachvolleyball", "federvolley"],
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

test("VolleyballWorld winner/loser placeholders render as one stage announcement", () => {
  const cases = [
    {
      matchId: "volleyballworld-8974-525029",
      teamAName: "Winner of match 39",
      teamBName: "Winner of match 40",
      round: "Quarter-finals",
      expected: "Quarterfinals",
    },
    {
      matchId: "volleyballworld-8974-525033",
      teamAName: "Winner of match 47",
      teamBName: "Winner of match 48",
      round: "Semi-finals",
      expected: "Semifinals",
    },
    {
      matchId: "volleyballworld-8974-525035",
      teamAName: "Loser of match 51",
      teamBName: "Loser of match 52",
      round: "3rd place match",
      expected: "Third Place Match",
    },
  ];

  for (const item of cases) {
    const entries = expandScheduleAnnouncementsForDiscipline([{
      id: item.matchId,
      matchId: item.matchId,
      matchDate: new Date("2026-05-31T13:00:00.000Z"),
      matchDateTime: "31.05.2026 16:00:00",
      rawText: `${item.round} ${item.teamAName} vs ${item.teamBName}`,
      scoreA: null,
      scoreB: null,
      format: null,
      stage: "Main Draw",
      round: item.round,
      teamAName: item.teamAName,
      teamBName: item.teamBName,
      hasPlaceholderTeams: true,
    }], "beachvolleyball", "volleyballworld");

    assert.equal(entries.length, 1, item.expected);
    assert.equal(entries[0].isStageAnnouncement, true, item.expected);
    assert.equal(entries[0].singleAnnouncementTeamName, item.expected);
    assert.equal(entries[0].selectionId, buildTbdAnnouncementSelectionId(item.matchId, "stage"));
  }
});

test("beach volleyball winner placeholders with one known team render as stage announcements", () => {
  for (const source of ["volleyballworld", "beachvolleyru", "germanbeachtour", "twelvendrcsvp", "twelvendroevv", "cbv", "federvolley"] as const) {
    const matches = [
      {
        id: `${source}-winner-team-b-row`,
        matchId: `${source}-winner-team-b`,
        matchDate: new Date("2026-05-28T06:20:00.000Z"),
        matchDateTime: "28.05.2026 09:20:00",
        rawText: "S. H. Kan/C. H. Lee vs Winner of match 2",
        scoreA: null,
        scoreB: null,
        format: null,
        stage: "Main Draw",
        round: "Quarter-finals",
        teamAName: "S. H. Kan/C. H. Lee",
        teamBName: "Winner of match 2",
        hasPlaceholderTeams: true,
      },
      {
        id: `${source}-winner-team-a-row`,
        matchId: `${source}-winner-team-a`,
        matchDate: new Date("2026-05-28T08:00:00.000Z"),
        matchDateTime: "28.05.2026 11:00:00",
        rawText: "Winner of match 7 vs LI Xiaokai /MAO Yuan",
        scoreA: null,
        scoreB: null,
        format: null,
        stage: "Main Draw",
        round: "Semi-finals",
        teamAName: "Winner of match 7",
        teamBName: "LI Xiaokai /MAO Yuan",
        hasPlaceholderTeams: true,
      },
    ];

    assert.equal(isUploadReadyScheduleMatch(matches[0]), false, source);
    assert.equal(isAnnouncementScheduleMatch(matches[0], { disciplineSlug: "beachvolleyball", source }), true, source);
    assert.equal(isUploadableScheduleEntry(matches[0], { disciplineSlug: "beachvolleyball", source }), true, source);
    assert.deepEqual(getUploadableTbdAnnouncementSides(matches[0], { disciplineSlug: "beachvolleyball", source }), ["stage"], source);

    const entries = expandScheduleAnnouncementsForDiscipline(matches, "beachvolleyball", source);

    assert.equal(entries.length, 2, source);
    assert.deepEqual(entries.map((entry) => entry.singleAnnouncementSide), ["stage", "stage"], source);
    assert.deepEqual(entries.map((entry) => entry.singleAnnouncementTeamName), ["Quarterfinals", "Semifinals"], source);
    assert.deepEqual(entries.map((entry) => entry.selectionId), [
      buildTbdAnnouncementSelectionId(`${source}-winner-team-b`, "stage"),
      buildTbdAnnouncementSelectionId(`${source}-winner-team-a`, "stage"),
    ], source);
    assert.equal(entries.every((entry) => entry.isSingleTeamAnnouncement), true, source);
    assert.equal(entries.every((entry) => entry.isStageAnnouncement), true, source);
    assert.equal(entries.every((entry) => isUploadableScheduleEntry(entry, { disciplineSlug: "beachvolleyball", source })), true, source);
  }
});

test("beach volleyball single winner placeholder falls back to stage label without explicit round", () => {
  const entries = expandScheduleAnnouncementsForDiscipline([{
    id: "volleyballworld-winner-fallback-row",
    matchId: "volleyballworld-winner-fallback",
    matchDate: new Date("2026-05-28T06:20:00.000Z"),
    matchDateTime: "28.05.2026 09:20:00",
    rawText: "S. H. Kan/C. H. Lee vs Winner of match 2",
    scoreA: null,
    scoreB: null,
    format: null,
    stage: null,
    round: null,
    teamAName: "S. H. Kan/C. H. Lee",
    teamBName: "Winner of match 2",
    hasPlaceholderTeams: true,
  }], "beachvolleyball", "volleyballworld");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].isStageAnnouncement, true);
  assert.equal(entries[0].singleAnnouncementTeamName, "Playoffs");
  assert.equal(entries[0].selectionId, buildTbdAnnouncementSelectionId("volleyballworld-winner-fallback", "stage"));
});

test("HLTV group placeholder rows render as one common stage announcement", () => {
  const match = {
    id: "hltv-group-row",
    matchId: "hltv-2394635",
    matchDate: new Date("2026-05-26T18:55:00.000Z"),
    matchDateTime: null,
    rawText: "21:00 bo3 Winline MPKBK CIS LAN Season 5 - Group D Winners' Match",
    scoreA: null,
    scoreB: null,
    format: "BO3",
    teamAName: "TBD1",
    teamBName: "TBD2",
    hasPlaceholderTeams: true,
  };
  const entries = expandScheduleAnnouncementsForDiscipline([
    match,
  ], "counterstrike", "hltv");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].isStageAnnouncement, true);
  assert.equal(entries[0].isStageAnnouncementFallback, false);
  assert.equal(entries[0].singleAnnouncementSide, "stage");
  assert.equal(entries[0].singleAnnouncementTeamName, "Group Stage");
  assert.equal(entries[0].selectionId, buildTbdAnnouncementSelectionId("hltv-2394635", "stage"));
  assert.equal(entries.some((entry) => /^TBD\d*$/i.test(entry.singleAnnouncementTeamName || "")), false);
  assert.deepEqual(resolveStageSlotAnnouncement(match, { disciplineSlug: "counterstrike", source: "hltv" }), {
    side: "stage",
    label: "Group Stage",
    isFallback: false,
  });
});

test("sourced stage announcement resolver requires two named placeholder sides", () => {
  const baseMatch = {
    id: "missing-placeholder-side",
    matchId: "missing-placeholder-side",
    matchDate: new Date("2026-06-04T09:00:00.000Z"),
    rawText: "TBD vs TBD BO3",
    scoreA: null,
    scoreB: null,
    hasPlaceholderTeams: true,
  };

  for (const match of [
    { ...baseMatch, teamAName: null, teamBName: null },
    { ...baseMatch, teamAName: null, teamBName: "TBD1" },
    { ...baseMatch, teamAName: "TBD1", teamBName: "" },
  ]) {
    assert.equal(resolveStageSlotAnnouncement(match, { disciplineSlug: "counterstrike", source: "hltv" }), null);
    assert.deepEqual(expandScheduleAnnouncementsForDiscipline([match], "counterstrike", "hltv"), []);
  }
});

test("sourced placeholder fallback rows never split into numbered TBD announcements", () => {
  for (const source of ["liquipedia", "hltv", "dltv", "fandom", "vlr"] as const) {
    const entries = expandScheduleAnnouncementsForDiscipline([
      {
        id: `${source}-fallback-row`,
        matchId: `${source}-fallback-match`,
        matchDate: new Date("2026-06-04T09:00:00.000Z"),
        rawText: "TBD vs TBD BO3",
        scoreA: null,
        scoreB: null,
        teamAName: "TBD1",
        teamBName: "TBD2",
        hasPlaceholderTeams: true,
      },
    ], "counterstrike", source);

    assert.equal(entries.length, 1, source);
    assert.equal(entries[0].isStageAnnouncement, true, source);
    assert.equal(entries[0].isStageAnnouncementFallback, true, source);
    assert.equal(entries[0].singleAnnouncementTeamName, "Group Stage", source);
    assert.equal(entries.some((entry) => /^TBD\d*$/i.test(entry.singleAnnouncementTeamName || "")), false, source);
  }
});

test("seed and arrow bracket placeholders render as stage announcements, not matches", () => {
  const cases = [
    {
      teamAName: "Group B 2nd Place",
      teamBName: "Group A 3rd Place",
      round: "Quarterfinals",
      expected: "Quarterfinals",
    },
    {
      teamAName: "TBD",
      teamBName: "-->",
      round: "Semifinals",
      expected: "Semifinals",
    },
    {
      teamAName: "Loser of Semifinal 1",
      teamBName: "Loser of Semifinal 2",
      round: "Third Place Match",
      expected: "Third Place Match",
    },
  ];

  for (const item of cases) {
    const match = {
      id: `seed-row-${item.expected}`,
      matchId: `seed-match-${item.expected}`,
      matchDate: new Date("2026-05-29T13:55:00.000Z"),
      matchDateTime: "May 29, 2026 - 15:55 CEST",
      rawText: `${item.round} ${item.teamAName} vs ${item.teamBName} BO3`,
      scoreA: null,
      scoreB: null,
      format: "BO3",
      hasPlaceholderTeams: true,
      ...item,
    };

    assert.equal(isUploadReadyScheduleMatch(match), false, item.expected);
    const entries = expandScheduleAnnouncementsForDiscipline([match], "counterstrike", "liquipedia");
    assert.equal(entries.length, 1, item.expected);
    assert.equal(entries[0].isStageAnnouncement, true, item.expected);
    assert.equal(entries[0].singleAnnouncementTeamName, item.expected);
    assert.deepEqual(getUploadableTbdAnnouncementSides(entries[0], { disciplineSlug: "counterstrike", source: "liquipedia" }), ["stage"]);
    assert.equal(isUploadableScheduleEntry(entries[0], { disciplineSlug: "counterstrike", source: "liquipedia" }), true);
  }
});

test("sourced bracket placeholder pairs without a recovered round use a common stage fallback", () => {
  const match = {
    id: "missing-round-arrow-row",
    matchId: "missing-round-arrow-match",
    matchDate: new Date("2026-05-29T13:55:00.000Z"),
    matchDateTime: "May 29, 2026 - 15:55 CEST",
    rawText: "slot=R2M2\n{{Match|opponent1=TBD|opponent2=-->|date=May 29, 2026 - 15:55 CEST}}",
    scoreA: null,
    scoreB: null,
    format: "BO3",
    hasPlaceholderTeams: true,
    teamAName: "TBD",
    teamBName: "-->",
  };

  const entries = expandScheduleAnnouncementsForDiscipline([match], "counterstrike", "liquipedia");

  assert.equal(isUploadReadyScheduleMatch(match), false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].isStageAnnouncement, true);
  assert.equal(entries[0].isStageAnnouncementFallback, true);
  assert.equal(entries[0].singleAnnouncementTeamName, "Group Stage");
  assert.deepEqual(getUploadableTbdAnnouncementSides(entries[0], { disciplineSlug: "counterstrike", source: "liquipedia" }), ["stage"]);
  assert.equal(isUploadableScheduleEntry(entries[0], { disciplineSlug: "counterstrike", source: "liquipedia" }), true);
});

test("Liquipedia stage placeholders without exact time stay hidden", () => {
  const entries = expandScheduleAnnouncementsForDiscipline([
    {
      id: "liquipedia-no-time-stage-row",
      matchId: "liquipedia-no-time-stage-1",
      matchDate: null,
      matchDateTime: null,
      rawText: "slot=R1M1 TBD vs TBD Best of 3",
      scoreA: null,
      scoreB: null,
      format: "BO3",
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Round 1 Matches",
      hasPlaceholderTeams: true,
    },
  ], "counterstrike", "liquipedia");

  assert.deepEqual(entries, []);
});

test("sourced stage announcements keep explicit midnight times", () => {
  const entries = expandScheduleAnnouncementsForDiscipline([
    {
      id: "liquipedia-midnight-stage-row",
      matchId: "liquipedia-midnight-stage-1",
      matchDate: new Date("2026-06-04T00:00:00.000Z"),
      matchDateTime: "June 4, 2026 - 00:00 UTC",
      rawText: "{{Match|opponent1=TBD|opponent2=TBD|date=June 4, 2026 - 00:00 UTC}}",
      scoreA: null,
      scoreB: null,
      format: "BO3",
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Quarterfinals",
      hasPlaceholderTeams: true,
    },
  ], "counterstrike", "liquipedia");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].isStageAnnouncement, true);
  assert.equal(entries[0].singleAnnouncementTeamName, "Quarterfinals");
  assert.equal(isUploadableScheduleEntry(entries[0], { disciplineSlug: "counterstrike", source: "liquipedia" }), true);
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

test("sourced TBD-vs-TBD slots without explicit stage use a common stage fallback", () => {
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

  assert.equal(entries.length, 1);
  assert.equal(entries[0].isStageAnnouncement, true);
  assert.equal(entries[0].isStageAnnouncementFallback, true);
  assert.equal(entries[0].singleAnnouncementTeamName, "Group Stage");
  assert.equal(entries[0].selectionId, buildTbdAnnouncementSelectionId("liquipedia-placeholder-1", "stage"));
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
  const noTimeEntries = expandScheduleAnnouncementsForDiscipline([{ ...baseMatch, matchDate: null }], "counterstrike", "hltv");
  assert.deepEqual(noTimeEntries, []);
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
      round: "Lower Bracket Semifinal",
    }),
    "Lower Bracket Semifinal",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Grand Final",
    }),
    "Grand Final",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "3rd Place Match",
    }),
    "Third Place Match",
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
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Stage 2 (Bracket)",
    }),
    "Stage 2",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "Play-In Day 1",
    }),
    "Play-In Day 1",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "Play In Stage",
    }),
    "Play-In",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Bracket Round 2",
    }),
    "Bracket Round 2",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      rawText: "21:00 bo3 Winline MPKBK CIS LAN Season 5 - Group D Winners' Match",
    }),
    "Group Stage",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Quarter-final #1",
    }),
    "Quarterfinals",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "Semi-final #2",
    }),
    "Semifinals",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      round: "3rd Place Decider Match",
    }),
    "Third Place Match",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "Swiss Stage: Round 2 (1-0)",
    }),
    "Group Stage",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "Round 2 High Matches",
    }),
    "Group Stage",
  );
  assert.equal(
    getStageSlotAnnouncementLabel({
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "Playoffs: Lower Round 3",
    }),
    "Playoffs",
  );
});

test("League of Legends sourced stage slots never split into numbered TBD announcements", () => {
  const entries = expandScheduleAnnouncementsForDiscipline([
    {
      id: "lol-fandom-playin-row",
      matchId: "lol-fandom-playin-1",
      matchDate: new Date("2026-06-28T03:00:00.000Z"),
      matchDateTime: "2026-06-28 03:00:00",
      rawText: "TBD vs TBD Play-In Day 1 Best of 5",
      scoreA: null,
      scoreB: null,
      format: "BO5",
      teamAName: "TBD1",
      teamBName: "TBD2",
      stage: "Play-In Day 1",
      round: "Match Day 1",
      hasPlaceholderTeams: true,
    },
  ], "leagueoflegends", "fandom");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].isStageAnnouncement, true);
  assert.equal(entries[0].singleAnnouncementSide, "stage");
  assert.equal(entries[0].singleAnnouncementTeamName, "Play-In Day 1");
  assert.equal(entries.some((entry) => /^TBD\d*$/i.test(entry.singleAnnouncementTeamName || "")), false);
});

test("schedule view window keeps only matches in the nearest month", () => {
  const window = { fromDate: "2026-05-27", toDate: "2026-06-27" };

  assert.equal(
    isScheduleMatchInUpcomingWindow({ matchDate: new Date("2026-06-04T14:00:00.000Z") }, window),
    true,
  );
  assert.equal(
    isScheduleMatchInUpcomingWindow({ matchDate: new Date("2026-05-24T14:00:00.000Z") }, window),
    false,
  );
  assert.equal(
    isScheduleMatchInUpcomingWindow({ matchDate: new Date("2026-07-02T14:00:00.000Z") }, window),
    false,
  );
});

test("German Beach Tour TBD slots render as stage announcements", () => {
  const entries = expandScheduleAnnouncementsForDiscipline([
    {
      id: "gbt-berlin-slot",
      matchId: "germanbeachtour-14684-men-14684-1-1",
      matchDate: new Date("2026-06-04T14:00:00.000Z"),
      matchDateTime: "04.06.2026 17:00:00",
      rawText: "Hauptfeld | Achtelfinale Winner | TBD vs TBD",
      scoreA: null,
      scoreB: null,
      format: null,
      teamAName: "TBD",
      teamBName: "TBD",
      stage: "Hauptfeld",
      round: "Achtelfinale Winner",
      hasPlaceholderTeams: true,
    },
  ], "beachvolleyball", "germanbeachtour");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].isStageAnnouncement, true);
  assert.equal(entries[0].singleAnnouncementSide, "stage");
  assert.equal(entries[0].singleAnnouncementTeamName, "Achtelfinale Winner");
});

test("Draw vs Draw rows render as stage announcements across stage-aware sources", () => {
  const cases = [
    ["counterstrike", "liquipedia"],
    ["counterstrike", "hltv"],
    ["dota2", "dltv"],
    ["leagueoflegends", "fandom"],
    ["valorant", "vlr"],
    ["beachvolleyball", "volleyballworld"],
    ["beachvolleyball", "beachvolleyru"],
    ["beachvolleyball", "germanbeachtour"],
    ["beachvolleyball", "twelvendrcsvp"],
    ["beachvolleyball", "twelvendroevv"],
    ["beachvolleyball", "cbv"],
    ["beachvolleyball", "federvolley"],
  ] as const;

  for (const [disciplineSlug, source] of cases) {
    const match = {
      id: `${source}-draw-row`,
      matchId: `${source}-draw-match`,
      matchDate: new Date("2026-05-30T00:00:00.000Z"),
      matchDateTime: "30.05.2026 03:00:00",
      rawText: "Main Draw | Draw vs Draw",
      scoreA: null,
      scoreB: null,
      teamAName: "Draw",
      teamBName: "Draw",
      stage: "Main Draw",
      round: null,
      hasPlaceholderTeams: false,
    };

    assert.equal(isUploadReadyScheduleMatch(match), false, source);
    assert.equal(isDisplayableScheduleMatch(match), false, source);
    assert.equal(isAnnouncementScheduleMatch(match, { disciplineSlug, source }), true, source);
    assert.deepEqual(getUploadableTbdAnnouncementSides(match, { disciplineSlug, source }), ["stage"], source);

    const entries = expandScheduleAnnouncementsForDiscipline([match], disciplineSlug, source);
    assert.equal(entries.length, 1, source);
    assert.equal(entries[0].isStageAnnouncement, true, source);
    assert.equal(entries[0].singleAnnouncementSide, "stage", source);
    assert.equal(entries[0].singleAnnouncementTeamName, "Main Draw", source);
  }
});
