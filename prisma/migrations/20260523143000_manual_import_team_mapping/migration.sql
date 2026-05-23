CREATE TABLE "ManualImportTeamMapping" (
  "id" TEXT NOT NULL,
  "disciplineSlug" TEXT NOT NULL,
  "adminSportId" TEXT NOT NULL,
  "teamName" TEXT NOT NULL,
  "normalizedTeamName" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "canonicalName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManualImportTeamMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualImportTeamMapping_disciplineSlug_adminSportId_normalizedTeamName_key"
  ON "ManualImportTeamMapping"("disciplineSlug", "adminSportId", "normalizedTeamName");

CREATE INDEX "ManualImportTeamMapping_disciplineSlug_adminSportId_idx"
  ON "ManualImportTeamMapping"("disciplineSlug", "adminSportId");

CREATE INDEX "ManualImportTeamMapping_platformId_idx"
  ON "ManualImportTeamMapping"("platformId");
