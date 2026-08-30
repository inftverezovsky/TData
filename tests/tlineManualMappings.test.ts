import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  clearManualTLineTeamMapping,
  saveManualTLineTeamMapping,
  unlockTLineTeamMapping,
} from "../backend/src/tline/mappings/manualMapping";

function sourceTeam() {
  return {
    id: "source-1",
    name: "Локомотив",
    championshipId: "champ-1",
    championship: {
      globalHeader: { id: "header-1", active: true },
      sportConfig: { discipline: { slug: "volleyball" } },
    },
  };
}

test("manual mapping accepts a directory Team ID and locks the championship-scoped row", async () => {
  let upsertInput: Record<string, unknown> | null = null;
  const client = {
    tLineSourceTeam: { findUnique: async () => sourceTeam() },
    adminTeam: { findFirst: async () => ({ id: "admin-7", platformId: "7", platformName: "Локомотив" }) },
    tLineGlobalHeaderAdminTeam: { findUnique: async () => ({ adminTeamId: "admin-7" }) },
    tLineTeamMapping: { upsert: async (input: Record<string, unknown>) => { upsertInput = input; return { id: "mapping-1", isLocked: true }; } },
  } as unknown as PrismaClient;
  const result = await saveManualTLineTeamMapping(client, { championshipId: "champ-1", sourceTeamId: "source-1", platformId: "7" });
  assert.equal(result.inDirectory, true);
  assert.ok(upsertInput);
  const capturedUpdate = (upsertInput as unknown as { update: Record<string, unknown> }).update;
  assert.deepEqual(capturedUpdate, {
    championshipId: "champ-1",
    adminTeamId: "admin-7",
    status: "MANUAL_MAPPED",
    confidenceScore: 1,
    matchMethod: "manual",
    isLocked: true,
    confirmedAt: capturedUpdate.confirmedAt,
  });
});

test("free Team ID creates a deterministic AdminTeam outside the Shapka directory", async () => {
  let created: Record<string, unknown> | null = null;
  const client = {
    tLineSourceTeam: { findUnique: async () => sourceTeam() },
    adminTeam: {
      findFirst: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => { created = create; return create; },
    },
    tLineGlobalHeaderAdminTeam: { findUnique: async () => null },
    tLineTeamMapping: { upsert: async () => ({ id: "mapping-2", isLocked: true }) },
  } as unknown as PrismaClient;
  const result = await saveManualTLineTeamMapping(client, { championshipId: "champ-1", sourceTeamId: "source-1", platformId: "987654", adminName: "Локо" });
  assert.equal(result.inDirectory, false);
  assert.ok(created);
  assert.equal((created as unknown as { id: string }).id, "admin_volleyball_987654");
  assert.equal((created as unknown as { platformName: string }).platformName, "Локо");
});

test("soft clear blocks automapping and explicit unlock makes the row eligible again", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    tLineTeamMapping: {
      findUniqueOrThrow: async () => ({ status: "MANUAL_UNMAPPED", matchMethod: "manual_unmapped" }),
      update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return data; },
    },
  } as unknown as PrismaClient;
  await clearManualTLineTeamMapping(client, "mapping-1");
  await unlockTLineTeamMapping(client, "mapping-1");
  assert.equal(updates[0]?.status, "MANUAL_UNMAPPED");
  assert.equal(updates[0]?.isLocked, true);
  assert.deepEqual(updates[1], { isLocked: false, status: "UNMAPPED", matchMethod: null, confirmedAt: null });
});

test("manual mapping cannot cross championship boundaries", async () => {
  const client = { tLineSourceTeam: { findUnique: async () => sourceTeam() } } as unknown as PrismaClient;
  await assert.rejects(
    saveManualTLineTeamMapping(client, { championshipId: "other", sourceTeamId: "source-1", platformId: "7" }),
    /selected championship/i,
  );
});
