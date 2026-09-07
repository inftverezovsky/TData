import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT_IMPORTERS = [
  "backend/src/sources/tdata/hltv/importTournament.ts",
  "backend/src/sources/tdata/vlr/importTournament.ts",
  "backend/src/sources/tdata/dltv/importTournament.ts",
  "backend/src/sources/tdata/fandom/importTournament.ts",
  "backend/src/sources/tbvolley/VolleyballWorld/importTournament.ts",
  "backend/src/sources/tbvolley/beach.volley.ru/importTournament.ts",
  "backend/src/sources/tbvolley/GermanBeachTour/importTournament.ts",
  "backend/src/sources/tbvolley/TwelveNdr/importTournament.ts",
  "backend/src/sources/tbvolley/CBV/importTournament.ts",
  "backend/src/sources/tbvolley/Federvolley/importTournament.ts",
  "backend/src/sources/tablet/WTT/importTournament.ts",
] as const;

test("every destructive tournament snapshot importer has an empty-result safety gate", () => {
  for (const relativePath of SNAPSHOT_IMPORTERS) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(
      source,
      /decideTournamentSnapshotWrite|shouldReplaceHltvMatchesOnImport|shouldReplaceDltvMatchesOnImport/,
      `${relativePath} must preserve last-good data on unexplained empty results`,
    );
  }
});

test("Liquipedia force refresh bypasses caches without pre-deleting business data", () => {
  const recursive = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
  ), "utf8");
  const singlePage = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/singlePage.ts",
  ), "utf8");

  assert.doesNotMatch(recursive, /clearTournamentForceRefreshState\s*\(/);
  assert.doesNotMatch(recursive, /!force\s*&&\s*shouldKeepPreviousMatches/);
  assert.doesNotMatch(singlePage, /if\s*\(force\)\s*{\s*await clearPageFetchCaches/);
});

test("validated esports snapshots commit tournament participants and matches transactionally", () => {
  const files = [
    "backend/src/sources/tdata/hltv/importTournament.ts",
    "backend/src/sources/tdata/vlr/importTournament.ts",
    "backend/src/sources/tdata/dltv/importTournament.ts",
    "backend/src/sources/tdata/fandom/importTournament.ts",
  ];
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, /runSerializableTournamentImport\s*\(\s*async\s*\(tx\)/, `${relativePath} must use a Serializable snapshot transaction`);
    assert.match(source, /client:\s*tx/, `${relativePath} must persist matches through the same transaction client`);
  }
});

test("Liquipedia collects every page before its business-data transaction", () => {
  const recursive = fs.readFileSync(path.join(ROOT, "backend/src/sources/tdata/liquipedia/importer/recursive.ts"), "utf8");
  const singlePage = fs.readFileSync(path.join(ROOT, "backend/src/sources/tdata/liquipedia/importer/singlePage.ts"), "utf8");
  const matchPreservation = fs.readFileSync(path.join(ROOT, "backend/src/sources/matchPreservation.ts"), "utf8");

  assert.match(recursive, /deferBusinessWrites:\s*true/g);
  assert.match(recursive, /prisma\.\$transaction\s*\(\s*async\s*\(tx\)/);
  assert.match(recursive, /refreshTournamentMatchesPreservingState\s*\(/);
  assert.match(matchPreservation, /params\.tx\.tournamentMatch\.deleteMany/);
  assert.match(recursive, /tx\.tournamentParticipant\.deleteMany/);
  assert.match(singlePage, /deferBusinessWrites/);
});

test("HLTV one-shot repair validates once and commits the validated snapshot atomically", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts/repair-hltv-event.ts"), "utf8");
  const normalizeAt = source.indexOf("normalizeHltvEventUrl");
  const scrapeAt = source.indexOf("runHltvScript(\"event\"");
  const transactionAt = source.indexOf("prisma.$transaction(async (tx)");

  assert.ok(normalizeAt >= 0 && scrapeAt > normalizeAt && transactionAt > scrapeAt);
  assert.equal(source.match(/runHltvScript\(\"event\"/g)?.length, 1);
  assert.doesNotMatch(source, /importHltvTournament/);
  assert.match(source, /saveHltvTournamentMatches\([\s\S]*client:\s*tx/);
});

test("numeric source identities are qualified by provider URLs", () => {
  const hltv = fs.readFileSync(path.join(ROOT, "backend/src/sources/tdata/hltv/importTournament.ts"), "utf8");
  const vlr = fs.readFileSync(path.join(ROOT, "backend/src/sources/tdata/vlr/importTournament.ts"), "utf8");
  const liquipediaSingle = fs.readFileSync(path.join(ROOT, "backend/src/sources/tdata/liquipedia/importer/singlePage.ts"), "utf8");
  const liquipediaRecursive = fs.readFileSync(path.join(ROOT, "backend/src/sources/tdata/liquipedia/importer/recursive.ts"), "utf8");

  assert.match(hltv, /sourcePageId,[\s\S]{0,300}https:\/\/www\.hltv\.org\/events\//);
  assert.match(vlr, /sourcePageId:\s*params\.sourcePageId,[\s\S]{0,300}https:\/\/www\.vlr\.gg\/event\//);
  assert.match(liquipediaSingle, /sourcePageId:\s*Number\(params\.sourcePageId\),[\s\S]{0,350}https:\/\/liquipedia\.net\/\$\{params\.disciplineSlug\}\//);
  assert.match(liquipediaRecursive, /sourcePageId:\s*Number\(params\.sourcePageId\),[\s\S]{0,350}https:\/\/liquipedia\.net\/\$\{params\.disciplineSlug\}\//);
});
