import test from "node:test";
import assert from "node:assert/strict";
import { resolveManualTeamPlatformId, resolveManualTeamPlatformIdWithSource } from "../src/lib/manualImport/buildManualFixtPayload";
import {
  buildManualImportTeamMappingSavePlan,
  collectManualImportTeamMappingCandidates,
  collectSingleManualImportTeamMappingCandidate,
  normalizeAdminSportId,
} from "../src/lib/manualImport/teamMappings";

test("resolveManualTeamPlatformId gives manual import mapping priority over common team mapping", () => {
  assert.equal(
    resolveManualTeamPlatformId({
      manualMappingPlatformId: "73001",
      teamMappingPlatformId: "10001",
      adminTeamPlatformId: "20001",
    }),
    "73001"
  );
});

test("resolveManualTeamPlatformId keeps explicit row ID as highest priority", () => {
  assert.equal(
    resolveManualTeamPlatformId({
      explicitPlatformId: "999",
      manualMappingPlatformId: "73001",
      teamMappingPlatformId: "10001",
      adminTeamPlatformId: "20001",
    }),
    "999"
  );
});

test("resolveManualTeamPlatformIdWithSource marks saved manual mappings", () => {
  assert.deepEqual(
    resolveManualTeamPlatformIdWithSource({
      manualMappingPlatformId: "73001",
      teamMappingPlatformId: "10001",
    }),
    { platformId: "73001", source: "manual" }
  );
});

test("collectManualImportTeamMappingCandidates extracts valid current table IDs and skips placeholders", () => {
  const result = collectManualImportTeamMappingCandidates([
    {
      team1: "Virtus.pro",
      team1PlatformId: "101",
      team2: "TBD",
      team2PlatformId: "202",
    },
    {
      team1: { name: "Team Spirit", platformId: "303" },
      team2: "No ID Team",
      team2PlatformId: "",
    },
  ]);

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.skippedCount, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => [candidate.normalizedTeamName, candidate.platformId]),
    [
      ["virtuspro", "101"],
      ["team spirit", "303"],
    ]
  );
});

test("collectSingleManualImportTeamMappingCandidate validates one manual team save", () => {
  const result = collectSingleManualImportTeamMappingCandidate({
    teamName: "Team Liquid",
    platformId: "211608",
  });

  assert.equal(result.skippedCount, 0);
  assert.deepEqual(result.candidates, [
    {
      teamName: "Team Liquid",
      normalizedTeamName: "team liquid",
      platformId: "211608",
      canonicalName: "Team Liquid",
    },
  ]);
});

test("collectSingleManualImportTeamMappingCandidate rejects placeholders and invalid IDs", () => {
  assert.equal(
    collectSingleManualImportTeamMappingCandidate({ teamName: "TBD", platformId: "970685" }).skippedCount,
    1
  );
  assert.equal(
    collectSingleManualImportTeamMappingCandidate({ teamName: "Team Liquid", platformId: "abc" }).skippedCount,
    1
  );
});

test("collectManualImportTeamMappingCandidates reports conflicting IDs inside one save request", () => {
  const result = collectManualImportTeamMappingCandidates([
    { team1: "PARIVISION", team1PlatformId: "11", team2: "Rekonix", team2PlatformId: "22" },
    { team1: "Parivision", team1PlatformId: "33", team2: "Rekonix", team2PlatformId: "22" },
  ]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].normalizedTeamName, "parivision");
  assert.equal(result.conflicts[0].existingPlatformId, "11");
  assert.equal(result.conflicts[0].incomingPlatformId, "33");
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.normalizedTeamName),
    ["rekonix"]
  );
});

test("buildManualImportTeamMappingSavePlan returns conflicts without implicit overwrite", () => {
  const plan = buildManualImportTeamMappingSavePlan({
    candidates: [{ teamName: "Virtus.pro", normalizedTeamName: "virtuspro", platformId: "555" }],
    existingMappings: [{ teamName: "Virtus.pro", normalizedTeamName: "virtuspro", platformId: "111" }],
  });

  assert.equal(plan.toSave.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.overwrittenCount, 0);
});

test("buildManualImportTeamMappingSavePlan overwrites conflicts only after explicit flag", () => {
  const plan = buildManualImportTeamMappingSavePlan({
    candidates: [{ teamName: "Virtus.pro", normalizedTeamName: "virtuspro", platformId: "555" }],
    existingMappings: [{ teamName: "Virtus.pro", normalizedTeamName: "virtuspro", platformId: "111" }],
    overwriteConflicts: true,
  });

  assert.equal(plan.toSave.length, 1);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.overwrittenCount, 1);
});

test("normalizeAdminSportId accepts only positive numeric discipline IDs", () => {
  assert.equal(normalizeAdminSportId("73"), "73");
  assert.equal(normalizeAdminSportId(91), "91");
  assert.equal(normalizeAdminSportId("0"), "");
  assert.equal(normalizeAdminSportId("valorant"), "");
});
