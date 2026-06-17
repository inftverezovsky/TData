-- Some providers expose unresolved bracket slots as "Draw".
-- Keep the source name, but prevent these rows from being treated as real teams.
UPDATE "TournamentMatch"
SET
  "hasPlaceholderTeams" = TRUE,
  "teamAId" = CASE
    WHEN lower(trim(COALESCE("teamAName", ''))) IN ('draw', 'main draw', 'qualification draw', 'qualifying draw') THEN 'tbd'
    ELSE "teamAId"
  END,
  "teamBId" = CASE
    WHEN lower(trim(COALESCE("teamBName", ''))) IN ('draw', 'main draw', 'qualification draw', 'qualifying draw') THEN 'tbd'
    ELSE "teamBId"
  END
WHERE lower(trim(COALESCE("teamAName", ''))) IN ('draw', 'main draw', 'qualification draw', 'qualifying draw')
   OR lower(trim(COALESCE("teamBName", ''))) IN ('draw', 'main draw', 'qualification draw', 'qualifying draw');
