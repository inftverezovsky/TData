ALTER TABLE "AdminTeam"
ADD COLUMN "platformNameRu" TEXT,
ADD COLUMN "platformNameEn" TEXT,
ADD COLUMN "normalizedNameRu" TEXT,
ADD COLUMN "normalizedNameEn" TEXT;

UPDATE "AdminTeam"
SET
  "platformNameRu" = CASE WHEN "platformName" ~ '[А-Яа-яЁё]' THEN "platformName" ELSE NULL END,
  "platformNameEn" = CASE WHEN "platformName" ~ '[A-Za-z]' AND "platformName" !~ '[А-Яа-яЁё]' THEN "platformName" ELSE NULL END,
  "normalizedNameRu" = CASE WHEN "platformName" ~ '[А-Яа-яЁё]' THEN "normalizedName" ELSE NULL END,
  "normalizedNameEn" = CASE WHEN "platformName" ~ '[A-Za-z]' AND "platformName" !~ '[А-Яа-яЁё]' THEN "normalizedName" ELSE NULL END;

CREATE INDEX "AdminTeam_normalizedNameRu_idx" ON "AdminTeam"("normalizedNameRu");
CREATE INDEX "AdminTeam_normalizedNameEn_idx" ON "AdminTeam"("normalizedNameEn");
