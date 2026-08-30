-- TLine Admin hierarchy is additive: existing championships remain unassigned.
ALTER TYPE "TLineMappingStatus" ADD VALUE 'MANUAL_UNMAPPED';

ALTER TABLE "TLineChampionship" ADD COLUMN
    "globalHeaderId" TEXT;

CREATE TABLE "TLineGlobalHeader" (
    "id" TEXT NOT NULL,
    "sportConfigId" TEXT NOT NULL,
    "adminShapkaId" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TLineGlobalHeader_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TLineGlobalHeaderAdminTeam" (
    "globalHeaderId" TEXT NOT NULL,
    "adminTeamId" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "firstImportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastImportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TLineGlobalHeaderAdminTeam_pkey" PRIMARY KEY ("globalHeaderId", "adminTeamId")
);

CREATE UNIQUE INDEX "TLineGlobalHeader_sportConfigId_adminShapkaId_key"
    ON "TLineGlobalHeader"("sportConfigId", "adminShapkaId");
CREATE INDEX "TLineGlobalHeader_sportConfigId_active_idx"
    ON "TLineGlobalHeader"("sportConfigId", "active");
CREATE INDEX "TLineChampionship_globalHeaderId_idx"
    ON "TLineChampionship"("globalHeaderId");
CREATE INDEX "TLineGlobalHeaderAdminTeam_adminTeamId_idx"
    ON "TLineGlobalHeaderAdminTeam"("adminTeamId");

ALTER TABLE "TLineGlobalHeader"
    ADD CONSTRAINT "TLineGlobalHeader_sportConfigId_fkey"
    FOREIGN KEY ("sportConfigId") REFERENCES "TLineSportConfig"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineChampionship"
    ADD CONSTRAINT "TLineChampionship_globalHeaderId_fkey"
    FOREIGN KEY ("globalHeaderId") REFERENCES "TLineGlobalHeader"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineGlobalHeaderAdminTeam"
    ADD CONSTRAINT "TLineGlobalHeaderAdminTeam_globalHeaderId_fkey"
    FOREIGN KEY ("globalHeaderId") REFERENCES "TLineGlobalHeader"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TLineGlobalHeaderAdminTeam"
    ADD CONSTRAINT "TLineGlobalHeaderAdminTeam_adminTeamId_fkey"
    FOREIGN KEY ("adminTeamId") REFERENCES "AdminTeam"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce that a championship cannot reference a Shapka owned by another sport.
CREATE FUNCTION "tline_enforce_global_header_sport"() RETURNS trigger AS $$
BEGIN
  IF NEW."globalHeaderId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "TLineGlobalHeader" header
    WHERE header."id" = NEW."globalHeaderId"
      AND header."sportConfigId" = NEW."sportConfigId"
  ) THEN
    RAISE EXCEPTION 'TLine championship and global header must belong to the same sport';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TLineChampionship_global_header_sport_guard"
BEFORE INSERT OR UPDATE OF "sportConfigId", "globalHeaderId" ON "TLineChampionship"
FOR EACH ROW EXECUTE FUNCTION "tline_enforce_global_header_sport"();
