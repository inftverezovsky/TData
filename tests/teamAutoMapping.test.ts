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

test("invalid auto mapping names include parser artifacts and pure numbers", () => {
  assert.equal(isInvalidAutoMappingName("-->"), true);
  assert.equal(isInvalidAutoMappingName("33"), true);
  assert.equal(isInvalidAutoMappingName("tl"), true);
  assert.equal(isInvalidAutoMappingName("G2"), false);
  assert.equal(isInvalidAutoMappingName("BIG"), false);
});
