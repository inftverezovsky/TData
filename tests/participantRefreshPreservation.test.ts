import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { mergeTournamentParticipantManualFields } from "../backend/src/sources/participantPreservation";

const IMPORTERS = [
  "backend/src/sources/tablet/WTT/importTournament.ts",
  "backend/src/sources/tbvolley/VolleyballWorld/importTournament.ts",
  "backend/src/sources/tbvolley/beach.volley.ru/importTournament.ts",
  "backend/src/sources/tbvolley/GermanBeachTour/importTournament.ts",
  "backend/src/sources/tbvolley/TwelveNdr/importTournament.ts",
  "backend/src/sources/tbvolley/CBV/importTournament.ts",
  "backend/src/sources/tbvolley/Federvolley/importTournament.ts",
] as const;

const ESPORTS_IMPORTERS = [
  "backend/src/sources/tdata/hltv/importTournament.ts",
  "backend/src/sources/tdata/vlr/importTournament.ts",
  "backend/src/sources/tdata/dltv/importTournament.ts",
  "backend/src/sources/tdata/fandom/importTournament.ts",
  "backend/src/sources/tdata/liquipedia/importer/singlePage.ts",
  "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
] as const;

test("participant refresh keeps existing manual fields ahead of source data and TeamMapping", () => {
  const merged = mergeTournamentParticipantManualFields({
    incoming: {
      platformId: "source-platform",
      seed: "source-seed",
      region: "source-region",
      status: "source-status",
      logoUrl: "https://source.example/logo.png",
      rawText: "source raw",
    },
    existing: {
      platformId: "manual-platform",
      seed: "manual-seed",
      region: "manual-region",
      status: "manual-status",
      logoUrl: "https://manual.example/logo.png",
      rawText: "manual raw",
    },
    mapping: {
      platformId: "mapping-platform",
      logoUrl: "https://mapping.example/logo.png",
    },
  });

  assert.deepEqual(merged, {
    platformId: "manual-platform",
    seed: "manual-seed",
    region: "manual-region",
    status: "manual-status",
    logoUrl: "https://manual.example/logo.png",
    rawText: "manual raw",
  });
});

test("participant refresh preserves intentional empty manual strings", () => {
  const merged = mergeTournamentParticipantManualFields({
    incoming: { platformId: "source", logoUrl: "source", rawText: "source" },
    existing: { platformId: "", logoUrl: "", rawText: "" },
    mapping: { platformId: "mapping", logoUrl: "mapping" },
  });

  assert.equal(merged.platformId, "");
  assert.equal(merged.logoUrl, "");
  assert.equal(merged.rawText, "");
});

test("participant refresh falls back to source fields and then TeamMapping", () => {
  const sourceFirst = mergeTournamentParticipantManualFields({
    incoming: { platformId: "source-platform", logoUrl: "source-logo", rawText: "source raw" },
    existing: { platformId: null, logoUrl: null, rawText: null },
    mapping: { platformId: "mapping-platform", logoUrl: "mapping-logo" },
  });
  assert.equal(sourceFirst.platformId, "source-platform");
  assert.equal(sourceFirst.logoUrl, "source-logo");
  assert.equal(sourceFirst.rawText, "source raw");

  const mappingFallback = mergeTournamentParticipantManualFields({
    incoming: { platformId: null, logoUrl: null, rawText: null },
    existing: null,
    mapping: { platformId: "mapping-platform", logoUrl: "mapping-logo" },
  });
  assert.equal(mappingFallback.platformId, "mapping-platform");
  assert.equal(mappingFallback.logoUrl, "mapping-logo");
  assert.equal(mappingFallback.rawText, null);
});

test("WTT and volleyball force refreshes always load existing participants", () => {
  for (const relativePath of IMPORTERS) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, /mergeTournamentParticipantManualFields\s*\(/, relativePath);
    assert.match(source, /tournamentParticipant\.findMany\s*\(/, relativePath);
    assert.doesNotMatch(
      source,
      /params\.force\s*\?\s*Promise\.resolve\(\[\]/,
      `${relativePath} must not discard participant state during force refresh`,
    );
  }
});

test("esports participant refreshes preserve every manual field through the shared merge", () => {
  for (const relativePath of ESPORTS_IMPORTERS) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, /mergeTournamentParticipantManualFields\s*\(/, relativePath);
    assert.match(source, /tournamentParticipant\.findMany\s*\(/, relativePath);
  }
});

test("Fandom force refresh preserves last-good cache until the tournament commits", () => {
  const relativePath = "backend/src/sources/tdata/fandom/importTournament.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const fetchStart = source.indexOf("async function fetchFandomPageWithCache");
  const fetchEnd = source.indexOf("async function rawSnapshotToParsedPage", fetchStart);
  const fetchBody = source.slice(fetchStart, fetchEnd);

  assert.match(fetchBody, /sourceCache[^=\n]*=\s*await findSourceFetchCache\(cacheInput\)/);
  assert.match(fetchBody, /if\s*\(!params\.force\s*&&\s*sourceCache\?\.rawSnapshotId/);
  assert.doesNotMatch(fetchBody, /clearFandomPageCaches|rawSnapshot\.deleteMany|clearSourceFetchCache/);

  const transactionIndex = source.indexOf("const committed = await runSerializableTournamentImport");
  const publishIndex = source.indexOf("await publishFandomPageCache", transactionIndex);
  assert.ok(transactionIndex >= 0, "Fandom business transaction must exist");
  assert.ok(publishIndex > transactionIndex, "fresh cache must be published only after the business transaction commits");
});
