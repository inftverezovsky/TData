import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  compareTournamentImportFreshness,
  isRetryableTournamentImportTransactionError,
  runSerializableTournamentImport,
} from "../backend/src/sources/tournamentImportConcurrency";
import { processSinglePage } from "../backend/src/sources/tdata/liquipedia/importer/singlePage";

const ROOT = path.resolve(import.meta.dirname, "..");

const DESTRUCTIVE_NON_RECURSIVE_IMPORTERS = [
  "backend/src/sources/tablet/WTT/importTournament.ts",
  "backend/src/sources/tdata/hltv/importTournament.ts",
  "backend/src/sources/tdata/vlr/importTournament.ts",
  "backend/src/sources/tdata/dltv/importTournament.ts",
  "backend/src/sources/tdata/fandom/importTournament.ts",
  "backend/src/sources/tbvolley/beach.volley.ru/importTournament.ts",
  "backend/src/sources/tbvolley/GermanBeachTour/importTournament.ts",
  "backend/src/sources/tbvolley/TwelveNdr/importTournament.ts",
  "backend/src/sources/tbvolley/CBV/importTournament.ts",
  "backend/src/sources/tbvolley/Federvolley/importTournament.ts",
  "backend/src/sources/tbvolley/VolleyballWorld/importTournament.ts",
] as const;

test("TournamentImport freshness is ordered by startedAt and then id", () => {
  const base = new Date("2026-08-30T12:00:00.000Z");
  assert.equal(compareTournamentImportFreshness(
    { id: "candidate-b", startedAt: base },
    { id: "candidate-a", startedAt: base },
  ), 1);
  assert.equal(compareTournamentImportFreshness(
    { id: "candidate-a", startedAt: new Date(base.getTime() - 1) },
    { id: "candidate-z", startedAt: base },
  ), -1);
  assert.equal(compareTournamentImportFreshness(
    { id: "same", startedAt: base },
    { id: "same", startedAt: base },
  ), 0);
});

test("only Prisma serialization/deadlock conflicts are retried", () => {
  assert.equal(isRetryableTournamentImportTransactionError({ code: "P2034" }), true);
  assert.equal(isRetryableTournamentImportTransactionError({ code: "P2002" }), false);
  assert.equal(isRetryableTournamentImportTransactionError(new Error("network timeout")), false);
});

test("Serializable import transactions retry the complete callback after P2034", async () => {
  let transactionAttempts = 0;
  const isolationLevels: unknown[] = [];
  const client = {
    $transaction: async <T>(operation: (tx: never) => Promise<T>, options: { isolationLevel?: unknown }) => {
      transactionAttempts += 1;
      isolationLevels.push(options.isolationLevel);
      if (transactionAttempts === 1) throw { code: "P2034" };
      return operation({} as never);
    },
  };

  const result = await runSerializableTournamentImport(async () => "committed", {
    client: client as never,
    maxAttempts: 2,
  });
  assert.equal(result, "committed");
  assert.equal(transactionAttempts, 2);
  assert.deepEqual(isolationLevels, ["Serializable", "Serializable"]);
});

test("every destructive non-recursive importer uses the shared freshness and participant race guards", () => {
  for (const relativePath of DESTRUCTIVE_NON_RECURSIVE_IMPORTERS) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.match(source, /runSerializableTournamentImport\s*\(/, relativePath);
    assert.match(source, /assertTournamentImportFresh\s*\(/, relativePath);
    assert.match(source, /refreshTournamentParticipantsPreservingState\s*\(/, relativePath);
    assert.doesNotMatch(
      source,
      /tournamentParticipant\.deleteMany\s*\(/,
      `${relativePath} must not delete/recreate participants from a stale snapshot`,
    );
    assert.doesNotMatch(
      source,
      /if\s*\(\s*!params\.client\s*\)/,
      `${relativePath} cannot expose a destructive fallback transaction outside the freshness fence`,
    );
    const transactionAt = source.indexOf("runSerializableTournamentImport(async (tx)");
    const freshnessAt = source.indexOf("assertTournamentImportFresh({", transactionAt);
    const destructiveTournamentWriteAt = source.indexOf("tx.tournament.", freshnessAt);
    assert.ok(transactionAt >= 0, `${relativePath} must open the shared transaction`);
    assert.ok(freshnessAt > transactionAt, `${relativePath} must check freshness inside the transaction`);
    assert.ok(
      destructiveTournamentWriteAt > freshnessAt,
      `${relativePath} must fence freshness before tournament mutation`,
    );
    assert.match(source, /lastImportId:\s*(?:importRecord\.id|tournamentImport\.id|(?:params\.)?importRecordId)/, relativePath);
  }
});

test("all HLTV, VLR and DLTV refreshes create a TournamentImport before source I/O", () => {
  const cases = [
    ["backend/src/sources/tdata/hltv/importTournament.ts", "runHltvScript"],
    ["backend/src/sources/tdata/vlr/importTournament.ts", "runVlrScraper"],
    ["backend/src/sources/tdata/dltv/importTournament.ts", "runDltv"],
  ] as const;

  for (const [relativePath, sourceCall] of cases) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    const createAt = source.indexOf("tournamentImport.create");
    const fetchAt = source.indexOf(sourceCall, createAt + 1);
    assert.ok(createAt >= 0, `${relativePath} must create a TournamentImport candidate`);
    assert.ok(fetchAt > createAt, `${relativePath} must timestamp the candidate before source I/O`);
    assert.match(source, /tournamentImport\.updateMany\s*\([\s\S]*?status:\s*"PENDING"/, relativePath);
  }
});

test("Liquipedia singlePage has no reachable direct destructive path", () => {
  const recursive = fs.readFileSync(
    path.join(ROOT, "backend/src/sources/tdata/liquipedia/importer/recursive.ts"),
    "utf8",
  );
  const repositorySources = fs.readdirSync(
    path.join(ROOT, "backend/src/sources/tdata/liquipedia/importer"),
  ).filter((name) => name.endsWith(".ts"));
  const callers = repositorySources.flatMap((name) => {
    const source = fs.readFileSync(
      path.join(ROOT, "backend/src/sources/tdata/liquipedia/importer", name),
      "utf8",
    );
    return [...source.matchAll(/processSinglePage\s*\(\s*\{/g)].map(() => name);
  });

  assert.deepEqual(callers, ["recursive.ts", "recursive.ts"]);
  assert.equal((recursive.match(/deferBusinessWrites:\s*true/g) || []).length, 2);
});

test("Liquipedia singlePage rejects a future direct business-write caller before source I/O", async () => {
  await assert.rejects(
    processSinglePage({
      disciplineId: "discipline",
      disciplineSlug: "dota2",
      apiUrl: "https://liquipedia.net/api.php",
      title: "Unsafe direct import",
      pageUrl: "https://liquipedia.net/dota2/Unsafe_direct_import",
      normalizer: () => ({}),
      importRecordId: "import",
      deferBusinessWrites: false as true,
    }),
    /direct business writes are disabled/,
  );
});
