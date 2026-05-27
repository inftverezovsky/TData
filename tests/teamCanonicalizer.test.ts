import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTeamNameCanonicalizer,
  canonicalizeMatchTeams,
  canonicalizeParticipants,
  getTeamAliasKey,
} from "../src/lib/teams/canonicalize";
import { collectTournamentTeamNames } from "../src/lib/teams/tournamentTeamNames";
import { buildTeamMappingLookup, findTeamMapping } from "../src/lib/teams/mappingLookup";
import { isPlaceholderTeam } from "../src/lib/teams/teams";
import {
  findClosestPlatformTeamFromCandidates,
  getNameMatchScore,
} from "../src/lib/teams/fuzzyMatch";

test("G2 is treated as a real team, not a bracket seed", () => {
  assert.equal(isPlaceholderTeam("G2"), false);
  assert.equal(isPlaceholderTeam("A1"), true);
  assert.equal(isPlaceholderTeam("#8"), true);
  assert.equal(isPlaceholderTeam("#10"), true);
  assert.equal(isPlaceholderTeam("{{TeamOpponent"), true);
  assert.equal(isPlaceholderTeam("-->"), true);
  assert.equal(isPlaceholderTeam("→"), true);
  assert.equal(isPlaceholderTeam("Group B 2nd Place"), true);
  assert.equal(isPlaceholderTeam("Loser of Semifinal 1"), true);
});

test("team canonicalizer prefers the full participant name for short Liquipedia labels", () => {
  const canonicalizer = buildTeamNameCanonicalizer({
    participants: [
      { name: "G2" },
      { name: "G2 Esports" },
      { name: "The MongolZ" },
    ],
  });

  assert.equal(canonicalizer.canonicalizeName("G2"), "G2 Esports");
  assert.equal(canonicalizer.canonicalizeName("MongolZ"), "The MongolZ");
});

test("team canonicalizer uses manual mapping aliases and canonical names", () => {
  const canonicalizer = buildTeamNameCanonicalizer({
    mappings: [
      {
        liquipediaName: "Vitality",
        canonicalName: "Team Vitality",
        alias: "VIT, vita",
        platformId: "123",
      },
    ],
  });

  assert.equal(canonicalizer.canonicalizeName("VIT"), "Team Vitality");
  assert.equal(canonicalizer.canonicalizeName("Vitality"), "Team Vitality");
});

test("team canonicalizer extracts display aliases from wiki links", () => {
  const canonicalizer = buildTeamNameCanonicalizer({
    participants: [
      {
        name: "Team Vitality",
        rawText: "[[Team:Team Vitality|Vitality]]",
      },
    ],
  });

  assert.equal(canonicalizer.canonicalizeName("Vitality"), "Team Vitality");
});

test("team canonicalizer does not collapse ambiguous short aliases", () => {
  const canonicalizer = buildTeamNameCanonicalizer({
    participants: [
      { name: "Team One" },
      { name: "One Move" },
    ],
  });

  assert.equal(canonicalizer.canonicalizeName("One"), "One");
});

test("canonicalizeMatchTeams updates generated team ids after name merge", () => {
  const canonicalizer = buildTeamNameCanonicalizer({
    participants: [
      { name: "G2 Esports" },
    ],
  });

  const match = canonicalizeMatchTeams({
    teamAName: "G2",
    teamAId: "team_g2",
    teamBName: "9z Team",
  }, canonicalizer);

  assert.equal(match.teamAName, "G2 Esports");
  assert.equal(match.teamAId, "team_g2-esports");
  assert.equal(match.teamBName, "9z Team");
});

test("canonicalizeParticipants merges short and long participant rows", () => {
  const canonicalizer = buildTeamNameCanonicalizer({
    participants: [
      { name: "G2" },
      { name: "G2 Esports" },
    ],
  });

  const participants = canonicalizeParticipants([
    { name: "G2", platformId: "1" },
    { name: "G2 Esports", logoUrl: "https://example.test/g2.png" },
  ], canonicalizer);

  assert.equal(participants.length, 1);
  assert.equal(participants[0].name, "G2 Esports");
  assert.equal(participants[0].platformId, "1");
  assert.equal(participants[0].logoUrl, "https://example.test/g2.png");
});

test("getTeamAliasKey removes low-value suffixes without touching qualifiers", () => {
  assert.equal(getTeamAliasKey("G2 Esports"), "g2");
  assert.equal(getTeamAliasKey("The MongolZ"), "mongolz");
  assert.equal(getTeamAliasKey("NAVI Junior"), "navi junior");
});

test("collectTournamentTeamNames hides stale one-letter aliases when full names exist", () => {
  const names = collectTournamentTeamNames({
    matches: [
      { teamAName: "The MongolZ", teamBName: "G2" },
      { teamAName: "K27", teamBName: "magic" },
    ],
    participants: [
      { name: "The MongolZ" },
      { name: "G2" },
      { name: "G" },
      { name: "K27" },
      { name: "K" },
      { name: "magic" },
    ],
  });

  assert.deepEqual(names, ["G2", "K27", "magic", "The MongolZ"]);
});

test("collectTournamentTeamNames exposes mappable TBD names but hides bracket placeholders", () => {
  const names = collectTournamentTeamNames({
    matches: [
      { teamAName: "Vitality", teamBName: "TBD" },
      { teamAName: "TBD1", teamBName: "TBD2" },
      { teamAName: "Winner of Match 1", teamBName: "A1" },
    ],
    participants: [],
  });

  assert.deepEqual(names, ["TBD", "TBD1", "TBD2", "Vitality"]);
});

test("collectTournamentTeamNames exposes sourced stage announcements instead of pure TBD pairs", () => {
  for (const source of ["liquipedia", "hltv", "dltv", "fandom", "vlr"] as const) {
    const names = collectTournamentTeamNames({
      disciplineSlug: "counterstrike",
      source,
      matches: [
        { teamAName: "TBD1", teamBName: "TBD2", stage: "Blast Slam 7 Group Stage", matchDate: new Date("2026-06-04T09:00:00.000Z") },
        { teamAName: "TBD3", teamBName: "TBD4", round: "Blast Slam 7 Losers' Round 1", matchDate: new Date("2026-06-05T09:00:00.000Z") },
        { teamAName: "Monte", teamBName: "TBD" },
      ],
      participants: [],
    });

    assert.deepEqual(names, ["Group Stage", "Losers' Round 1", "Monte", "TBD"], source);
  }
});

test("collectTournamentTeamNames exposes beach placeholder stages instead of winner placeholders", () => {
  for (const source of ["volleyballworld", "beachvolleyru", "germanbeachtour"] as const) {
    const names = collectTournamentTeamNames({
      disciplineSlug: "beachvolleyball",
      source,
      matches: [
        {
          teamAName: "S. H. Kan/C. H. Lee",
          teamBName: "Winner of match 2",
          round: "Quarter-finals",
          matchDate: new Date("2026-05-28T06:20:00.000Z"),
          matchDateTime: "28.05.2026 09:20:00",
          hasPlaceholderTeams: true,
        },
        {
          teamAName: "Winner of match 7",
          teamBName: "LI Xiaokai /MAO Yuan",
          round: "Semi-finals",
          matchDate: new Date("2026-05-28T08:00:00.000Z"),
          matchDateTime: "28.05.2026 11:00:00",
          hasPlaceholderTeams: true,
        },
        {
          teamAName: "Winner of match 39",
          teamBName: "Winner of match 40",
          round: "Quarter-finals",
          rawText: "Quarter-finals Winner of match 39 vs Winner of match 40",
          matchDate: new Date("2026-05-31T13:00:00.000Z"),
          matchDateTime: "31.05.2026 16:00:00",
          hasPlaceholderTeams: true,
        },
      ],
      participants: [],
    });

    assert.equal(names.includes("Winner of match 2"), false, source);
    assert.equal(names.includes("Winner of match 7"), false, source);
    assert.equal(names.includes("S. H. Kan/C. H. Lee"), true, source);
    assert.equal(names.includes("LI Xiaokai /MAO Yuan"), true, source);
    assert.equal(names.includes("Quarterfinals"), true, source);
    assert.equal(names.includes("Semifinals"), true, source);
    assert.equal(names.includes("Winner of match 39"), false, source);
    assert.equal(names.includes("Winner of match 40"), false, source);
  }
});

test("collectTournamentTeamNames hides sourced stage announcements without exact time", () => {
  const names = collectTournamentTeamNames({
    disciplineSlug: "counterstrike",
    source: "liquipedia",
    matches: [
      {
        teamAName: "TBD1",
        teamBName: "TBD2",
        round: "Round of 16",
        rawText: "slot=R1M1 TBD vs TBD Best of 3",
        matchDate: null,
        matchDateTime: null,
        hasPlaceholderTeams: true,
      },
      {
        teamAName: "TBD3",
        teamBName: "TBD4",
        round: "Quarterfinals",
        rawText: "slot=QF TBD vs TBD Best of 3",
        matchDateTime: "May 31, 2026",
        hasPlaceholderTeams: true,
      },
    ],
    participants: [],
  });

  assert.deepEqual(names, []);
});

test("collectTournamentTeamNames exposes sourced fallback stage labels instead of numbered TBD", () => {
  const names = collectTournamentTeamNames({
    disciplineSlug: "counterstrike",
    source: "hltv",
    matches: [
      {
        teamAName: "TBD1",
        teamBName: "TBD2",
        rawText: "21:00 bo3 Winline MPKBK CIS LAN Season 5 - Group D Winners' Match",
        matchDate: new Date("2026-05-26T18:55:00.000Z"),
        hasPlaceholderTeams: true,
      },
      {
        teamAName: "TBD3",
        teamBName: "TBD4",
        rawText: "TBD vs TBD BO3",
        matchDate: new Date("2026-05-26T20:55:00.000Z"),
        hasPlaceholderTeams: true,
      },
    ],
    participants: [],
  });

  assert.deepEqual(names, ["Group Stage"]);
});

test("collectTournamentTeamNames keeps numbered TBD mapping names when source is unknown", () => {
  const names = collectTournamentTeamNames({
    disciplineSlug: "dota2",
    matches: [
      { teamAName: "TBD1", teamBName: "TBD2", stage: "Blast Slam 7 Group Stage" },
    ],
    participants: [],
  });

  assert.deepEqual(names, ["TBD1", "TBD2"]);
});

test("collectTournamentTeamNames exposes common fallback labels for sourced bracket placeholders", () => {
  const names = collectTournamentTeamNames({
    disciplineSlug: "counterstrike",
    source: "liquipedia",
    matches: [
      {
        teamAName: "TBD",
        teamBName: "-->",
        rawText: "slot=R2M2\n{{Match|opponent1=TBD|opponent2=-->|date=May 29, 2026 - 15:55 CEST}}",
        matchDate: new Date("2026-05-29T13:55:00.000Z"),
      },
    ],
    participants: [],
  });

  assert.deepEqual(names, ["Group Stage"]);
});

test("team mapping lookup prefers saved platform IDs over stale unmapped duplicates", () => {
  const lookup = buildTeamMappingLookup([
    {
      liquipediaName: "spirit",
      platformId: null,
      status: "unmapped",
    },
    {
      liquipediaName: "Spirit",
      canonicalName: "Team Spirit",
      platformId: "257215",
      status: "manual_mapped",
      isManual: true,
    },
  ]);

  assert.equal(findTeamMapping(lookup, "Spirit")?.platformId, "257215");
  assert.equal(findTeamMapping(lookup, "Team Spirit")?.platformId, "257215");
});

test("fuzzy platform matching accepts swapped Russian first and last names", () => {
  assert.equal(getNameMatchScore("Волин Лев", "Лев Волин"), 1);

  const match = findClosestPlatformTeamFromCandidates(
    [
      {
        platformId: "1001",
        platformName: "Лев Волин",
        normalizedName: "лев волин",
      },
      {
        platformId: "1002",
        platformName: "Арсений Гусев",
        normalizedName: "арсений гусев",
      },
    ],
    "Волин Лев",
    0.9
  );

  assert.equal(match?.platformId, "1001");
});

test("fuzzy platform matching accepts safe esports generic prefixes and suffixes", () => {
  const candidates = [
    { platformId: "1", platformName: "Team Liquid", normalizedName: "team liquid" },
    { platformId: "2", platformName: "Sharks Esports", normalizedName: "sharks esports" },
    { platformId: "3", platformName: "SINNERS Esports", normalizedName: "sinners esports" },
    { platformId: "4", platformName: "Lynn Vision", normalizedName: "lynn vision" },
    { platformId: "5", platformName: "G2 Esports", normalizedName: "g2 esports" },
  ];

  assert.equal(findClosestPlatformTeamFromCandidates(candidates, "Liquid", 0.9)?.platformId, "1");
  assert.equal(findClosestPlatformTeamFromCandidates(candidates, "Sharks", 0.9)?.platformId, "2");
  assert.equal(findClosestPlatformTeamFromCandidates(candidates, "SINNERS", 0.9)?.platformId, "3");
  assert.equal(findClosestPlatformTeamFromCandidates(candidates, "Lynn Vision Gaming", 0.9)?.platformId, "4");
  assert.equal(findClosestPlatformTeamFromCandidates(candidates, "G2", 0.9)?.platformId, "5");
});

test("fuzzy platform matching does not collapse qualifier rosters into main teams", () => {
  assert.equal(
    findClosestPlatformTeamFromCandidates(
      [{ platformId: "1", platformName: "MIBR Academy", normalizedName: "mibr academy" }],
      "MIBR",
      0.9
    ),
    null
  );
  assert.equal(
    findClosestPlatformTeamFromCandidates(
      [{ platformId: "2", platformName: "Team One", normalizedName: "team one" }],
      "One",
      0.9
    ),
    null
  );
});
