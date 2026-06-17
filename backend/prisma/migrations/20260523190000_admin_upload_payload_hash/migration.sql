ALTER TABLE "AdminUploadLog" ADD COLUMN "payloadHash" TEXT;

CREATE UNIQUE INDEX "AdminUploadLog_disciplineSlug_tournamentId_payloadHash_key"
ON "AdminUploadLog"("disciplineSlug", "tournamentId", "payloadHash");
