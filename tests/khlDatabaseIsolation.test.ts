import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("every KHL database suite rejects a production database before creating PrismaClient", () => {
  const suites = readdirSync(join(process.cwd(), "tests/integration"))
    .filter((name) => /^khl.*\.test\.ts$/.test(name));
  assert.ok(suites.length >= 8);
  for (const name of suites) {
    // Перехватываем конструктор: даже при регрессии защиты этот тест не открывает соединение.
    const code = `
      const prisma = require("@prisma/client");
      Object.defineProperty(prisma, "PrismaClient", { value: class {
        constructor() { throw new Error("PRISMA_CONSTRUCTED_BEFORE_GUARD"); }
      } });
      require(${JSON.stringify(`./tests/integration/${name}`)});
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", code], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: { ...process.env, TEST_DATABASE_URL: "postgresql://127.0.0.1/production" },
    });
    assert.equal(result.error, undefined, name);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, /An isolated local test database is required/, name);
    assert.doesNotMatch(result.stderr, /PRISMA_CONSTRUCTED_BEFORE_GUARD/, name);
  }
});
