-- Beach volleyball matches are grouped by court, not match format.
UPDATE "TournamentMatch" AS "match"
SET "format" = NULL
FROM "Tournament" AS "tournament"
WHERE "match"."tournamentId" = "tournament"."id"
  AND "tournament"."disciplineSlug" = 'beachvolleyball'
  AND "match"."format" IS NOT NULL;
