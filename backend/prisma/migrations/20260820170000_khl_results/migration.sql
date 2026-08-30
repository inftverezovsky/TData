-- CreateEnum
CREATE TYPE "KhlMatchState" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "KhlBindingStatus" AS ENUM ('UNMAPPED', 'SUGGESTED', 'CONFIRMED', 'REJECTED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "KhlBindingMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "KhlRevisionState" AS ENUM ('VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KhlSnapshotResource" AS ENUM ('BOOTSTRAP', 'SCHEDULE', 'EVENT_DETAIL', 'PROTOCOL');

-- CreateEnum
CREATE TYPE "KhlStatScope" AS ENUM ('TEAM', 'PLAYER');

-- CreateEnum
CREATE TYPE "KhlDeliveryState" AS ENUM ('PENDING', 'IN_FLIGHT', 'ACKNOWLEDGED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "KhlTeam" (
    "id" TEXT NOT NULL,
    "khlTeamId" TEXT NOT NULL,
    "apiTeamId" TEXT,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "logoUrl" TEXT,
    "adminTeamId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlPlayer" (
    "id" TEXT NOT NULL,
    "khlPlayerId" TEXT NOT NULL,
    "apiPlayerId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "adminPlayerId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlMatch" (
    "id" TEXT NOT NULL,
    "khlGameId" TEXT NOT NULL,
    "apiEventId" TEXT NOT NULL,
    "sourceMatchId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "khlStageId" TEXT NOT NULL,
    "stageName" TEXT,
    "season" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" "KhlMatchState" NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "officialHomeScore" INTEGER,
    "officialAwayScore" INTEGER,
    "regulationHomeScore" INTEGER,
    "regulationAwayScore" INTEGER,
    "activeRevisionId" TEXT,
    "adminMatchId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminBindingMode" "KhlBindingMode",
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlRawSnapshot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT,
    "resourceType" "KhlSnapshotResource" NOT NULL,
    "externalKey" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "contentType" TEXT,
    "contentHash" CHAR(64) NOT NULL,
    "rawBody" BYTEA NOT NULL,
    "firstFetchedAt" TIMESTAMP(3) NOT NULL,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL,
    "fetchCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KhlRawSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlMatchRevision" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "normalizedHash" CHAR(64) NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "state" "KhlRevisionState" NOT NULL,
    "normalizedJson" JSONB NOT NULL,
    "validationIssues" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "KhlMatchRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlMatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "shirtNumber" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "adminMatchPlayerId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "firstSeenRevisionNumber" INTEGER NOT NULL,
    "lastSeenRevisionNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlMatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlStatMapping" (
    "id" TEXT NOT NULL,
    "scope" "KhlStatScope" NOT NULL,
    "semanticCode" TEXT NOT NULL,
    "adminStatTypeId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlStatMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlTeamStatTarget" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "statMappingId" TEXT NOT NULL,
    "adminMatchStatId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlTeamStatTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlPlayerStatTarget" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "statMappingId" TEXT NOT NULL,
    "adminPlayerStatId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlPlayerStatTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlDelivery" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "adminMatchId" TEXT NOT NULL,
    "endpointVersion" TEXT NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "idempotencyKey" CHAR(64) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "state" "KhlDeliveryState" NOT NULL DEFAULT 'PENDING',
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhlDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "state" "KhlDeliveryState" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "httpStatus" INTEGER,
    "responseHash" CHAR(64),
    "responseExcerpt" TEXT,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KhlDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KhlTeam_khlTeamId_key" ON "KhlTeam"("khlTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlTeam_apiTeamId_key" ON "KhlTeam"("apiTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlTeam_adminTeamId_key" ON "KhlTeam"("adminTeamId");

-- CreateIndex
CREATE INDEX "KhlTeam_apiTeamId_idx" ON "KhlTeam"("apiTeamId");

-- CreateIndex
CREATE INDEX "KhlTeam_adminBindingStatus_idx" ON "KhlTeam"("adminBindingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KhlPlayer_khlPlayerId_key" ON "KhlPlayer"("khlPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlPlayer_apiPlayerId_key" ON "KhlPlayer"("apiPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlPlayer_adminPlayerId_key" ON "KhlPlayer"("adminPlayerId");

-- CreateIndex
CREATE INDEX "KhlPlayer_apiPlayerId_idx" ON "KhlPlayer"("apiPlayerId");

-- CreateIndex
CREATE INDEX "KhlPlayer_adminBindingStatus_idx" ON "KhlPlayer"("adminBindingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatch_khlGameId_key" ON "KhlMatch"("khlGameId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatch_apiEventId_key" ON "KhlMatch"("apiEventId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatch_sourceMatchId_key" ON "KhlMatch"("sourceMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatch_activeRevisionId_key" ON "KhlMatch"("activeRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatch_adminMatchId_key" ON "KhlMatch"("adminMatchId");

-- CreateIndex
CREATE INDEX "KhlMatch_stageId_startsAt_idx" ON "KhlMatch"("stageId", "startsAt");

-- CreateIndex
CREATE INDEX "KhlMatch_khlStageId_startsAt_idx" ON "KhlMatch"("khlStageId", "startsAt");

-- CreateIndex
CREATE INDEX "KhlMatch_homeTeamId_awayTeamId_startsAt_idx" ON "KhlMatch"("homeTeamId", "awayTeamId", "startsAt");

-- CreateIndex
CREATE INDEX "KhlMatch_adminBindingStatus_idx" ON "KhlMatch"("adminBindingStatus");

-- CreateIndex
CREATE INDEX "KhlRawSnapshot_matchId_lastFetchedAt_idx" ON "KhlRawSnapshot"("matchId", "lastFetchedAt");

-- CreateIndex
CREATE INDEX "KhlRawSnapshot_contentHash_idx" ON "KhlRawSnapshot"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "KhlRawSnapshot_resourceType_externalKey_contentHash_key" ON "KhlRawSnapshot"("resourceType", "externalKey", "contentHash");

-- CreateIndex
CREATE INDEX "KhlMatchRevision_matchId_state_createdAt_idx" ON "KhlMatchRevision"("matchId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatchRevision_matchId_revisionNumber_key" ON "KhlMatchRevision"("matchId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatchRevision_matchId_normalizedHash_parserVersion_rules_key" ON "KhlMatchRevision"("matchId", "normalizedHash", "parserVersion", "rulesVersion");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatchParticipant_adminMatchPlayerId_key" ON "KhlMatchParticipant"("adminMatchPlayerId");

-- CreateIndex
CREATE INDEX "KhlMatchParticipant_matchId_teamId_isListed_idx" ON "KhlMatchParticipant"("matchId", "teamId", "isListed");

-- CreateIndex
CREATE INDEX "KhlMatchParticipant_adminBindingStatus_idx" ON "KhlMatchParticipant"("adminBindingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KhlMatchParticipant_matchId_playerId_key" ON "KhlMatchParticipant"("matchId", "playerId");

-- CreateIndex
CREATE INDEX "KhlStatMapping_adminBindingStatus_idx" ON "KhlStatMapping"("adminBindingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KhlStatMapping_scope_semanticCode_key" ON "KhlStatMapping"("scope", "semanticCode");

-- CreateIndex
CREATE UNIQUE INDEX "KhlStatMapping_scope_adminStatTypeId_key" ON "KhlStatMapping"("scope", "adminStatTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlTeamStatTarget_adminMatchStatId_key" ON "KhlTeamStatTarget"("adminMatchStatId");

-- CreateIndex
CREATE INDEX "KhlTeamStatTarget_adminBindingStatus_idx" ON "KhlTeamStatTarget"("adminBindingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KhlTeamStatTarget_matchId_teamId_statMappingId_key" ON "KhlTeamStatTarget"("matchId", "teamId", "statMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlPlayerStatTarget_adminPlayerStatId_key" ON "KhlPlayerStatTarget"("adminPlayerStatId");

-- CreateIndex
CREATE INDEX "KhlPlayerStatTarget_adminBindingStatus_idx" ON "KhlPlayerStatTarget"("adminBindingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KhlPlayerStatTarget_participantId_statMappingId_key" ON "KhlPlayerStatTarget"("participantId", "statMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "KhlDelivery_idempotencyKey_key" ON "KhlDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "KhlDelivery_state_leaseUntil_idx" ON "KhlDelivery"("state", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "KhlDelivery_revisionId_adminMatchId_endpointVersion_payload_key" ON "KhlDelivery"("revisionId", "adminMatchId", "endpointVersion", "payloadHash");

-- CreateIndex
CREATE INDEX "KhlDeliveryAttempt_state_startedAt_idx" ON "KhlDeliveryAttempt"("state", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KhlDeliveryAttempt_deliveryId_attemptNumber_key" ON "KhlDeliveryAttempt"("deliveryId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "KhlMatch" ADD CONSTRAINT "KhlMatch_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "KhlTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlMatch" ADD CONSTRAINT "KhlMatch_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "KhlTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlMatch" ADD CONSTRAINT "KhlMatch_activeRevisionId_fkey" FOREIGN KEY ("activeRevisionId") REFERENCES "KhlMatchRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlRawSnapshot" ADD CONSTRAINT "KhlRawSnapshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "KhlMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlMatchRevision" ADD CONSTRAINT "KhlMatchRevision_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "KhlMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlMatchRevision" ADD CONSTRAINT "KhlMatchRevision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "KhlRawSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlMatchParticipant" ADD CONSTRAINT "KhlMatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "KhlMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlMatchParticipant" ADD CONSTRAINT "KhlMatchParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "KhlTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlMatchParticipant" ADD CONSTRAINT "KhlMatchParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "KhlPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlTeamStatTarget" ADD CONSTRAINT "KhlTeamStatTarget_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "KhlMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlTeamStatTarget" ADD CONSTRAINT "KhlTeamStatTarget_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "KhlTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlTeamStatTarget" ADD CONSTRAINT "KhlTeamStatTarget_statMappingId_fkey" FOREIGN KEY ("statMappingId") REFERENCES "KhlStatMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlPlayerStatTarget" ADD CONSTRAINT "KhlPlayerStatTarget_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "KhlMatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlPlayerStatTarget" ADD CONSTRAINT "KhlPlayerStatTarget_statMappingId_fkey" FOREIGN KEY ("statMappingId") REFERENCES "KhlStatMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlDelivery" ADD CONSTRAINT "KhlDelivery_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "KhlMatchRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlDeliveryAttempt" ADD CONSTRAINT "KhlDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "KhlDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
