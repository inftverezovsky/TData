-- TLine MVP is an additive, forward-only migration. It does not backfill or
-- modify existing product rows; the approved volleyball pilot is seeded below.

-- CreateEnum
CREATE TYPE "TLineRunTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "TLineRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'CANCELLED', 'FAILED');
CREATE TYPE "TLineJobType" AS ENUM ('RUN_CHECK', 'RETENTION_CLEANUP');
CREATE TYPE "TLineJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'CANCELLED', 'FAILED');
CREATE TYPE "TLineMappingStatus" AS ENUM ('UNMAPPED', 'SUGGESTED', 'AUTO_MAPPED', 'MANUAL_MAPPED', 'AMBIGUOUS', 'EXCLUDED');
CREATE TYPE "TLineAutomaticStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTO_OK', 'TIME_WARNING', 'TIME_ERROR', 'TIME_CRITICAL', 'SOURCE_ONLY', 'ADMIN_ONLY', 'TEAM_UNMAPPED', 'MATCH_AMBIGUOUS', 'DUPLICATE_SOURCE', 'DUPLICATE_ADMIN', 'SOURCE_TIME_UNDEFINED', 'STATUS_MISMATCH', 'PARSER_FAILED', 'CANCELLED');
CREATE TYPE "TLineEffectiveStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTO_OK', 'TIME_WARNING', 'TIME_ERROR', 'TIME_CRITICAL', 'SOURCE_ONLY', 'ADMIN_ONLY', 'TEAM_UNMAPPED', 'MATCH_AMBIGUOUS', 'DUPLICATE_SOURCE', 'DUPLICATE_ADMIN', 'SOURCE_TIME_UNDEFINED', 'STATUS_MISMATCH', 'PARSER_FAILED', 'CANCELLED', 'MANUAL_OK', 'MANUAL_ERROR', 'IGNORED');
CREATE TYPE "TLineSeverity" AS ENUM ('OK', 'WARNING', 'ERROR', 'CRITICAL', 'UNPROCESSED');
CREATE TYPE "TLineManualDecisionType" AS ENUM ('MANUAL_OK', 'MANUAL_ERROR', 'CONFIRM_CHAMPIONSHIP', 'MANUAL_LINK', 'IGNORE_UNTIL', 'EXCLUDE', 'RESET');
CREATE TYPE "TLineExceptionType" AS ENUM ('IGNORE_UNTIL', 'EXCLUDE');

-- Existing parser telemetry receives optional TLine correlation IDs.
ALTER TABLE "ParserRequestLog" ADD COLUMN
    "tlineRunId" TEXT,
ADD COLUMN
    "tlineChampionshipId" TEXT;

CREATE TABLE "TLineSportConfig" (
    "id" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "adminSportId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "autoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPeriodFromOffsetMinutes" INTEGER,
    "autoPeriodToOffsetMinutes" INTEGER,
    "candidateMatchWindowMinutes" INTEGER,
    "defaultAllowedTimeDriftMinutes" INTEGER,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineSportConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineSportConfig_candidate_window_check" CHECK ("candidateMatchWindowMinutes" IS NULL OR "candidateMatchWindowMinutes" > 0),
    CONSTRAINT "TLineSportConfig_drift_check" CHECK ("defaultAllowedTimeDriftMinutes" IS NULL OR ("defaultAllowedTimeDriftMinutes" >= 0 AND "defaultAllowedTimeDriftMinutes" <= 5))
);

CREATE TABLE "TLineChampionship" (
    "id" TEXT NOT NULL,
    "sportConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season" TEXT,
    "sourceProvider" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceChampionshipId" TEXT,
    "adminChampionshipId" TEXT,
    "adminChampionshipName" TEXT,
    "sourceTimezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "autoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedTimeDriftMinutes" INTEGER,
    "candidateMatchWindowMinutes" INTEGER,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineChampionship_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineChampionship_candidate_window_check" CHECK ("candidateMatchWindowMinutes" IS NULL OR "candidateMatchWindowMinutes" > 0),
    CONSTRAINT "TLineChampionship_drift_check" CHECK ("allowedTimeDriftMinutes" IS NULL OR ("allowedTimeDriftMinutes" >= 0 AND "allowedTimeDriftMinutes" <= 5))
);

CREATE TABLE "TLineSourceTeam" (
    "id" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineSourceTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TLineTeamMapping" (
    "id" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "sourceTeamId" TEXT NOT NULL,
    "adminTeamId" TEXT NOT NULL,
    "status" "TLineMappingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "confidenceScore" DOUBLE PRECISION,
    "matchMethod" TEXT,
    "alias" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineTeamMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineTeamMapping_confidence_check" CHECK ("confidenceScore" IS NULL OR ("confidenceScore" >= 0 AND "confidenceScore" <= 1))
);

CREATE TABLE "TLineRun" (
    "id" TEXT NOT NULL,
    "sportConfigId" TEXT NOT NULL,
    "trigger" "TLineRunTrigger" NOT NULL,
    "status" "TLineRunStatus" NOT NULL DEFAULT 'QUEUED',
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "progressProcessed" INTEGER NOT NULL DEFAULT 0,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "unprocessedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineRun_period_check" CHECK ("periodTo" > "periodFrom"),
    CONSTRAINT "TLineRun_progress_check" CHECK ("progressTotal" >= 0 AND "progressProcessed" >= 0 AND "progressProcessed" <= "progressTotal"),
    CONSTRAINT "TLineRun_counts_check" CHECK ("okCount" >= 0 AND "warningCount" >= 0 AND "errorCount" >= 0 AND "criticalCount" >= 0 AND "unprocessedCount" >= 0)
);

CREATE TABLE "TLineRunChampionship" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "status" "TLineRunStatus" NOT NULL DEFAULT 'QUEUED',
    "automaticStatus" "TLineAutomaticStatus" NOT NULL DEFAULT 'PENDING',
    "manualStatus" "TLineEffectiveStatus",
    "effectiveStatus" "TLineEffectiveStatus" NOT NULL DEFAULT 'PENDING',
    "severity" "TLineSeverity" NOT NULL DEFAULT 'UNPROCESSED',
    "effectiveSeverity" "TLineSeverity" NOT NULL DEFAULT 'UNPROCESSED',
    "reasonCodes" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineRunChampionship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TLineSourceMatchSnapshot" (
    "id" TEXT NOT NULL,
    "runChampionshipId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "occurrenceIndex" INTEGER NOT NULL DEFAULT 0,
    "externalMatchId" TEXT,
    "sourceUrl" TEXT,
    "homeExternalTeamId" TEXT,
    "awayExternalTeamId" TEXT,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamName" TEXT NOT NULL,
    "originalTimeText" TEXT,
    "sourceTimezone" TEXT NOT NULL,
    "scheduledAtUtc" TIMESTAMP(3),
    "sourceStatus" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TLineSourceMatchSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineSourceMatchSnapshot_occurrence_check" CHECK ("occurrenceIndex" >= 0)
);

CREATE TABLE "TLineAdminMatchSnapshot" (
    "id" TEXT NOT NULL,
    "runChampionshipId" TEXT NOT NULL,
    "adminMatchId" TEXT NOT NULL,
    "occurrenceIndex" INTEGER NOT NULL DEFAULT 0,
    "homeAdminTeamPlatformId" TEXT,
    "awayAdminTeamPlatformId" TEXT,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamName" TEXT NOT NULL,
    "originalTimeText" TEXT,
    "scheduledAtUtc" TIMESTAMP(3),
    "adminStatus" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TLineAdminMatchSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineAdminMatchSnapshot_occurrence_check" CHECK ("occurrenceIndex" >= 0)
);

CREATE TABLE "TLineComparison" (
    "id" TEXT NOT NULL,
    "runChampionshipId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT,
    "adminSnapshotId" TEXT,
    "pairKey" TEXT,
    "automaticStatus" "TLineAutomaticStatus" NOT NULL,
    "manualStatus" "TLineEffectiveStatus",
    "effectiveStatus" "TLineEffectiveStatus" NOT NULL,
    "severity" "TLineSeverity" NOT NULL,
    "effectiveSeverity" "TLineSeverity" NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "swappedSides" BOOLEAN NOT NULL DEFAULT false,
    "timeDeltaMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineComparison_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineComparison_evidence_check" CHECK (num_nonnulls("sourceSnapshotId", "adminSnapshotId") >= 1)
);

CREATE TABLE "TLineManualDecision" (
    "id" TEXT NOT NULL,
    "runChampionshipId" TEXT,
    "comparisonId" TEXT,
    "decisionType" "TLineManualDecisionType" NOT NULL,
    "effectiveStatus" "TLineEffectiveStatus",
    "persistent" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TLineManualDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineManualDecision_target_check" CHECK (num_nonnulls("runChampionshipId", "comparisonId") = 1)
);

CREATE TABLE "TLinePersistentMatchLink" (
    "id" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "sourceMatchKey" TEXT NOT NULL,
    "adminMatchId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLinePersistentMatchLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TLineException" (
    "id" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "type" "TLineExceptionType" NOT NULL,
    "sourceMatchKey" TEXT,
    "adminMatchId" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineException_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineException_target_check" CHECK (num_nonnulls("sourceMatchKey", "adminMatchId") >= 1)
);

CREATE TABLE "TLineJob" (
    "id" TEXT NOT NULL,
    "sportConfigId" TEXT,
    "runId" TEXT,
    "type" "TLineJobType" NOT NULL,
    "status" "TLineJobStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineJob_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0)
);

CREATE TABLE "TLineScheduleState" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "slotHours" INTEGER[] NOT NULL DEFAULT ARRAY[8, 12, 16, 22]::INTEGER[],
    "lastTickAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TLineScheduleState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TLineScheduleState_slots_check" CHECK (cardinality("slotHours") > 0 AND "slotHours" <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]::INTEGER[])
);

CREATE UNIQUE INDEX "TLineSportConfig_disciplineId_key" ON "TLineSportConfig"("disciplineId");
CREATE INDEX "TLineSportConfig_active_autoEnabled_idx" ON "TLineSportConfig"("active", "autoEnabled");
CREATE INDEX "TLineChampionship_sportConfigId_active_autoEnabled_idx" ON "TLineChampionship"("sportConfigId", "active", "autoEnabled");
CREATE INDEX "TLineChampionship_adminChampionshipId_idx" ON "TLineChampionship"("adminChampionshipId");
CREATE UNIQUE INDEX "TLineChampionship_sportConfigId_sourceProvider_sourceUrl_key" ON "TLineChampionship"("sportConfigId", "sourceProvider", "sourceUrl");
CREATE INDEX "TLineSourceTeam_championshipId_lastSeenAt_idx" ON "TLineSourceTeam"("championshipId", "lastSeenAt");
CREATE UNIQUE INDEX "TLineSourceTeam_championshipId_externalId_key" ON "TLineSourceTeam"("championshipId", "externalId");
CREATE UNIQUE INDEX "TLineSourceTeam_id_championshipId_key" ON "TLineSourceTeam"("id", "championshipId");
CREATE INDEX "TLineSourceTeam_championshipId_normalizedName_idx" ON "TLineSourceTeam"("championshipId", "normalizedName");
CREATE UNIQUE INDEX "TLineSourceTeam_normalizedName_without_external_id_key" ON "TLineSourceTeam"("championshipId", "normalizedName") WHERE "externalId" IS NULL;
CREATE UNIQUE INDEX "TLineTeamMapping_sourceTeamId_key" ON "TLineTeamMapping"("sourceTeamId");
CREATE UNIQUE INDEX "TLineTeamMapping_sourceTeamId_championshipId_key" ON "TLineTeamMapping"("sourceTeamId", "championshipId");
CREATE INDEX "TLineTeamMapping_championshipId_status_idx" ON "TLineTeamMapping"("championshipId", "status");
CREATE INDEX "TLineTeamMapping_adminTeamId_idx" ON "TLineTeamMapping"("adminTeamId");
CREATE INDEX "TLineRun_sportConfigId_status_createdAt_idx" ON "TLineRun"("sportConfigId", "status", "createdAt");
CREATE INDEX "TLineRun_status_createdAt_idx" ON "TLineRun"("status", "createdAt");
CREATE UNIQUE INDEX "TLineRun_sportConfigId_scheduledAt_key" ON "TLineRun"("sportConfigId", "scheduledAt");
CREATE UNIQUE INDEX "TLineRun_one_active_per_sport" ON "TLineRun"("sportConfigId") WHERE "status" IN ('QUEUED', 'RUNNING');
CREATE INDEX "TLineRunChampionship_championshipId_createdAt_idx" ON "TLineRunChampionship"("championshipId", "createdAt");
CREATE INDEX "TLineRunChampionship_runId_status_idx" ON "TLineRunChampionship"("runId", "status");
CREATE UNIQUE INDEX "TLineRunChampionship_runId_championshipId_key" ON "TLineRunChampionship"("runId", "championshipId");
CREATE INDEX "TLineSourceMatchSnapshot_runChampionshipId_scheduledAtUtc_idx" ON "TLineSourceMatchSnapshot"("runChampionshipId", "scheduledAtUtc");
CREATE INDEX "TLineSourceMatchSnapshot_externalMatchId_idx" ON "TLineSourceMatchSnapshot"("externalMatchId");
CREATE UNIQUE INDEX "TLineSourceMatchSnapshot_runChampionshipId_sourceKey_occurr_key" ON "TLineSourceMatchSnapshot"("runChampionshipId", "sourceKey", "occurrenceIndex");
CREATE INDEX "TLineAdminMatchSnapshot_runChampionshipId_scheduledAtUtc_idx" ON "TLineAdminMatchSnapshot"("runChampionshipId", "scheduledAtUtc");
CREATE UNIQUE INDEX "TLineAdminMatchSnapshot_runChampionshipId_adminMatchId_occu_key" ON "TLineAdminMatchSnapshot"("runChampionshipId", "adminMatchId", "occurrenceIndex");
CREATE UNIQUE INDEX "TLineComparison_sourceSnapshotId_key" ON "TLineComparison"("sourceSnapshotId");
CREATE UNIQUE INDEX "TLineComparison_adminSnapshotId_key" ON "TLineComparison"("adminSnapshotId");
CREATE INDEX "TLineComparison_runChampionshipId_effectiveStatus_idx" ON "TLineComparison"("runChampionshipId", "effectiveStatus");
CREATE INDEX "TLineComparison_pairKey_idx" ON "TLineComparison"("pairKey");
CREATE INDEX "TLineManualDecision_runChampionshipId_createdAt_idx" ON "TLineManualDecision"("runChampionshipId", "createdAt");
CREATE INDEX "TLineManualDecision_comparisonId_createdAt_idx" ON "TLineManualDecision"("comparisonId", "createdAt");
CREATE INDEX "TLineManualDecision_actorId_createdAt_idx" ON "TLineManualDecision"("actorId", "createdAt");
CREATE INDEX "TLinePersistentMatchLink_championshipId_adminMatchId_idx" ON "TLinePersistentMatchLink"("championshipId", "adminMatchId");
CREATE UNIQUE INDEX "TLinePersistentMatchLink_championshipId_sourceMatchKey_key" ON "TLinePersistentMatchLink"("championshipId", "sourceMatchKey");
CREATE INDEX "TLineException_championshipId_type_active_idx" ON "TLineException"("championshipId", "type", "active");
CREATE INDEX "TLineException_expiresAt_idx" ON "TLineException"("expiresAt");
CREATE UNIQUE INDEX "TLineJob_runId_key" ON "TLineJob"("runId");
CREATE UNIQUE INDEX "TLineJob_idempotencyKey_key" ON "TLineJob"("idempotencyKey");
CREATE INDEX "TLineJob_status_availableAt_priority_idx" ON "TLineJob"("status", "availableAt", "priority");
CREATE INDEX "TLineJob_status_leaseExpiresAt_idx" ON "TLineJob"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "TLineJob_sportConfigId_scheduledAt_type_key" ON "TLineJob"("sportConfigId", "scheduledAt", "type");
CREATE INDEX "ParserRequestLog_tlineRunId_createdAt_idx" ON "ParserRequestLog"("tlineRunId", "createdAt");
CREATE INDEX "ParserRequestLog_tlineChampionshipId_createdAt_idx" ON "ParserRequestLog"("tlineChampionshipId", "createdAt");

ALTER TABLE "TLineSportConfig" ADD CONSTRAINT "TLineSportConfig_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineChampionship" ADD CONSTRAINT "TLineChampionship_sportConfigId_fkey" FOREIGN KEY ("sportConfigId") REFERENCES "TLineSportConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineSourceTeam" ADD CONSTRAINT "TLineSourceTeam_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "TLineChampionship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineTeamMapping" ADD CONSTRAINT "TLineTeamMapping_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "TLineChampionship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineTeamMapping" ADD CONSTRAINT "TLineTeamMapping_sourceTeamId_championshipId_fkey" FOREIGN KEY ("sourceTeamId", "championshipId") REFERENCES "TLineSourceTeam"("id", "championshipId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineTeamMapping" ADD CONSTRAINT "TLineTeamMapping_adminTeamId_fkey" FOREIGN KEY ("adminTeamId") REFERENCES "AdminTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineRun" ADD CONSTRAINT "TLineRun_sportConfigId_fkey" FOREIGN KEY ("sportConfigId") REFERENCES "TLineSportConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineRunChampionship" ADD CONSTRAINT "TLineRunChampionship_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TLineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TLineRunChampionship" ADD CONSTRAINT "TLineRunChampionship_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "TLineChampionship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineSourceMatchSnapshot" ADD CONSTRAINT "TLineSourceMatchSnapshot_runChampionshipId_fkey" FOREIGN KEY ("runChampionshipId") REFERENCES "TLineRunChampionship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TLineAdminMatchSnapshot" ADD CONSTRAINT "TLineAdminMatchSnapshot_runChampionshipId_fkey" FOREIGN KEY ("runChampionshipId") REFERENCES "TLineRunChampionship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TLineComparison" ADD CONSTRAINT "TLineComparison_runChampionshipId_fkey" FOREIGN KEY ("runChampionshipId") REFERENCES "TLineRunChampionship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TLineComparison" ADD CONSTRAINT "TLineComparison_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "TLineSourceMatchSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineComparison" ADD CONSTRAINT "TLineComparison_adminSnapshotId_fkey" FOREIGN KEY ("adminSnapshotId") REFERENCES "TLineAdminMatchSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineManualDecision" ADD CONSTRAINT "TLineManualDecision_runChampionshipId_fkey" FOREIGN KEY ("runChampionshipId") REFERENCES "TLineRunChampionship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineManualDecision" ADD CONSTRAINT "TLineManualDecision_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "TLineComparison"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLinePersistentMatchLink" ADD CONSTRAINT "TLinePersistentMatchLink_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "TLineChampionship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineException" ADD CONSTRAINT "TLineException_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "TLineChampionship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineJob" ADD CONSTRAINT "TLineJob_sportConfigId_fkey" FOREIGN KEY ("sportConfigId") REFERENCES "TLineSportConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineJob" ADD CONSTRAINT "TLineJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TLineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParserRequestLog" ADD CONSTRAINT "ParserRequestLog_tlineRunId_fkey" FOREIGN KEY ("tlineRunId") REFERENCES "TLineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParserRequestLog" ADD CONSTRAINT "ParserRequestLog_tlineChampionshipId_fkey" FOREIGN KEY ("tlineChampionshipId") REFERENCES "TLineChampionship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Approved TLine volleyball pilot. Admin identifiers and automation settings
-- intentionally remain unset so the integration fails closed until configured.
INSERT INTO "Discipline" ("id", "slug", "name", "isEnabled", "createdAt")
VALUES ('tline-discipline-volleyball', 'volleyball', 'Волейбол', true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "TLineSportConfig" (
    "id", "disciplineId", "adminSportId", "active", "autoEnabled",
    "autoPeriodFromOffsetMinutes", "autoPeriodToOffsetMinutes",
    "candidateMatchWindowMinutes", "defaultAllowedTimeDriftMinutes", "updatedAt"
)
SELECT
    'tline-sport-volleyball', "id", NULL, true, false,
    NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP
FROM "Discipline"
WHERE "slug" = 'volleyball'
ON CONFLICT ("disciplineId") DO NOTHING;

INSERT INTO "TLineChampionship" (
    "id", "sportConfigId", "name", "season", "sourceProvider", "sourceUrl",
    "sourceChampionshipId", "adminChampionshipId", "adminChampionshipName",
    "sourceTimezone", "active", "autoEnabled", "allowedTimeDriftMinutes",
    "candidateMatchWindowMinutes", "updatedAt"
)
SELECT
    'tline-volleyball-women-hla-2026', sport."id",
    'Волейбол. Россия. Высшая лига А. Женщины', '2026/27', 'volley-ru',
    'https://volley.ru/calendar/01KYPZAKJB0SMM0D6TGV3W0Y85/allgames',
    '01KYPZAKJB0SMM0D6TGV3W0Y85', NULL, NULL, 'Europe/Moscow',
    true, false, NULL, NULL, CURRENT_TIMESTAMP
FROM "TLineSportConfig" sport
JOIN "Discipline" discipline ON discipline."id" = sport."disciplineId"
WHERE discipline."slug" = 'volleyball'
ON CONFLICT ("sportConfigId", "sourceProvider", "sourceUrl") DO UPDATE SET
    "name" = EXCLUDED."name",
    "season" = EXCLUDED."season",
    "sourceChampionshipId" = EXCLUDED."sourceChampionshipId",
    "sourceTimezone" = EXCLUDED."sourceTimezone",
    "active" = true,
    "deletedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "TLineChampionship" (
    "id", "sportConfigId", "name", "season", "sourceProvider", "sourceUrl",
    "sourceChampionshipId", "adminChampionshipId", "adminChampionshipName",
    "sourceTimezone", "active", "autoEnabled", "allowedTimeDriftMinutes",
    "candidateMatchWindowMinutes", "updatedAt"
)
SELECT
    'tline-volleyball-men-hlb-2026', sport."id",
    'Волейбол. Россия. Высшая лига Б. Мужчины', '2026/27', 'volley-ru',
    'https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames',
    '01KZQZR5T3NETE0RT7VHND16VW', NULL, NULL, 'Europe/Moscow',
    true, false, NULL, NULL, CURRENT_TIMESTAMP
FROM "TLineSportConfig" sport
JOIN "Discipline" discipline ON discipline."id" = sport."disciplineId"
WHERE discipline."slug" = 'volleyball'
ON CONFLICT ("sportConfigId", "sourceProvider", "sourceUrl") DO UPDATE SET
    "name" = EXCLUDED."name",
    "season" = EXCLUDED."season",
    "sourceChampionshipId" = EXCLUDED."sourceChampionshipId",
    "sourceTimezone" = EXCLUDED."sourceTimezone",
    "active" = true,
    "deletedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "TLineScheduleState" ("id", "enabled", "timezone", "slotHours", "updatedAt")
VALUES ('global', false, 'Europe/Moscow', ARRAY[8, 12, 16, 22]::INTEGER[], CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
