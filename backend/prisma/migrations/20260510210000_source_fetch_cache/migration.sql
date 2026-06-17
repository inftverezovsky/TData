ALTER TABLE "RawSnapshot"
  ADD COLUMN "qualityScore" DOUBLE PRECISION,
  ADD COLUMN "metadata" JSONB;

ALTER TABLE "TournamentMatch"
  ADD COLUMN "hasPlaceholderTeams" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceConfidence" DOUBLE PRECISION,
  ADD COLUMN "sourceBreakdown" JSONB;

CREATE TABLE "SourceFetchCache" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "disciplineSlug" TEXT NOT NULL DEFAULT 'global',
  "resourceType" TEXT NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'cache-first',
  "revisionId" INTEGER,
  "revisionTimestamp" TIMESTAMP(3),
  "contentHash" TEXT,
  "lastGoodAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorClass" TEXT,
  "qualityScore" DOUBLE PRECISION,
  "cacheUntil" TIMESTAMP(3),
  "staleUntil" TIMESTAMP(3),
  "externalRequests" INTEGER NOT NULL DEFAULT 0,
  "bytesIn" INTEGER,
  "bytesOut" INTEGER,
  "cacheLayer" TEXT,
  "rawSnapshotId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SourceFetchCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceFetchCache_source_disciplineSlug_resourceType_resourceKey_mode_key"
  ON "SourceFetchCache"("source", "disciplineSlug", "resourceType", "resourceKey", "mode");
CREATE INDEX "SourceFetchCache_source_disciplineSlug_resourceType_idx"
  ON "SourceFetchCache"("source", "disciplineSlug", "resourceType");
CREATE INDEX "SourceFetchCache_cacheUntil_idx" ON "SourceFetchCache"("cacheUntil");
CREATE INDEX "SourceFetchCache_staleUntil_idx" ON "SourceFetchCache"("staleUntil");
CREATE INDEX "SourceFetchCache_lastGoodAt_idx" ON "SourceFetchCache"("lastGoodAt");
