import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { dispatchTournamentImport } from "../backend/src/imports/dispatcher";

test("import dispatcher returns a safe result for a database error before import begins", async (context) => {
  const runtime = globalThis as typeof globalThis & { prisma?: PrismaClient };
  const previous = runtime.prisma;
  const logs: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  runtime.prisma = {
    discipline: { upsert: async () => { throw new Error("synthetic-sensitive-query-value"); } },
  } as unknown as PrismaClient;
  context.after(() => { runtime.prisma = previous; });
  const result = await dispatchTournamentImport("dota2", { title: "Local fixture", source: "liquipedia" });
  assert.ok(!JSON.stringify(result).includes("synthetic-sensitive-query-value"));
  assert.ok(!JSON.stringify(logs).includes("synthetic-sensitive-query-value"));
  assert.equal(result.status, 500);
});
