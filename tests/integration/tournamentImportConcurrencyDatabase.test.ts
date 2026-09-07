import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";
import { refreshTournamentParticipantsPreservingState } from "../../backend/src/sources/participantPreservation";
import {
  assertTournamentImportFresh,
  runSerializableTournamentImport,
  StaleTournamentImportError,
} from "../../backend/src/sources/tournamentImportConcurrency";

const testDatabaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);

{
  test(
    "a concurrent older import cannot overwrite a newer commit",
    {
      concurrency: false,
      timeout: 30_000,
    },
    async () => {
      const databaseUrl = testDatabaseUrl;
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const suffix = randomUUID().replaceAll("-", "");
      const disciplineSlug = `import-race-${suffix}`;

      try {
        const discipline = await prisma.discipline.create({
          data: { slug: disciplineSlug, name: `Import race ${suffix}` },
        });
        const older = await prisma.tournamentImport.create({
          data: {
            disciplineId: discipline.id,
            pageTitle: `event-${suffix}`,
            pageUrl: `https://example.test/event/${suffix}`,
            startedAt: new Date("2026-08-30T12:00:00.000Z"),
          },
        });
        const newer = await prisma.tournamentImport.create({
          data: {
            disciplineId: discipline.id,
            pageTitle: `event-${suffix}`,
            pageUrl: `https://example.test/event/${suffix}`,
            startedAt: new Date("2026-08-30T12:00:01.000Z"),
          },
        });
        const tournament = await prisma.tournament.create({
          data: {
            sourceTitle: `event-${suffix}`,
            sourceUrl: `https://example.test/event/${suffix}`,
            name: "Import race",
            disciplineSlug,
          },
        });

        const newerReady = deferred();
        const releaseNewer = deferred();
        const newerCommit = runSerializableTournamentImport(
          async (tx) => {
            await assertTournamentImportFresh({
              tx,
              importRecordId: newer.id,
              disciplineSlug,
              sourceIdentity: tournament.sourceUrl,
              tournamentId: tournament.id,
            });
            await tx.tournament.update({ where: { id: tournament.id }, data: { lastImportId: newer.id } });
            await tx.tournamentImport.update({ where: { id: newer.id }, data: { status: "SUCCESS" } });
            newerReady.resolve();
            await releaseNewer.promise;
          },
          { client: prisma },
        );

        await withTimeout(newerReady.promise, "newer import did not reach its hold point");
        const olderLockAttempted = deferred();
        let olderAttempts = 0;
        const olderCommit = runSerializableTournamentImport(
          async (tx) => {
            olderAttempts += 1;
            // Фиксируем снимок до снятия блокировки: иначе PostgreSQL вправе увидеть
            // свежий commit сразу и отклонить импорт без serialization retry.
            await tx.tournament.findUniqueOrThrow({ where: { id: tournament.id }, select: { id: true } });
            const observed = olderAttempts === 1 ? observeFirstQuery(tx, olderLockAttempted.resolve) : tx;
            await assertTournamentImportFresh({
              tx: observed,
              importRecordId: older.id,
              disciplineSlug,
              sourceIdentity: tournament.sourceUrl,
              tournamentId: tournament.id,
            });
            await tx.tournament.update({ where: { id: tournament.id }, data: { lastImportId: older.id } });
          },
          { client: prisma, maxAttempts: 3 },
        );
        const olderRejected = assert.rejects(olderCommit, StaleTournamentImportError);

        try {
          await withTimeout(olderLockAttempted.promise, "older import did not attempt the freshness lock");
        } finally {
          releaseNewer.resolve();
        }
        await Promise.all([newerCommit, olderRejected]);
        assert.equal(
          (await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } })).lastImportId,
          newer.id,
        );
        assert.ok(olderAttempts >= 2, "the blocked stale transaction must retry against the committed lastImport");
      } finally {
        await cleanup(prisma, disciplineSlug);
      }
    },
  );

  test(
    "a concurrent TeamMapping propagation keeps participant identity and platformId",
    {
      concurrency: false,
      timeout: 30_000,
    },
    async () => {
      const databaseUrl = testDatabaseUrl;
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const suffix = randomUUID().replaceAll("-", "");
      const disciplineSlug = `participant-race-${suffix}`;

      try {
        await prisma.discipline.create({ data: { slug: disciplineSlug, name: `Participant race ${suffix}` } });
        const tournament = await prisma.tournament.create({
          data: {
            sourceTitle: `participant-event-${suffix}`,
            sourceUrl: `https://example.test/participant/${suffix}`,
            name: "Participant race",
            disciplineSlug,
            participants: { create: { name: "Race Team" } },
          },
          include: { participants: true },
        });
        await prisma.teamMapping.create({ data: { disciplineSlug, liquipediaName: "Race Team" } });

        const participant = tournament.participants[0];
        const manualReady = deferred();
        const releaseManual = deferred();
        const manualEdit = prisma.$transaction(
          async (tx) => {
            await tx.teamMapping.update({
              where: { disciplineSlug_liquipediaName: { disciplineSlug, liquipediaName: "Race Team" } },
              data: {
                platformId: "manual-platform",
                status: "manual_mapped",
                isManual: true,
                isLockedFromAutoMapping: true,
              },
            });
            await tx.tournamentParticipant.updateMany({
              where: { tournamentId: tournament.id, name: "Race Team" },
              data: { platformId: "manual-platform" },
            });
            manualReady.resolve();
            await releaseManual.promise;
          },
          { timeout: 10_000 },
        );

        await withTimeout(manualReady.promise, "manual edit did not reach its hold point");
        const firstRead = deferred();
        let attempts = 0;
        const refresh = runSerializableTournamentImport(
          async (tx) => {
            attempts += 1;
            const observed = attempts === 1 ? observeParticipantRead(tx, firstRead.resolve) : tx;
            await refreshTournamentParticipantsPreservingState({
              tx: observed,
              tournamentId: tournament.id,
              participants: [{ tournamentId: tournament.id, name: "Race Team", platformId: null }],
            });
          },
          { client: prisma, maxAttempts: 3 },
        );

        try {
          await withTimeout(firstRead.promise, "refresh did not read the participant");
        } finally {
          releaseManual.resolve();
        }
        await Promise.all([manualEdit, refresh]);

        const stored = await prisma.tournamentParticipant.findMany({ where: { tournamentId: tournament.id } });
        assert.equal(stored.length, 1);
        assert.equal(stored[0].id, participant.id);
        assert.equal(stored[0].platformId, "manual-platform");
        assert.ok(attempts >= 2, "the serializable conflict must retry with a fresh participant snapshot");
        const mapping = await prisma.teamMapping.findUniqueOrThrow({
          where: { disciplineSlug_liquipediaName: { disciplineSlug, liquipediaName: "Race Team" } },
        });
        assert.equal(mapping.platformId, "manual-platform");
      } finally {
        await cleanup(prisma, disciplineSlug);
      }
    },
  );
}

function observeFirstQuery(tx: Prisma.TransactionClient, onAttempt: () => void) {
  let observed = false;
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property !== "$queryRaw") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        if (!observed) {
          observed = true;
          onAttempt();
        }
        return (target.$queryRaw as (...queryArgs: unknown[]) => Promise<unknown>).call(target, ...args);
      };
    },
  });
}

function observeParticipantRead(tx: Prisma.TransactionClient, onRead: () => void) {
  return {
    $queryRaw: (...args: unknown[]) =>
      (tx.$queryRaw as (...queryArgs: unknown[]) => Promise<unknown>).call(tx, ...args),
    tournamentParticipant: {
      findMany: async (args: Parameters<typeof tx.tournamentParticipant.findMany>[0]) => {
        const result = await tx.tournamentParticipant.findMany(args);
        onRead();
        return result;
      },
      update: (args: Parameters<typeof tx.tournamentParticipant.update>[0]) => tx.tournamentParticipant.update(args),
      create: (args: Parameters<typeof tx.tournamentParticipant.create>[0]) => tx.tournamentParticipant.create(args),
      deleteMany: (args: Parameters<typeof tx.tournamentParticipant.deleteMany>[0]) =>
        tx.tournamentParticipant.deleteMany(args),
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

async function cleanup(prisma: PrismaClient, disciplineSlug: string) {
  const disciplineIds = (
    await prisma.discipline.findMany({
      where: { slug: disciplineSlug },
      select: { id: true },
    })
  ).map((item) => item.id);
  await prisma.tournament.deleteMany({ where: { disciplineSlug } }).catch(() => {});
  await prisma.teamMapping.deleteMany({ where: { disciplineSlug } }).catch(() => {});
  await prisma.tournamentImport.deleteMany({ where: { disciplineId: { in: disciplineIds } } }).catch(() => {});
  await prisma.discipline.deleteMany({ where: { slug: disciplineSlug } }).catch(() => {});
  await prisma.$disconnect();
}
