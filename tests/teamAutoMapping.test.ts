import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoMappingPreviewFromData, isInvalidAutoMappingName } from "../src/lib/teams/mapping";
import { buildAdminTeamDisplayLookup, resolveTeamMappingDisplay } from "../src/lib/teams/mappingDisplay";

test("team mapping display prefers AdminTeam platformName over stored canonicalName", () => {
  const display = resolveTeamMappingDisplay(
    {
      liquipediaName: "Liquid",
      canonicalName: "Liquid manual",
      platformId: "211608",
      status: "manual_mapped",
    },
    buildAdminTeamDisplayLookup([{ platformId: "211608", platformName: "Team Liquid" }])
  );

  assert.equal(display.displayAdminName, "Team Liquid");
  assert.equal(display.nameSource, "admin");
});

test("team mapping display keeps manual name when platform ID is not in AdminTeam", () => {
  const display = resolveTeamMappingDisplay(
    {
      liquipediaName: "BetBoom",
      canonicalName: "BetBoom",
      platformId: "999999",
      status: "manual_mapped",
    },
    buildAdminTeamDisplayLookup([])
  );

  assert.equal(display.displayAdminName, "BetBoom");
  assert.equal(display.nameSource, "manual");
});

test("auto mapping preview separates safe, suggested, invalid, and unmapped rows without writes", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Liquid", "{{TeamOpponent", "Unknown Team", "Qwerty Squad"],
    mappings: [],
    adminTeams: [
      { platformId: "211608", platformName: "Team Liquid", normalizedName: "team liquid" },
      { platformId: "777777", platformName: "Unknowns", normalizedName: "unknowns" },
    ],
  });

  assert.equal(preview.auto.length, 1);
  assert.equal(preview.auto[0].liquipediaName, "Liquid");
  assert.equal(preview.auto[0].platformId, "211608");
  assert.equal(preview.invalid.length, 1);
  assert.equal(preview.invalid[0].liquipediaName, "{{TeamOpponent");
  assert.equal(preview.suggested.length, 1);
  assert.equal(preview.suggested[0].liquipediaName, "Unknown Team");
  assert.equal(preview.unmapped.length, 1);
  assert.equal(preview.unmapped[0].liquipediaName, "Qwerty Squad");
});

test("auto mapping accepts safe esports suffixes without collapsing academy rosters", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Sharks", "MIBR"],
    mappings: [],
    adminTeams: [
      { platformId: "328830", platformName: "Sharks Esports", normalizedName: "sharks esports" },
      { platformId: "555555", platformName: "MIBR Academy", normalizedName: "mibr academy" },
    ],
  });

  assert.equal(preview.auto.length, 1);
  assert.equal(preview.auto[0].liquipediaName, "Sharks");
  assert.equal(preview.auto[0].platformId, "328830");
  assert.equal(preview.unmapped.length, 1);
  assert.equal(preview.unmapped[0].liquipediaName, "MIBR");
});

test("auto mapping accepts 85-89 score only when candidate gap is large", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Perusic"],
    mappings: [],
    adminTeams: [
      { platformId: "101", platformName: "Perusik", normalizedName: "perusik" },
      { platformId: "102", platformName: "Completely Different", normalizedName: "completely different" },
    ],
  });

  assert.equal(preview.auto.length, 1);
  assert.equal(preview.auto[0].platformId, "101");
  assert.ok((preview.auto[0].score ?? 0) >= 85);
  assert.ok((preview.auto[0].score ?? 0) < 90);
});

test("auto mapping keeps 85+ candidates ambiguous when the gap is too small", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Perusic"],
    mappings: [],
    adminTeams: [
      { platformId: "101", platformName: "Perusik", normalizedName: "perusik" },
      { platformId: "102", platformName: "Perusig", normalizedName: "perusig" },
    ],
  });

  assert.equal(preview.auto.length, 0);
  assert.equal(preview.ambiguous.length, 1);
  assert.equal(preview.ambiguous[0].reason, "candidate_gap_too_small");
});

test("auto mapping matches English admin aliases when the primary admin name is Russian", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Abdulaziz Al Abdulla"],
    mappings: [],
    adminTeams: [
      {
        platformId: "849245",
        platformName: "Абдулазиз Аль Абдулла",
        platformNameRu: "Абдулазиз Аль Абдулла",
        platformNameEn: "Abdulaziz Al Abdulla",
        normalizedName: "абдулазиз аль абдулла",
        normalizedNameRu: "абдулазиз аль абдулла",
        normalizedNameEn: "abdulaziz al abdulla",
      },
    ],
  });

  assert.equal(preview.auto.length, 1);
  assert.equal(preview.auto[0].platformId, "849245");
});

test("auto mapping matches Russian admin aliases when the primary admin name is English", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Абдулазиз Аль Абдулла"],
    mappings: [],
    adminTeams: [
      {
        platformId: "849245",
        platformName: "Abdulaziz Al Abdulla",
        platformNameRu: "Абдулазиз Аль Абдулла",
        platformNameEn: "Abdulaziz Al Abdulla",
        normalizedName: "abdulaziz al abdulla",
        normalizedNameRu: "абдулазиз аль абдулла",
        normalizedNameEn: "abdulaziz al abdulla",
      },
    ],
  });

  assert.equal(preview.auto.length, 1);
  assert.equal(preview.auto[0].platformId, "849245");
});

test("auto mapping transliterates Cyrillic source names to English admin names", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Абдулазиз Аль Абдулла"],
    mappings: [],
    adminTeams: [
      {
        platformId: "849245",
        platformName: "Abdulaziz Al Abdulla",
        normalizedName: "abdulaziz al abdulla",
      },
    ],
  });

  assert.equal(preview.auto.length, 1);
  assert.equal(preview.auto[0].platformId, "849245");
  assert.equal(preview.auto[0].matchMethod, "translit_fuzzy");
});

test("auto mapping preview reports manual locked ID conflicts instead of overwriting", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Liquid"],
    mappings: [
      {
        liquipediaName: "Liquid",
        liquipediaNormalizedName: "liquid",
        platformId: "111111",
        canonicalName: "Manual Liquid",
        status: "manual_mapped",
        isManual: true,
        isLockedFromAutoMapping: true,
      },
    ],
    adminTeams: [{ platformId: "211608", platformName: "Team Liquid", normalizedName: "team liquid" }],
  });

  assert.equal(preview.auto.length, 0);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].existingPlatformId, "111111");
  assert.equal(preview.conflicts[0].platformId, "211608");
});

test("auto mapping reports manual locked ID conflicts only for strong matches", () => {
  const preview = buildAutoMappingPreviewFromData({
    teamNames: ["Perusic"],
    mappings: [
      {
        liquipediaName: "Perusic",
        liquipediaNormalizedName: "perusic",
        platformId: "111111",
        canonicalName: "Manual Perusic",
        status: "manual_mapped",
        isManual: true,
        isLockedFromAutoMapping: true,
      },
    ],
    adminTeams: [{ platformId: "222222", platformName: "Perusik", normalizedName: "perusik" }],
  });

  assert.equal(preview.conflicts.length, 0);
  assert.equal(preview.alreadyMappedCount, 1);
});

test("invalid auto mapping names include parser artifacts and pure numbers", () => {
  assert.equal(isInvalidAutoMappingName("-->"), true);
  assert.equal(isInvalidAutoMappingName("33"), true);
  assert.equal(isInvalidAutoMappingName("tl"), true);
  assert.equal(isInvalidAutoMappingName("G2"), false);
  assert.equal(isInvalidAutoMappingName("BIG"), false);
  assert.equal(isInvalidAutoMappingName("Group Stage"), false);
  assert.equal(isInvalidAutoMappingName("Playoffs"), false);
});
