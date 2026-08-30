-- Additive TLine Belarus hockey pilot. Admin identifiers and automation remain
-- unset so production stays fail-closed until the operator configures them.
INSERT INTO "Discipline" ("id", "slug", "name", "isEnabled", "createdAt")
VALUES ('tline-discipline-hockey', 'hockey', 'Хоккей', true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "TLineSportConfig" (
    "id", "disciplineId", "adminSportId", "active", "autoEnabled",
    "autoPeriodFromOffsetMinutes", "autoPeriodToOffsetMinutes",
    "candidateMatchWindowMinutes", "defaultAllowedTimeDriftMinutes", "updatedAt"
)
SELECT
    'tline-sport-hockey', "id", NULL, true, false,
    NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP
FROM "Discipline"
WHERE "slug" = 'hockey'
ON CONFLICT ("disciplineId") DO NOTHING;

INSERT INTO "TLineChampionship" (
    "id", "sportConfigId", "globalHeaderId", "name", "season", "sourceProvider", "sourceUrl",
    "sourceChampionshipId", "adminChampionshipId", "adminChampionshipName",
    "sourceTimezone", "active", "autoEnabled", "allowedTimeDriftMinutes",
    "candidateMatchWindowMinutes", "updatedAt"
)
SELECT
    'tline-hockey-belarus-hl-2026', sport."id", NULL,
    'Хоккей. Беларусь. Высшая лига', '2026/27', 'hockey-by',
    'https://hockey.by/calendar/',
    '11:5', NULL, NULL, 'Europe/Minsk',
    true, false, NULL, NULL, CURRENT_TIMESTAMP
FROM "TLineSportConfig" sport
JOIN "Discipline" discipline ON discipline."id" = sport."disciplineId"
WHERE discipline."slug" = 'hockey'
ON CONFLICT ("sportConfigId", "sourceProvider", "sourceUrl") DO NOTHING;
