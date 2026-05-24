import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminTeamSuggestions } from "../src/lib/adminTeams/suggest";

const adminTeams = [
  { platformId: "1", platformName: "Team Liquid", normalizedName: "team liquid" },
  { platformId: "2", platformName: "Liquid Echo", normalizedName: "liquid echo" },
  { platformId: "3", platformName: "Sharks Esports", normalizedName: "sharks esports" },
  { platformId: "4", platformName: "Лев Волин", normalizedName: "лев волин" },
  { platformId: "5", platformName: "武汉大学Crychic", normalizedName: "武汉大学crychic" },
  { platformId: "6", platformName: "Panda Gaming", normalizedName: "panda gaming" },
];

test("admin team suggestions rank exact matches before prefix and fuzzy matches", () => {
  const suggestions = buildAdminTeamSuggestions(adminTeams, "Team Liquid", 5);

  assert.equal(suggestions[0].platformId, "1");
  assert.equal(suggestions[0].matchType, "exact");
  assert.ok(suggestions.find((item) => item.platformId === "2"));
});

test("admin team suggestions support cyrillic and chinese names", () => {
  const cyrillic = buildAdminTeamSuggestions(adminTeams, "Волин Лев", 5);
  const chinese = buildAdminTeamSuggestions(adminTeams, "武汉", 5);

  assert.equal(cyrillic[0].platformId, "4");
  assert.equal(chinese[0].platformId, "5");
});

test("admin team suggestions return only candidates from the provided discipline set", () => {
  const dotaTeams = [{ platformId: "10", platformName: "Team Spirit", normalizedName: "team spirit" }];
  const counterStrikeTeams = [{ platformId: "20", platformName: "Spirit Academy", normalizedName: "spirit academy" }];

  assert.equal(buildAdminTeamSuggestions(dotaTeams, "Spirit", 5)[0].platformId, "10");
  assert.equal(buildAdminTeamSuggestions(counterStrikeTeams, "Spirit", 5)[0].platformId, "20");
});

test("admin team suggestions do not run matching for too-short queries", () => {
  assert.deepEqual(buildAdminTeamSuggestions(adminTeams, "G", 5), []);
});

test("admin team suggestions include broad partial and out-of-order letter matches", () => {
  const typo = buildAdminTeamSuggestions(adminTeams, "Pamd", 5);
  const missingLetters = buildAdminTeamSuggestions(adminTeams, "Pnd Gmg", 5);

  assert.equal(typo[0].platformId, "6");
  assert.equal(missingLetters[0].platformId, "6");
  assert.equal(typo[0].matchType, "fuzzy");
});

test("admin team suggestions support acronym-like queries", () => {
  const suggestions = buildAdminTeamSuggestions(adminTeams, "TL", 5);

  assert.equal(suggestions[0].platformId, "1");
});

test("admin team suggestions reject unrelated long fuzzy candidates", () => {
  const noisyTeams = [
    { platformId: "10", platformName: "Analitika Owibok Team", normalizedName: "analitika owibok team" },
    { platformId: "11", platformName: "Team Alohadance", normalizedName: "team alohadance" },
    { platformId: "12", platformName: "Wildcard Gaming", normalizedName: "wildcard gaming" },
    { platformId: "13", platformName: "GladiatorTeams", normalizedName: "gladiatorteams" },
    { platformId: "14", platformName: "HamstersHoldinTheLine", normalizedName: "hamstersholdintheline" },
  ];

  assert.deepEqual(buildAdminTeamSuggestions(noisyTeams, "Pandawa Lima", 10), []);
});
