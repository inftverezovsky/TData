import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCreateRunInput,
  isActiveRunConstraintViolation,
} from "@backend/tline/persistence/runs";

const schemaPath = new URL("../backend/prisma/schema.prisma", import.meta.url);
const migrationPath = new URL(
  "../backend/prisma/migrations/20260830190000_tline_mvp/migration.sql",
  import.meta.url,
);
const adminHierarchyMigrationPath = new URL(
  "../backend/prisma/migrations/20260830233000_tline_admin_hierarchy/migration.sql",
  import.meta.url,
);

test("TLine schema is additive and reuses Discipline and AdminTeam", async () => {
  const schema = await readFile(schemaPath, "utf8");

  for (const model of [
    "TLineSportConfig",
    "TLineGlobalHeader",
    "TLineGlobalHeaderAdminTeam",
    "TLineChampionship",
    "TLineSourceTeam",
    "TLineTeamMapping",
    "TLineRun",
    "TLineRunChampionship",
    "TLineSourceMatchSnapshot",
    "TLineAdminMatchSnapshot",
    "TLineComparison",
    "TLineManualDecision",
    "TLinePersistentMatchLink",
    "TLineException",
    "TLineJob",
    "TLineScheduleState",
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  assert.match(schema, /model TLineSportConfig[\s\S]*discipline\s+Discipline\s+@relation/);
  assert.match(schema, /model TLineGlobalHeader[\s\S]*adminShapkaId\s+String/);
  assert.match(schema, /model TLineGlobalHeader[\s\S]*@@unique\(\[sportConfigId, adminShapkaId\]\)/);
  assert.match(schema, /model TLineGlobalHeaderAdminTeam[\s\S]*@@id\(\[globalHeaderId, adminTeamId\]\)/);
  assert.match(schema, /model TLineChampionship[\s\S]*globalHeaderId\s+String\?/);
  assert.match(schema, /enum TLineMappingStatus \{[\s\S]*MANUAL_UNMAPPED[\s\S]*\}/);
  assert.match(schema, /model TLineTeamMapping[\s\S]*adminTeam\s+AdminTeam\s+@relation/);
  assert.match(schema, /model ParserRequestLog[\s\S]*tlineRunId\s+String\?/);
  assert.match(schema, /model ParserRequestLog[\s\S]*tlineChampionshipId\s+String\?/);
  assert.match(
    schema,
    /enum TLineAutomaticStatus \{[\s\S]*AUTO_OK[\s\S]*TIME_WARNING[\s\S]*TIME_CRITICAL[\s\S]*SOURCE_ONLY[\s\S]*ADMIN_ONLY[\s\S]*TEAM_UNMAPPED[\s\S]*MATCH_AMBIGUOUS[\s\S]*DUPLICATE_SOURCE[\s\S]*DUPLICATE_ADMIN[\s\S]*SOURCE_TIME_UNDEFINED[\s\S]*STATUS_MISMATCH[\s\S]*PARSER_FAILED[\s\S]*CANCELLED[\s\S]*\}/,
  );
  assert.match(schema, /model TLineManualDecision[\s\S]*actorId\s+String\?/);
  assert.match(schema, /model TLineChampionship[\s\S]*season\s+String\?/);
  assert.match(schema, /model TLineChampionship[\s\S]*adminChampionshipName\s+String\?/);
  assert.match(schema, /model TLineChampionship[\s\S]*candidateMatchWindowMinutes\s+Int\?/);
  assert.match(schema, /model TLineSourceTeam[\s\S]*@@unique\(\[id, championshipId\]\)/);
  assert.match(schema, /model TLineSourceTeam[\s\S]*@@index\(\[championshipId, normalizedName\]\)/);
  assert.doesNotMatch(schema, /@@unique\(\[championshipId, normalizedName\]\)/);
  assert.match(
    schema,
    /sourceTeam\s+TLineSourceTeam\s+@relation\(fields: \[sourceTeamId, championshipId\], references: \[id, championshipId\]/,
  );
});

test("TLine Admin hierarchy migration is additive and leaves existing championships unassigned", async () => {
  const migration = await readFile(adminHierarchyMigrationPath, "utf8");

  assert.match(migration, /ALTER TYPE "TLineMappingStatus" ADD VALUE 'MANUAL_UNMAPPED'/);
  assert.match(migration, /CREATE TABLE "TLineGlobalHeader"/);
  assert.match(migration, /CREATE TABLE "TLineGlobalHeaderAdminTeam"/);
  assert.match(migration, /ALTER TABLE "TLineChampionship" ADD COLUMN\s+"globalHeaderId" TEXT/);
  assert.match(migration, /TLineGlobalHeader_sportConfigId_adminShapkaId_key/);
  assert.match(migration, /TLineGlobalHeaderAdminTeam_pkey/);
  assert.doesNotMatch(migration, /UPDATE\s+"TLineChampionship"/i);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)/i);
});

test("TLine migration enforces active-run and scheduled-slot uniqueness", async () => {
  const migration = await readFile(migrationPath, "utf8");

  for (const table of [
    "TLineSportConfig",
    "TLineChampionship",
    "TLineSourceTeam",
    "TLineTeamMapping",
    "TLineRun",
    "TLineRunChampionship",
    "TLineSourceMatchSnapshot",
    "TLineAdminMatchSnapshot",
    "TLineComparison",
    "TLineManualDecision",
    "TLinePersistentMatchLink",
    "TLineException",
    "TLineJob",
    "TLineScheduleState",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }

  assert.match(
    migration,
    /CREATE UNIQUE INDEX "TLineRun_one_active_per_sport"[\s\S]*WHERE "status" IN \('QUEUED', 'RUNNING'\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "TLineJob_sportConfigId_scheduledAt_type_key"/,
  );
  assert.match(migration, /ALTER TABLE "ParserRequestLog" ADD COLUMN\s+"tlineRunId" TEXT/);
  assert.match(migration, /TLineSourceTeam_championshipId_normalizedName_idx/);
  assert.match(migration, /TLineSourceTeam_normalizedName_without_external_id_key[\s\S]*WHERE "externalId" IS NULL/);
  assert.match(
    migration,
    /TLineTeamMapping_sourceTeamId_championshipId_fkey[\s\S]*FOREIGN KEY \("sourceTeamId", "championshipId"\)/,
  );
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)/i);
});

test("buildCreateRunInput rejects an invalid period", () => {
  assert.throws(
    () =>
      buildCreateRunInput({
        sportConfigId: "sport-1",
        trigger: "MANUAL",
        periodFrom: new Date("2026-08-31T10:00:00.000Z"),
        periodTo: new Date("2026-08-31T09:59:59.000Z"),
      }),
    /periodTo must be after periodFrom/,
  );
});

test("buildCreateRunInput requires a slot for a scheduled run", () => {
  assert.throws(
    () =>
      buildCreateRunInput({
        sportConfigId: "sport-1",
        trigger: "SCHEDULED",
        periodFrom: new Date("2026-08-31T08:00:00.000Z"),
        periodTo: new Date("2026-08-31T10:00:00.000Z"),
      }),
    /scheduledAt is required/,
  );
});

test("buildCreateRunInput creates a queued run without mutating its input", () => {
  const input = Object.freeze({
    sportConfigId: "sport-1",
    trigger: "MANUAL" as const,
    periodFrom: new Date("2026-08-31T08:00:00.000Z"),
    periodTo: new Date("2026-08-31T10:00:00.000Z"),
  });

  const result = buildCreateRunInput(input);

  assert.deepEqual(result, {
    sportConfigId: "sport-1",
    trigger: "MANUAL",
    status: "QUEUED",
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    scheduledAt: null,
  });
});

test("active-run conflict detection is limited to the named partial index", () => {
  assert.equal(
    isActiveRunConstraintViolation({
      code: "P2002",
      meta: { target: "TLineRun_one_active_per_sport" },
    }),
    true,
  );
  assert.equal(
    isActiveRunConstraintViolation({ code: "P2002", meta: { target: ["id"] } }),
    false,
  );
  assert.equal(
    isActiveRunConstraintViolation({
      code: "P2002",
      meta: { modelName: "TLineRun", target: ["sportConfigId"] },
    }),
    true,
  );
  assert.equal(
    isActiveRunConstraintViolation({
      code: "P2002",
      message: "Unique constraint TLineRun_one_active_per_sport failed",
      meta: { modelName: "TLineRun", target: null },
    }),
    true,
  );
  assert.equal(isActiveRunConstraintViolation(new Error("duplicate")), false);
});
