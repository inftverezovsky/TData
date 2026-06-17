-- CreateEnum
CREATE TYPE "SearchStatus" AS ENUM ('SUCCESS', 'FAILED', 'CACHED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('unmapped', 'auto_mapped', 'manual_mapped', 'manual_unmapped', 'ambiguous', 'ignored');

-- CreateTable
CREATE TABLE "Discipline" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseApiUrl" TEXT,
    "platformId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRequest" (
    "id" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "status" "SearchStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchResult" (
    "id" TEXT NOT NULL,
    "searchRequestId" TEXT NOT NULL,
    "pageId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "snippet" TEXT,
    "score" DOUBLE PRECISION,
    "wordCount" INTEGER,
    "dates" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentImport" (
    "id" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "pageId" INTEGER,
    "pageTitle" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "TournamentImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawSnapshot" (
    "id" TEXT NOT NULL,
    "tournamentImportId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "pageId" INTEGER,
    "pageTitle" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "rawWikitext" TEXT,
    "rawHtml" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "sourcePageId" INTEGER,
    "sourceTitle" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "disciplineSlug" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "location" TEXT,
    "region" TEXT,
    "organizer" TEXT,
    "prizePool" TEXT,
    "formatText" TEXT,
    "status" TEXT,
    "extractionStatus" "ImportStatus" NOT NULL DEFAULT 'PARTIAL',
    "normalization" JSONB,
    "platformId" TEXT,
    "lastImportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentParticipant" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platformId" TEXT,
    "seed" TEXT,
    "region" TEXT,
    "status" TEXT,
    "logoUrl" TEXT,
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "stage" TEXT,
    "round" TEXT,
    "matchDate" TIMESTAMP(3),
    "matchDateTime" TEXT,
    "teamAId" TEXT,
    "teamAName" TEXT,
    "teamBId" TEXT,
    "teamBName" TEXT,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "format" TEXT,
    "status" TEXT,
    "court" TEXT,
    "sourceUrl" TEXT,
    "lpNumericalId" BIGINT,
    "platformId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalSettings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProxyPool" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'http',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminTeam" (
    "id" TEXT NOT NULL,
    "disciplineSlug" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "platformName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMapping" (
    "id" TEXT NOT NULL,
    "disciplineSlug" TEXT NOT NULL DEFAULT 'counterstrike',
    "liquipediaName" TEXT NOT NULL,
    "liquipediaNormalizedName" TEXT,
    "internalTeamId" TEXT,
    "platformId" TEXT,
    "canonicalName" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "matchMethod" TEXT,
    "status" "MappingStatus" NOT NULL DEFAULT 'unmapped',
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isLockedFromAutoMapping" BOOLEAN NOT NULL DEFAULT false,
    "alias" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplineAdminSettings" (
    "id" TEXT NOT NULL,
    "disciplineSlug" TEXT NOT NULL,
    "apiUrl" TEXT,
    "adminSportId" TEXT,
    "adminMax" TEXT,
    "defaultShapkaId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "dateFormat" TEXT NOT NULL DEFAULT 'DD.MM.YYYY HH:mm:ss',
    "requestMode" TEXT NOT NULL DEFAULT 'legacy_raw',
    "sslVerify" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplineAdminSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentAdminMapping" (
    "id" TEXT NOT NULL,
    "disciplineSlug" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "sourceTournamentId" TEXT,
    "sourceTournamentName" TEXT NOT NULL,
    "adminShapkaId" TEXT,
    "adminShapkaName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentAdminMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUploadLog" (
    "id" TEXT NOT NULL,
    "disciplineSlug" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "adminSportId" TEXT,
    "adminMax" TEXT,
    "adminShapkaId" TEXT,
    "requestMode" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "dateFormat" TEXT NOT NULL,
    "phpArrayJson" JSONB NOT NULL,
    "serializedFixt" TEXT NOT NULL,
    "readyMatchesCount" INTEGER NOT NULL,
    "skippedMatchesCount" INTEGER NOT NULL,
    "skippedMatchesJson" JSONB NOT NULL,
    "responseRaw" TEXT,
    "responseParsedJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUploadLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Discipline_slug_key" ON "Discipline"("slug");

-- CreateIndex
CREATE INDEX "SearchRequest_disciplineId_queryText_createdAt_idx" ON "SearchRequest"("disciplineId", "queryText", "createdAt");

-- CreateIndex
CREATE INDEX "SearchResult_pageId_idx" ON "SearchResult"("pageId");

-- CreateIndex
CREATE INDEX "SearchResult_title_idx" ON "SearchResult"("title");

-- CreateIndex
CREATE INDEX "TournamentImport_disciplineId_startedAt_idx" ON "TournamentImport"("disciplineId", "startedAt");

-- CreateIndex
CREATE INDEX "TournamentImport_pageTitle_idx" ON "TournamentImport"("pageTitle");

-- CreateIndex
CREATE INDEX "RawSnapshot_pageTitle_idx" ON "RawSnapshot"("pageTitle");

-- CreateIndex
CREATE INDEX "RawSnapshot_fetchedAt_idx" ON "RawSnapshot"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_lastImportId_key" ON "Tournament"("lastImportId");

-- CreateIndex
CREATE INDEX "Tournament_disciplineSlug_idx" ON "Tournament"("disciplineSlug");

-- CreateIndex
CREATE INDEX "Tournament_sourcePageId_idx" ON "Tournament"("sourcePageId");

-- CreateIndex
CREATE INDEX "Tournament_name_idx" ON "Tournament"("name");

-- CreateIndex
CREATE INDEX "Tournament_sourceUrl_idx" ON "Tournament"("sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_disciplineSlug_sourceTitle_key" ON "Tournament"("disciplineSlug", "sourceTitle");

-- CreateIndex
CREATE INDEX "TournamentParticipant_tournamentId_idx" ON "TournamentParticipant"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentParticipant_name_idx" ON "TournamentParticipant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_matchId_key" ON "TournamentMatch"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_lpNumericalId_key" ON "TournamentMatch"("lpNumericalId");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_idx" ON "TournamentMatch"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentMatch_matchDate_idx" ON "TournamentMatch"("matchDate");

-- CreateIndex
CREATE INDEX "TournamentMatch_platformId_idx" ON "TournamentMatch"("platformId");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyPool_url_key" ON "ProxyPool"("url");

-- CreateIndex
CREATE INDEX "AdminTeam_disciplineSlug_idx" ON "AdminTeam"("disciplineSlug");

-- CreateIndex
CREATE INDEX "AdminTeam_normalizedName_idx" ON "AdminTeam"("normalizedName");

-- CreateIndex
CREATE INDEX "TeamMapping_liquipediaName_idx" ON "TeamMapping"("liquipediaName");

-- CreateIndex
CREATE INDEX "TeamMapping_platformId_idx" ON "TeamMapping"("platformId");

-- CreateIndex
CREATE INDEX "TeamMapping_alias_idx" ON "TeamMapping"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMapping_disciplineSlug_liquipediaName_key" ON "TeamMapping"("disciplineSlug", "liquipediaName");

-- CreateIndex
CREATE UNIQUE INDEX "DisciplineAdminSettings_disciplineSlug_key" ON "DisciplineAdminSettings"("disciplineSlug");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentAdminMapping_tournamentId_key" ON "TournamentAdminMapping"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentAdminMapping_disciplineSlug_idx" ON "TournamentAdminMapping"("disciplineSlug");

-- CreateIndex
CREATE INDEX "AdminUploadLog_disciplineSlug_idx" ON "AdminUploadLog"("disciplineSlug");

-- CreateIndex
CREATE INDEX "AdminUploadLog_tournamentId_idx" ON "AdminUploadLog"("tournamentId");

-- AddForeignKey
ALTER TABLE "SearchRequest" ADD CONSTRAINT "SearchRequest_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_searchRequestId_fkey" FOREIGN KEY ("searchRequestId") REFERENCES "SearchRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentImport" ADD CONSTRAINT "TournamentImport_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawSnapshot" ADD CONSTRAINT "RawSnapshot_tournamentImportId_fkey" FOREIGN KEY ("tournamentImportId") REFERENCES "TournamentImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_lastImportId_fkey" FOREIGN KEY ("lastImportId") REFERENCES "TournamentImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

