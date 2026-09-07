import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";

type LockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

test("parser queries never return PostgreSQL's unsupported advisory-lock void column", () => {
  const root = path.resolve(import.meta.dirname, "../backend/src");
  const unsafeFiles = fs.readdirSync(root, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".ts"))
    .filter((entry) => /\$queryRaw(?:<[^>]+>)?\s*`\s*SELECT\s+pg_advisory_xact_lock\s*\(/i.test(
      fs.readFileSync(path.join(root, entry), "utf8"),
    ));

  assert.deepEqual(unsafeFiles, [], "Prisma cannot deserialize a PostgreSQL void result; select a supported column instead");
});

test("transaction lock keeps source-controlled lock keys in bound parameters", async () => {
  const { acquireTransactionLock } = await import("../backend/src/db/advisoryLock");
  const key = "liquipedia-import:quote'_$1); SELECT 'other'; --";
  let observedQuery = "";
  let observedValues: unknown[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      observedQuery = strings.join("?");
      observedValues = values;
      return [{ locked: 1 }];
    },
  } as unknown as LockClient;

  assert.equal(await acquireTransactionLock(tx, key), undefined);
  assert.deepEqual(observedValues, [key]);
  assert.ok(!observedQuery.includes(key), "the key must not become executable SQL");
});

test("transaction lock waits until PostgreSQL has acquired the lock", async () => {
  const { acquireTransactionLock } = await import("../backend/src/db/advisoryLock");
  let release!: () => void;
  let resolved = false;
  const query = new Promise<void>((resolve) => { release = resolve; });
  const tx = { $queryRaw: () => query } as unknown as LockClient;
  const acquired = acquireTransactionLock(tx, "waiting-import").then(() => { resolved = true; });

  await Promise.resolve();
  assert.equal(resolved, false, "business writes must not run before the lock is acquired");
  release();
  await acquired;
  assert.equal(resolved, true);
});

test("transaction lock preserves database failures for rollback and retry decisions", async () => {
  const { acquireTransactionLock } = await import("../backend/src/db/advisoryLock");
  const failure = Object.assign(new Error("serialization conflict"), { code: "P2034" });
  const tx = { $queryRaw: async () => { throw failure; } } as unknown as LockClient;

  await assert.rejects(acquireTransactionLock(tx, "failed-import"), (error) => error === failure);
});
