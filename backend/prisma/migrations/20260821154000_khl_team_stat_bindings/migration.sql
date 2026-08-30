-- CreateTable
CREATE TABLE "KhlTeamStatBinding" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "statMappingId" TEXT NOT NULL,
    "adminTeamStatId" TEXT,
    "adminBindingStatus" "KhlBindingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "adminConfirmedAt" TIMESTAMP(3),
    "adminConfirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhlTeamStatBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KhlTeamStatBinding_adminTeamStatId_key"
ON "KhlTeamStatBinding"("adminTeamStatId");

-- CreateIndex
CREATE INDEX "KhlTeamStatBinding_adminBindingStatus_idx"
ON "KhlTeamStatBinding"("adminBindingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KhlTeamStatBinding_teamId_statMappingId_key"
ON "KhlTeamStatBinding"("teamId", "statMappingId");

-- AddForeignKey
ALTER TABLE "KhlTeamStatBinding"
ADD CONSTRAINT "KhlTeamStatBinding_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "KhlTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhlTeamStatBinding"
ADD CONSTRAINT "KhlTeamStatBinding_statMappingId_fkey"
FOREIGN KEY ("statMappingId") REFERENCES "KhlStatMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy KhlTeamStatTarget rows are intentionally not promoted: their Admin IDs
-- are match-scoped and cannot prove a persistent team-level binding.
