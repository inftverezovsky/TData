CREATE TYPE "KhlSyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "KhlSyncTrigger" AS ENUM ('MANUAL', 'AUTOMATIC');

CREATE TABLE "KhlSyncRun" (
    "id" TEXT NOT NULL,
    "trigger" "KhlSyncTrigger" NOT NULL,
    "status" "KhlSyncRunStatus" NOT NULL DEFAULT 'QUEUED',
    "scopeKey" TEXT NOT NULL,
    "khlGameId" TEXT,
    "full" BOOLEAN NOT NULL DEFAULT false,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "checkpoint" JSONB,
    "summary" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "KhlSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KhlSyncControl" (
    "id" TEXT NOT NULL DEFAULT 'khl',
    "activeRunId" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "workerHeartbeatAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "bootstrapCompletedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KhlSyncControl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KhlSyncControl_activeRunId_key" ON "KhlSyncControl"("activeRunId");
CREATE INDEX "KhlSyncRun_status_requestedAt_idx" ON "KhlSyncRun"("status", "requestedAt");
CREATE INDEX "KhlSyncRun_scopeKey_status_idx" ON "KhlSyncRun"("scopeKey", "status");
ALTER TABLE "KhlSyncControl" ADD CONSTRAINT "KhlSyncControl_activeRunId_fkey" FOREIGN KEY ("activeRunId") REFERENCES "KhlSyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
