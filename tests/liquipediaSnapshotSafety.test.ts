import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assessLiquipediaSnapshotHealth,
  buildLiquipediaStableTournamentKey,
  preserveLiquipediaMatchState,
} from "../backend/src/sources/tdata/liquipedia/importer/snapshotSafety";
import { shouldSkipLiquipediaSourceFetchPublication } from "../backend/src/sources/tdata/liquipedia/importer/singlePage";
import { mergeTournamentWarningNormalization } from "../backend/src/sources/tdata/liquipedia/importer/helpers";
import {
  evaluateLiquipediaSnapshotQualityGate,
  findLiquipediaTournamentForCommit,
  mergeLiquipediaDiagnosticsNormalization,
  shouldRejectSupersededLiquipediaImport,
  type LiquipediaImportFreshness,
} from "../backend/src/sources/tdata/liquipedia/importer/recursive";

const ROOT = path.resolve(import.meta.dirname, "..");

test("Liquipedia title fallback cannot claim another provider's tournament", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    tournament: {
      findUnique: async () => null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        calls.push(where);
        if (where.sourceTitle === "Shared title" && !("OR" in where)) {
          return { id: "foreign-provider" };
        }
        return null;
      },
    },
  };

  const found = await findLiquipediaTournamentForCommit({
    client: client as never,
    existingTournamentId: null,
    disciplineSlug: "counterstrike",
    sourcePageId: null,
    sourceUrl: "https://liquipedia.net/counterstrike/Shared_Title",
    sourceTitle: "Shared title",
  });

  assert.equal(found, null);
  assert.deepEqual(calls[1], {
    disciplineSlug: "counterstrike",
    sourceTitle: "Shared title",
    OR: [
      { sourceUrl: { startsWith: "https://liquipedia.net/counterstrike/" } },
      { sourceUrl: { startsWith: "https://www.liquipedia.net/counterstrike/" } },
      { sourceUrl: "" },
    ],
  });
});

test("both Liquipedia lookup paths qualify title fallback by provider URL", () => {
  for (const relativePath of [
    "backend/src/sources/tdata/liquipedia/importer/singlePage.ts",
    "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(
      source,
      /sourceTitle:\s*params\.sourceTitle,[\s\S]{0,400}sourceUrl:\s*\{\s*startsWith:\s*`https:\/\/liquipedia\.net\/\$\{params\.disciplineSlug\}\//,
      relativePath,
    );
  }
});

test("Liquipedia snapshot health includes every fulfilled subpage semantic result", () => {
  const healthyMain = {
    normalized: { status: "SUCCESS" },
    stale: false,
    warning: null,
  };

  assert.deepEqual(
    assessLiquipediaSnapshotHealth({ pages: [healthyMain] }),
    { sourceValidated: true, aggregateStatus: "SUCCESS", errorClass: null, reasons: [] },
  );

  const partial = assessLiquipediaSnapshotHealth({
    pages: [
      healthyMain,
      { normalized: { status: "PARTIAL" }, stale: false, warning: null },
    ],
  });
  assert.equal(partial.sourceValidated, false);
  assert.equal(partial.aggregateStatus, "PARTIAL");
  assert.equal(partial.errorClass, "parse_failed");
  assert.match(partial.reasons.join(" "), /PARTIAL/);

  const stale = assessLiquipediaSnapshotHealth({
    pages: [
      healthyMain,
      { normalized: { status: "SUCCESS" }, stale: true, warning: "stale fallback" },
    ],
  });
  assert.equal(stale.sourceValidated, false);
  assert.equal(stale.aggregateStatus, "PARTIAL");
  assert.equal(stale.errorClass, "parse_failed");
  assert.match(stale.reasons.join(" "), /stale|warning/i);

  const rejected = assessLiquipediaSnapshotHealth({ pages: [healthyMain], rejectedSubpages: 1 });
  assert.equal(rejected.sourceValidated, false);
  assert.match(rejected.reasons.join(" "), /rejected/i);

  const sourceWarning = assessLiquipediaSnapshotHealth({
    pages: [{ normalized: { status: "SUCCESS", warning: "template changed" } }],
  });
  assert.equal(sourceWarning.sourceValidated, false);
  assert.match(sourceWarning.reasons.join(" "), /template changed/);

  const informationalNormalizerWarning = assessLiquipediaSnapshotHealth({
    pages: [{ normalized: { status: "SUCCESS", warnings: ["Извлечено 12 матчей из parsed HTML"] } }],
  });
  assert.equal(informationalNormalizerWarning.sourceValidated, true);
});

test("Liquipedia match namespace is stable across mutable title changes", () => {
  const before = buildLiquipediaStableTournamentKey({
    disciplineSlug: "counterstrike",
    sourcePageId: 8249,
    sourceUrl: "https://liquipedia.net/counterstrike/Old_Title",
    sourceTitle: "Old Title",
  });
  const after = buildLiquipediaStableTournamentKey({
    disciplineSlug: "counterstrike",
    sourcePageId: 8249,
    sourceUrl: "https://liquipedia.net/counterstrike/New_Title",
    sourceTitle: "New Title",
  });
  assert.equal(before, "page:counterstrike:8249");
  assert.equal(after, before);
  assert.notEqual(
    buildLiquipediaStableTournamentKey({
      disciplineSlug: "valorant",
      sourcePageId: 8249,
      sourceUrl: null,
      sourceTitle: "Same numeric page id on another wiki",
    }),
    before,
  );

  assert.equal(
    buildLiquipediaStableTournamentKey({
      disciplineSlug: "counterstrike",
      sourceUrl: "HTTPS://LIQUIPEDIA.NET/counterstrike/Event/?utm_source=test#matches",
      sourceTitle: "Mutable title",
    }),
    "url:counterstrike:https://liquipedia.net/counterstrike/Event",
  );
});

test("Liquipedia refresh preserves manual match state from stable or semantic identity", () => {
  const incoming = {
    matchId: "match_new",
    platformId: null,
    syncedAt: null,
    lpNumericalId: 222n,
    teamAName: "A",
  };
  const existing = {
    matchId: "match_old",
    platformId: "admin-42",
    syncedAt: new Date("2026-08-30T12:00:00.000Z"),
    lpNumericalId: 111n,
  };

  assert.deepEqual(preserveLiquipediaMatchState(incoming, existing), {
    ...incoming,
    platformId: "admin-42",
    syncedAt: existing.syncedAt,
    lpNumericalId: 111n,
  });
});

test("Liquipedia commit upserts incoming matches before deleting stale rows and rejects preserved snapshots", () => {
  const recursive = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
  ), "utf8");
  const matchPreservation = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/matchPreservation.ts",
  ), "utf8");
  const dispatcher = fs.readFileSync(path.join(ROOT, "backend/src/imports/dispatcher.ts"), "utf8");

  assert.doesNotMatch(recursive, /const mainTournamentKey = title\.trim\(\)/);
  assert.match(recursive, /refreshTournamentMatchesPreservingState\s*\(/);
  const upsertAt = matchPreservation.indexOf("params.tx.tournamentMatch.upsert");
  const deleteStaleAt = matchPreservation.indexOf("matchId: { notIn:");
  assert.ok(upsertAt >= 0 && deleteStaleAt > upsertAt);
  assert.doesNotMatch(recursive, /tournamentMatch\.deleteMany\(\{ where: \{ tournamentId: tournament\.id \} \}\)/);
  assert.match(recursive, /throw new TournamentSnapshotRejectedError[\s\S]*qualityGateWarning/);
  assert.match(dispatcher, /TournamentSnapshotRejectedError[\s\S]*status:\s*isSnapshotRejection\s*\?\s*"PARTIAL"\s*:\s*"FAILED"/);
});

test("Liquipedia publishes source cache success only after the aggregate transaction commits", () => {
  const singlePage = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/singlePage.ts",
  ), "utf8");
  const recursive = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
  ), "utf8");

  assert.match(singlePage, /sourceFetchPublicationNeeded[\s\S]*!stale[\s\S]*!warning[\s\S]*normalized\.status === "SUCCESS"/);
  assert.equal((singlePage.match(/markSourceFetchSuccess\(/g) || []).length, 1);
  const transactionAt = recursive.indexOf("const commitResult = await prisma.$transaction");
  const publishAt = recursive.indexOf("publishLiquipediaSourceFetchSuccess(publication)");
  assert.ok(transactionAt >= 0 && publishAt > transactionAt);
  assert.match(singlePage, /TransactionIsolationLevel\.Serializable/);
});

test("Liquipedia cache publication cannot replace a newer raw snapshot", () => {
  const base = {
    candidateRawSnapshotId: "old",
    candidateRevisionId: 100,
    candidateRevisionTimestamp: new Date("2026-08-30T10:00:00Z"),
    candidateFetchedAt: new Date("2026-08-30T10:01:00Z"),
    currentRawSnapshotId: "new",
    currentRevisionId: 101,
    currentRevisionTimestamp: new Date("2026-08-30T11:00:00Z"),
    currentFetchedAt: new Date("2026-08-30T11:01:00Z"),
  };
  assert.equal(shouldSkipLiquipediaSourceFetchPublication(base), true);
  assert.equal(shouldSkipLiquipediaSourceFetchPublication({
    ...base,
    candidateRevisionId: 102,
    candidateRevisionTimestamp: new Date("2026-08-30T12:00:00Z"),
  }), false);
  assert.equal(shouldSkipLiquipediaSourceFetchPublication({
    ...base,
    candidateRawSnapshotId: "new",
  }), false);
  assert.equal(shouldSkipLiquipediaSourceFetchPublication({
    ...base,
    candidateRevisionId: null,
    candidateRevisionTimestamp: new Date("2026-08-30T12:00:00Z"),
  }), true);
  assert.equal(shouldSkipLiquipediaSourceFetchPublication({
    ...base,
    candidateRevisionId: null,
    currentRevisionId: null,
    candidateRevisionTimestamp: null,
    currentRevisionTimestamp: null,
  }), true);
});

test("Liquipedia cache CAS prefers revision id when timestamps tie and responses finish out of order", () => {
  const tiedTimestamp = new Date("2026-08-30T11:00:00Z");
  assert.equal(shouldSkipLiquipediaSourceFetchPublication({
    candidateRawSnapshotId: "revision-100-finished-last",
    candidateRevisionId: 100,
    candidateRevisionTimestamp: tiedTimestamp,
    candidateFetchedAt: new Date("2026-08-30T11:05:00Z"),
    currentRawSnapshotId: "revision-101-finished-first",
    currentRevisionId: 101,
    currentRevisionTimestamp: tiedTimestamp,
    currentFetchedAt: new Date("2026-08-30T11:04:00Z"),
  }), true);
});

test("Liquipedia recursive import rejects an older revision that finishes after a newer import", async () => {
  const older = freshness({ revisionId: 100, importStartedAt: "2026-08-30T10:00:00Z" });
  const newer = freshness({ revisionId: 101, importStartedAt: "2026-08-30T10:01:00Z" });
  const releaseOlder = deferred<void>();
  const releaseNewer = deferred<void>();
  let applied: LiquipediaImportFreshness | null = null;

  const commit = async (candidate: LiquipediaImportFreshness, gate: Promise<void>) => {
    await gate;
    if (applied && shouldRejectSupersededLiquipediaImport(candidate, applied)) return false;
    applied = candidate;
    return true;
  };
  const olderCommit = commit(older, releaseOlder.promise);
  const newerCommit = commit(newer, releaseNewer.promise);

  releaseNewer.resolve();
  assert.equal(await newerCommit, true);
  releaseOlder.resolve();
  assert.equal(await olderCommit, false);
  assert.equal((applied as LiquipediaImportFreshness | null)?.revisionId, 101);
});

test("Liquipedia recursive freshness falls back to import order when the committed revision is unavailable", () => {
  const olderWithRevision = freshness({ revisionId: 100, importStartedAt: "2026-08-30T10:00:00Z" });
  const newerWithoutRevision = {
    ...freshness({ revisionId: 101, importStartedAt: "2026-08-30T10:01:00Z" }),
    revisionId: null,
    revisionTimestamp: null,
  };
  assert.equal(shouldRejectSupersededLiquipediaImport(olderWithRevision, newerWithoutRevision), true);
});

test("Liquipedia recursive commit serializes by stable key before reading the current tournament", () => {
  const recursive = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
  ), "utf8");
  const transactionAt = recursive.indexOf("const commitResult = await prisma.$transaction");
  const lockAt = recursive.indexOf("pg_advisory_xact_lock", transactionAt);
  const lookupAt = recursive.indexOf("findLiquipediaTournamentForCommit", lockAt);
  assert.ok(transactionAt >= 0 && lockAt > transactionAt && lookupAt > lockAt);
  assert.match(recursive, /liquipediaImportFreshness/);
});

test("Liquipedia diagnostics CAS cannot overwrite a newer committed normalization", async () => {
  const older = freshness({ revisionId: 100, importStartedAt: "2026-08-30T10:00:00Z" });
  const newer = freshness({ revisionId: 101, importStartedAt: "2026-08-30T10:01:00Z" });
  const releaseStaleDiagnostics = deferred<void>();
  let normalization: Record<string, unknown> = normalizationWithFreshness(older, "old-state");

  const staleDiagnostics = (async () => {
    await releaseStaleDiagnostics.promise;
    const patched = mergeLiquipediaDiagnosticsNormalization({
      currentNormalization: normalization,
      expectedFreshness: older,
      key: "dota2Diagnostics",
      diagnostics: { source: "older-import" },
    });
    if (patched) normalization = patched as Record<string, unknown>;
    return Boolean(patched);
  })();

  normalization = normalizationWithFreshness(newer, "new-state");
  releaseStaleDiagnostics.resolve();

  assert.equal(await staleDiagnostics, false);
  assert.equal(normalization.stateVersion, "new-state");
  assert.deepEqual(
    (normalization.liquipediaImportFreshness as Record<string, unknown>).revisionId,
    101,
  );
  assert.equal(normalization.dota2Diagnostics, undefined);
});

test("Liquipedia warning patch preserves freshness and fields committed while it waited for the lock", () => {
  const newer = freshness({ revisionId: 101, importStartedAt: "2026-08-30T10:01:00Z" });
  const normalization = normalizationWithFreshness(newer, "new-state");
  const patched = mergeTournamentWarningNormalization(normalization, "quality gate rejected stale data") as Record<string, unknown>;

  assert.equal(patched.stateVersion, "new-state");
  assert.deepEqual(patched.liquipediaImportFreshness, normalization.liquipediaImportFreshness);
  assert.deepEqual(patched.warnings, ["quality gate rejected stale data"]);
  assert.equal(patched.qualityGateKeptPrevious, true);
});

test("Liquipedia re-runs the match quality gate after acquiring the commit lock", async () => {
  const candidateMatches = [qualityMatch(0)];
  const preflight = evaluateLiquipediaSnapshotQualityGate({
    incomingMatches: candidateMatches,
    previousMatches: [],
    sourceHadError: false,
    sourceValidated: true,
  });
  assert.equal(preflight.keepPrevious, false);

  const releaseCommit = deferred<void>();
  let persistedMatches = Array.from({ length: 20 }, (_, index) => qualityMatch(index + 1));
  const commit = (async () => {
    await releaseCommit.promise;
    const lockedGate = evaluateLiquipediaSnapshotQualityGate({
      incomingMatches: candidateMatches,
      previousMatches: persistedMatches,
      sourceHadError: false,
      sourceValidated: true,
    });
    if (lockedGate.keepPrevious) return false;
    persistedMatches = candidateMatches;
    return true;
  })();

  releaseCommit.resolve();
  assert.equal(await commit, false);
  assert.equal(persistedMatches.length, 20);

  const recursive = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
  ), "utf8");
  const transactionAt = recursive.indexOf("const commitResult = await prisma.$transaction");
  const lockAt = recursive.indexOf("pg_advisory_xact_lock", transactionAt);
  const currentMatchesAt = recursive.indexOf("lockedCurrentMatches", lockAt);
  const tournamentMutationAt = recursive.indexOf("const tournament = existingTournament", lockAt);
  assert.ok(lockAt > transactionAt && currentMatchesAt > lockAt && tournamentMutationAt > currentMatchesAt);
});

test("Liquipedia diagnostics and warning writes share the business advisory lock", () => {
  const recursive = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/liquipedia/importer/recursive.ts",
  ), "utf8");
  const diagnosticsAt = recursive.indexOf("async function persistMergedDiagnostics");
  const diagnosticsLockAt = recursive.indexOf("pg_advisory_xact_lock", diagnosticsAt);
  const diagnosticsReadAt = recursive.indexOf("latestTournament", diagnosticsAt);
  const warningAt = recursive.indexOf("appendTournamentWarning", recursive.indexOf("const commitResult"));
  assert.ok(diagnosticsAt >= 0 && diagnosticsLockAt > diagnosticsAt && diagnosticsReadAt > diagnosticsLockAt);
  assert.ok(warningAt > recursive.indexOf("pg_advisory_xact_lock", recursive.indexOf("const commitResult")));
});

test("Liquipedia business revision IDs are final when both are valid", () => {
  const current = freshness({ revisionId: 101, importStartedAt: "2026-08-30T10:01:00Z" });
  const lowerRevisionWithNewerTimes = {
    ...freshness({ revisionId: 100, importStartedAt: "2026-08-30T12:01:00Z" }),
    revisionTimestamp: new Date("2026-08-30T12:00:00Z"),
    fetchedAt: new Date("2026-08-30T12:01:00Z"),
  };
  const higherRevisionWithOlderTimes = {
    ...freshness({ revisionId: 102, importStartedAt: "2026-08-30T08:01:00Z" }),
    revisionTimestamp: new Date("2026-08-30T08:00:00Z"),
    fetchedAt: new Date("2026-08-30T08:01:00Z"),
  };
  assert.equal(shouldRejectSupersededLiquipediaImport(lowerRevisionWithNewerTimes, current), true);
  assert.equal(shouldRejectSupersededLiquipediaImport(higherRevisionWithOlderTimes, current), false);

  const invalidCurrentRevision = {
    ...current,
    revisionId: 0,
    revisionTimestamp: new Date("2026-08-30T11:00:00Z"),
  };
  const validCandidateWithOlderTimestamp = {
    ...higherRevisionWithOlderTimes,
    revisionId: 102,
  };
  assert.equal(shouldRejectSupersededLiquipediaImport(validCandidateWithOlderTimestamp, invalidCurrentRevision), true);
});

function freshness(overrides: { revisionId: number; importStartedAt: string }): LiquipediaImportFreshness {
  return {
    revisionId: overrides.revisionId,
    revisionTimestamp: new Date("2026-08-30T11:00:00Z"),
    fetchedAt: new Date("2026-08-30T11:01:00Z"),
    importStartedAt: new Date(overrides.importStartedAt),
  };
}

function normalizationWithFreshness(
  marker: LiquipediaImportFreshness,
  stateVersion: string,
): Record<string, unknown> {
  return {
    stateVersion,
    liquipediaImportFreshness: {
      revisionId: marker.revisionId,
      revisionTimestamp: marker.revisionTimestamp?.toISOString() ?? null,
      fetchedAt: marker.fetchedAt?.toISOString() ?? null,
      importStartedAt: marker.importStartedAt.toISOString(),
    },
  };
}

function qualityMatch(index: number) {
  return {
    matchId: `match-${index}`,
    matchDate: new Date(`2026-08-${String((index % 20) + 1).padStart(2, "0")}T12:00:00Z`),
    teamAName: `Alpha ${index}`,
    teamBName: `Beta ${index}`,
    sourceUrl: `https://liquipedia.net/match/${index}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
