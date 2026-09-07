import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";
import { reserveLoginAttempt, clearLoginAttempts, loginRateLimitKey } from "../../backend/src/auth/loginRateLimit";

const databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);

test("login limit is atomic across clients and persists when a worker reconnects", async () => {
  const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const clientKey = `integration-${randomUUID()}`;
  try {
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) => reserveLoginAttempt(clientKey, index % 2 ? first : second)));
    assert.equal(results.filter((result) => result.allowed).length, 8);
    await first.$disconnect();
    assert.equal((await reserveLoginAttempt(clientKey, second)).allowed, false);
    assert.ok((await reserveLoginAttempt(clientKey, second)).retryAfterSeconds > 0);
    await second.adminLoginRateLimit.update({ where: { key: loginRateLimitKey(clientKey) }, data: { expiresAt: new Date(0) } });
    assert.equal((await reserveLoginAttempt(clientKey, second)).allowed, true);
    await clearLoginAttempts(clientKey, second);
    assert.equal(await second.adminLoginRateLimit.count({ where: { key: loginRateLimitKey(clientKey) } }), 0);
  } finally {
    await second.adminLoginRateLimit.deleteMany({ where: { key: loginRateLimitKey(clientKey) } });
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
});
