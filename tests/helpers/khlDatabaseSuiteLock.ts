import { Prisma, PrismaClient } from "@prisma/client";

const KHL_DATABASE_SUITE_LOCK = 1_261_855_316;
const LOCK_TIMEOUT_MS = 120_000;

export async function acquireKhlDatabaseSuiteLock(
  databaseUrl: string
): Promise<() => Promise<void>> {
  const lockClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let markAcquired: (() => void) | undefined;
  let releaseLock: (() => void) | undefined;
  const acquired = new Promise<void>((resolve) => {
    markAcquired = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const transaction = lockClient.$transaction(
    async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${KHL_DATABASE_SUITE_LOCK})`
      );
      markAcquired?.();
      await release;
    },
    { maxWait: LOCK_TIMEOUT_MS, timeout: LOCK_TIMEOUT_MS }
  );

  try {
    await Promise.race([acquired, transaction]);
  } catch (error) {
    await lockClient.$disconnect();
    throw error;
  }

  return async () => {
    releaseLock?.();
    try {
      await transaction;
    } finally {
      await lockClient.$disconnect();
    }
  };
}
