import type { Prisma } from "@prisma/client";

/** Keep the lock inside the caller's transaction without returning PostgreSQL's void type to Prisma. */
export async function acquireTransactionLock(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext(${key}))
  `;
}
