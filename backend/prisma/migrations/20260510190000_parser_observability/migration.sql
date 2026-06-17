-- Parser observability and proxy health fields.
ALTER TABLE "RawSnapshot"
  ADD COLUMN "disciplineSlug" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "revisionId" INTEGER,
  ADD COLUMN "revisionTimestamp" TIMESTAMP(3);

ALTER TABLE "ProxyPool"
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "cooldownUntil" TIMESTAMP(3),
  ADD COLUMN "successCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "blockedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "avgLatencyMs" INTEGER;

CREATE TABLE "ParserRequestLog" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "mode" TEXT,
  "route" TEXT,
  "disciplineSlug" TEXT,
  "queryHash" TEXT,
  "proxyId" TEXT,
  "attempt" INTEGER,
  "statusCode" INTEGER,
  "errorClass" TEXT,
  "durationMs" INTEGER,
  "bytesIn" INTEGER,
  "bytesOut" INTEGER,
  "cacheLayer" TEXT,
  "cacheHit" BOOLEAN NOT NULL DEFAULT false,
  "matchesCount" INTEGER,
  "eventsCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ParserRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RawSnapshot_disciplineSlug_pageTitle_idx" ON "RawSnapshot"("disciplineSlug", "pageTitle");
CREATE INDEX "RawSnapshot_contentHash_idx" ON "RawSnapshot"("contentHash");
CREATE INDEX "ParserRequestLog_source_mode_createdAt_idx" ON "ParserRequestLog"("source", "mode", "createdAt");
CREATE INDEX "ParserRequestLog_disciplineSlug_createdAt_idx" ON "ParserRequestLog"("disciplineSlug", "createdAt");
CREATE INDEX "ParserRequestLog_proxyId_createdAt_idx" ON "ParserRequestLog"("proxyId", "createdAt");
CREATE INDEX "ParserRequestLog_cacheHit_createdAt_idx" ON "ParserRequestLog"("cacheHit", "createdAt");
