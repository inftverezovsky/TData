-- Additive TLine floorball pilot. Existing and scheduled runs stay strict by default.
ALTER TABLE "TLineRun"
    ADD COLUMN "includeUndatedSourceMatches" BOOLEAN NOT NULL DEFAULT false;

-- Admin identifiers and automation remain unset so production stays fail-closed.
INSERT INTO "Discipline" ("id", "slug", "name", "isEnabled", "createdAt")
VALUES ('tline-discipline-floorball', 'floorball', 'Флорбол', true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "TLineSportConfig" (
    "id", "disciplineId", "adminSportId", "active", "autoEnabled",
    "autoPeriodFromOffsetMinutes", "autoPeriodToOffsetMinutes",
    "candidateMatchWindowMinutes", "defaultAllowedTimeDriftMinutes", "updatedAt"
)
SELECT
    'tline-sport-floorball', "id", NULL, true, false,
    NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP
FROM "Discipline"
WHERE "slug" = 'floorball'
ON CONFLICT ("disciplineId") DO NOTHING;

INSERT INTO "TLineChampionship" (
    "id", "sportConfigId", "globalHeaderId", "name", "season", "sourceProvider", "sourceUrl",
    "sourceChampionshipId", "adminChampionshipId", "adminChampionshipName",
    "sourceTimezone", "active", "autoEnabled", "allowedTimeDriftMinutes",
    "candidateMatchWindowMinutes", "updatedAt"
)
SELECT
    'tline-floorball-russia-hl-2026', sport."id", NULL,
    'Флорбол. Россия. Высшая лига', '2026/27', 'nffr-floorball',
    'https://xn--m1agla.xn--p1ai/sport/calendar/200',
    '200', NULL, NULL, 'Europe/Moscow',
    true, false, NULL, NULL, CURRENT_TIMESTAMP
FROM "TLineSportConfig" sport
JOIN "Discipline" discipline ON discipline."id" = sport."disciplineId"
WHERE discipline."slug" = 'floorball'
ON CONFLICT ("sportConfigId", "sourceProvider", "sourceUrl") DO NOTHING;
