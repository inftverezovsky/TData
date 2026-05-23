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
