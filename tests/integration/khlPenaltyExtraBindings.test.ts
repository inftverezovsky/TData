import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { requireTestDatabaseUrl } from "../../scripts/helpers/testDatabase";
import { acquireKhlDatabaseSuiteLock } from "../helpers/khlDatabaseSuiteLock";
import {
  confirmKhlPenaltyExtraBinding, getKhlPenaltyExtraBindings, KhlPenaltyExtraBindingError,
} from "../../backend/src/results/khl/penaltyExtraBindings";

const databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let release: (() => Promise<void>) | undefined;
test.before(async () => {
  release = await acquireKhlDatabaseSuiteLock(databaseUrl);
  await prisma.khlPenaltyExtraBinding.deleteMany();
});
test.after(async () => {
  try { await prisma.khlPenaltyExtraBinding.deleteMany(); }
  finally { await prisma.$disconnect(); await release?.(); }
});

test("seven distinct penalty extras start unmapped and persist each confirmed Admin ID", async () => {
  const initial = await getKhlPenaltyExtraBindings(prisma);
  assert.equal(initial.length, 7);
  assert.equal(new Set(initial.map((item) => item.extraCode)).size, 7);
  assert.ok(initial.every((item) => item.adminExtraId === null && item.adminBindingStatus === "UNMAPPED"));
  for (const item of initial) {
    const result = await confirmKhlPenaltyExtraBinding(prisma, {
      extraCode: item.extraCode, adminExtraId: `test-${item.extraCode}`, confirmedBy: "test-operator",
    });
    assert.equal(result.reused, false);
  }
  const saved = await getKhlPenaltyExtraBindings(prisma);
  assert.ok(saved.every((item) => item.adminBindingStatus === "CONFIRMED" && item.adminExtraId === `test-${item.extraCode}`));
});

test("confirmed IDs are idempotent, immutable, and cannot be reused for another extra", async () => {
  const input = { extraCode: "first_penalty_team", adminExtraId: "test-first_penalty_team", confirmedBy: "test-operator" };
  assert.equal((await confirmKhlPenaltyExtraBinding(prisma, input)).reused, true);
  await assert.rejects(confirmKhlPenaltyExtraBinding(prisma, { ...input, adminExtraId: "replacement" }),
    (error: unknown) => error instanceof KhlPenaltyExtraBindingError && error.code === "CONFIRMED_BINDING_IMMUTABLE");
  await prisma.khlPenaltyExtraBinding.delete({ where: { extraCode: "last_penalty_team" } });
  await assert.rejects(confirmKhlPenaltyExtraBinding(prisma, { ...input, extraCode: "last_penalty_team" }),
    (error: unknown) => error instanceof KhlPenaltyExtraBindingError && error.code === "ADMIN_ID_COLLISION");
});

test("invalid codes and IDs never create bindings", async () => {
  const before = await prisma.khlPenaltyExtraBinding.count();
  for (const input of [
    { extraCode: "unknown", adminExtraId: "id" },
    { extraCode: "last_penalty_team", adminExtraId: "" },
    { extraCode: "last_penalty_team", adminExtraId: "a b" },
    { extraCode: "last_penalty_team", adminExtraId: "x".repeat(129) },
  ]) await assert.rejects(confirmKhlPenaltyExtraBinding(prisma, { ...input, confirmedBy: "test-operator" }),
    (error: unknown) => error instanceof KhlPenaltyExtraBindingError && error.code === "INVALID_BINDING");
  assert.equal(await prisma.khlPenaltyExtraBinding.count(), before);
});

test("concurrent identical confirmations reuse the same permanent binding", async () => {
  const input = { extraCode: "last_penalty_team", adminExtraId: "test-last-penalty", confirmedBy: "test-operator" };
  const results = await Promise.all([confirmKhlPenaltyExtraBinding(prisma, input), confirmKhlPenaltyExtraBinding(prisma, input)]);
  assert.equal(results.filter((result) => !result.reused).length, 1);
  assert.equal(await prisma.khlPenaltyExtraBinding.count({ where: { extraCode: input.extraCode } }), 1);
});
