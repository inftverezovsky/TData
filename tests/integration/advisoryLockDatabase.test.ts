import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { acquireTransactionLock } from "../../backend/src/db/advisoryLock";
import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";

const databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const holder = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

test.after(async () => {
  await Promise.all([holder.$disconnect(), observer.$disconnect()]);
});

test("PostgreSQL reproduces the Prisma void decoding failure from the reported import", async () => {
  const key = `void-regression:${randomUUID()}`;
  await assert.rejects(
    holder.$transaction((tx) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`),
    /Failed to deserialize column of type 'void'/,
  );
});

test("source lock keys work with the real PostgreSQL driver and leave the transaction usable", async () => {
  const suffix = randomUUID();
  const namespaces = ["liquipedia-import", "liquipedia:dota2:page:force", "tournament-import:dota2", "tournament-participants", "tournament-match"];
  await holder.$transaction(async (tx) => {
    for (const namespace of namespaces) {
      await acquireTransactionLock(tx, `${namespace}:${suffix}:'; SELECT 'literal-only'; --`);
    }
    assert.deepEqual(await tx.$queryRaw`SELECT 1 AS usable`, [{ usable: 1 }]);
  });
});

for (const outcome of ["commit", "rollback"] as const) {
  test(`a parser lock excludes competing transactions and is released after ${outcome}`, { timeout: 15_000 }, async () => {
    const key = `transaction-lock:${randomUUID()}`;
    const acquired = deferred();
    const release = deferred();
    const rollback = new Error("intentional test rollback");
    const transaction = holder.$transaction(async (tx) => {
      await acquireTransactionLock(tx, key);
      acquired.resolve();
      await release.promise;
      if (outcome === "rollback") throw rollback;
    }, { timeout: 10_000 });
    void transaction.catch(acquired.reject);
    const completion = outcome === "rollback"
      ? assert.rejects(transaction, (error) => error === rollback)
      : transaction;

    try {
      await acquired.promise;
      await observer.$transaction(async (tx) => {
        const competing = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired
        `;
        assert.deepEqual(competing, [{ acquired: false }], "the import lock must remain held until its transaction ends");
        // A different import is independent and must remain able to proceed.
        await acquireTransactionLock(tx, `${key}:unrelated`);
      });
    } finally {
      release.resolve();
      await completion;
    }

    await observer.$transaction(async (tx) => {
      const afterCompletion = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired
      `;
      assert.deepEqual(afterCompletion, [{ acquired: true }], "finished imports must not leave stale locks");
    });
  });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
