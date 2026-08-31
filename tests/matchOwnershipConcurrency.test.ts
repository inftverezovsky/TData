import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";
import { refreshTournamentMatchesPreservingState } from "../backend/src/sources/matchPreservation";

const RUN_DATABASE_TEST = process.env.RUN_MATCH_OWNERSHIP_DB_TESTS === "1";

if (!RUN_DATABASE_TEST) {
  test("concurrent imports cannot claim the same global matchId", {
    skip: "Set RUN_MATCH_OWNERSHIP_DB_TESTS=1 with an isolated TEST_DATABASE_URL to run this PostgreSQL regression.",
  }, () => {});
} else {
  test("concurrent imports cannot claim the same global matchId", { concurrency: false, timeout: 20_000 }, async () => {
    const databaseUrl = requireIsolatedMatchOwnershipDatabaseUrl(process.env.TEST_DATABASE_URL);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = randomUUID().replaceAll("-", "");
    const disciplineSlug = `match-ownership-${suffix}`;
    const matchId = `ownership-race-${suffix}`;

    try {
      await prisma.discipline.create({
        data: { slug: disciplineSlug, name: `Match ownership ${suffix}` },
      });
      const [tournamentA, tournamentB] = await Promise.all([
        prisma.tournament.create({
          data: {
            sourceTitle: `ownership-a-${suffix}`,
            sourceUrl: `https://example.test/a/${suffix}`,
            name: "Ownership A",
            disciplineSlug,
          },
        }),
        prisma.tournament.create({
          data: {
            sourceTitle: `ownership-b-${suffix}`,
            sourceUrl: `https://example.test/b/${suffix}`,
            name: "Ownership B",
            disciplineSlug,
          },
        }),
      ]);

      const aReady = deferred();
      const releaseA = deferred();
      const bLockAttempted = deferred();
      const transactionA = prisma.$transaction(async (tx) => {
        await refreshTournamentMatchesPreservingState({
          tx,
          tournamentId: tournamentA.id,
          matches: [matchRow(matchId, tournamentA.id, "from-a")],
        });
        aReady.resolve();
        await releaseA.promise;
      }, { timeout: 10_000 });

      await withTimeout(aReady.promise, "first transaction did not reach its hold point");
      const transactionB = prisma.$transaction(async (tx) => {
        await refreshTournamentMatchesPreservingState({
          tx: observeFirstAdvisoryLockAttempt(tx, bLockAttempted.resolve),
          tournamentId: tournamentB.id,
          matches: [matchRow(matchId, tournamentB.id, "from-b")],
        });
      }, { timeout: 10_000 });
      const bRejected = assert.rejects(transactionB, /belongs to another tournament/);

      try {
        await withTimeout(bLockAttempted.promise, "second transaction did not attempt the ownership lock");
      } finally {
        releaseA.resolve();
      }
      await Promise.all([transactionA, bRejected]);

      const stored = await prisma.tournamentMatch.findUniqueOrThrow({ where: { matchId } });
      assert.equal(stored.tournamentId, tournamentA.id);
      assert.equal(stored.teamAName, "from-a");
      assert.equal(await prisma.tournamentMatch.count({ where: { tournamentId: tournamentB.id } }), 0);
    } finally {
      await prisma.tournament.deleteMany({ where: { disciplineSlug } }).catch(() => {});
      await prisma.discipline.deleteMany({ where: { slug: disciplineSlug } }).catch(() => {});
      await prisma.$disconnect();
    }
  });
}

function matchRow(matchId: string, tournamentId: string, teamAName: string) {
  return {
    matchId,
    create: { matchId, tournamentId, teamAName },
    update: { teamAName },
  };
}

function observeFirstAdvisoryLockAttempt(
  tx: Prisma.TransactionClient,
  onAttempt: () => void,
) {
  let observed = false;
  return {
    $queryRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      if (!observed) {
        observed = true;
        onAttempt();
      }
      return (tx.$queryRaw as (...args: unknown[]) => Promise<unknown>).call(tx, query, ...values);
    },
    tournamentMatch: {
      findMany: (args: Parameters<typeof tx.tournamentMatch.findMany>[0]) => tx.tournamentMatch.findMany(args),
      upsert: (args: Parameters<typeof tx.tournamentMatch.upsert>[0]) => tx.tournamentMatch.upsert(args),
      deleteMany: (args: Parameters<typeof tx.tournamentMatch.deleteMany>[0]) => tx.tournamentMatch.deleteMany(args),
    },
  } as unknown as Prisma.TransactionClient;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withTimeout(promise: Promise<void>, message: string) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 5_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function requireIsolatedMatchOwnershipDatabaseUrl(value: string | undefined) {
  if (!value) throw new Error("TEST_DATABASE_URL is required when RUN_MATCH_OWNERSHIP_DB_TESTS=1");
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const optedInDocker = process.env.ALLOW_DOCKER_TEST_DATABASE_HOST === "1" && url.hostname === "postgres";
  const isolatedDatabase = /^tdata_match_ownership_test(?:_|$)/u.test(databaseName)
    || databaseName === "tdata_khl_test_parser_reliability";
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !(loopback || optedInDocker) || !isolatedDatabase) {
    throw new Error("Match ownership regression requires an isolated test database; Docker host postgres needs explicit opt-in");
  }
  return value;
}
