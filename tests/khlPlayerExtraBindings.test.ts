import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";
import {
  confirmKhlPlayerExtraBinding,
  KhlPlayerExtraBindingError,
} from "../backend/src/results/khl/playerExtraBindings";
import { getKhlSettingsDirectory } from "../backend/src/results/khl/settingsDirectory";
import { ingestKhlEventDetail } from "../backend/src/results/khl/repository";
import { acquireKhlDatabaseSuiteLock } from "./helpers/khlDatabaseSuiteLock";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for khlPlayerExtraBindings.test.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let releaseSuiteLock: (() => Promise<void>) | undefined;

async function clearKhlTables() {
  await prisma.$transaction([
    prisma.khlDeliveryAttempt.deleteMany(),
    prisma.khlDelivery.deleteMany(),
    prisma.khlPlayerStatTarget.deleteMany(),
    prisma.khlTeamStatTarget.deleteMany(),
    prisma.khlTeamStatBinding.deleteMany(),
    prisma.khlPlayerExtraBinding.deleteMany(),
    prisma.khlMatchParticipant.deleteMany(),
    prisma.khlMatchRevision.deleteMany(),
    prisma.khlRawSnapshot.deleteMany(),
    prisma.khlMatch.deleteMany(),
    prisma.khlPlayer.deleteMany(),
    prisma.khlTeam.deleteMany(),
  ]);
}

test.before(async () => {
  releaseSuiteLock = await acquireKhlDatabaseSuiteLock(databaseUrl);
  await clearKhlTables();
  await ingestKhlEventDetail(prisma, {
    rawBody: readFileSync(
      join(process.cwd(), "tests", "fixtures", "khl", "regulation-901973.json"),
      "utf8"
    ),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
  });
});

test.after(async () => {
  try {
    await clearKhlTables();
  } finally {
    await prisma.$disconnect();
    await releaseSuiteLock?.();
  }
});

test("persists nine independent player-extra slots and reuses an identical confirmation", async () => {
  const player = await prisma.khlPlayer.findFirstOrThrow({ orderBy: { khlPlayerId: "asc" } });
  const input = {
    khlPlayerId: player.khlPlayerId,
    extraCode: "scores" as const,
    adminExtraId: "admin-extra-player-scores",
    adminExtraName: `${player.name} забьёт`,
    confirmedBy: "test-admin",
  };

  const first = await confirmKhlPlayerExtraBinding(prisma, input);
  const repeated = await confirmKhlPlayerExtraBinding(prisma, input);
  assert.equal(repeated.binding.id, first.binding.id);
  assert.equal(repeated.reused, true);
  assert.equal(await prisma.khlPlayerExtraBinding.count(), 1);

  const directory = await getKhlSettingsDirectory(prisma);
  const stored = directory.players.find((candidate) => candidate.khlPlayerId === player.khlPlayerId);
  assert.equal(stored?.extraBindings.length, 9);
  assert.deepEqual(
    stored?.extraBindings.find((binding) => binding.extraCode === "scores"),
    {
      extraCode: "scores",
      label: `${player.name} забьёт`,
      adminExtraId: "admin-extra-player-scores",
      adminExtraName: `${player.name} забьёт`,
      adminBindingStatus: "CONFIRMED",
      adminConfirmedAt: first.binding.adminConfirmedAt?.toISOString() ?? null,
      adminConfirmedBy: "test-admin",
    }
  );
});

test("rejects confirmed drift, unknown codes and reuse of an Admin ID by another extra", async () => {
  const players = await prisma.khlPlayer.findMany({ orderBy: { khlPlayerId: "asc" }, take: 2 });
  assert.equal(players.length, 2);
  const first = players[0];
  const second = players[1];

  await assert.rejects(
    confirmKhlPlayerExtraBinding(prisma, {
      khlPlayerId: first.khlPlayerId,
      extraCode: "scores",
      adminExtraId: "different-id",
      adminExtraName: `${first.name} забьёт`,
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlPlayerExtraBindingError
      && error.code === "CONFIRMED_BINDING_IMMUTABLE"
  );

  await assert.rejects(
    confirmKhlPlayerExtraBinding(prisma, {
      khlPlayerId: first.khlPlayerId,
      extraCode: "scores",
      adminExtraId: "admin-extra-player-scores",
      adminExtraName: "Другое подтверждённое название",
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlPlayerExtraBindingError
      && error.code === "CONFIRMED_BINDING_IMMUTABLE"
  );

  await assert.rejects(
    confirmKhlPlayerExtraBinding(prisma, {
      khlPlayerId: second.khlPlayerId,
      extraCode: "assists",
      adminExtraId: "admin-extra-player-scores",
      adminExtraName: `${second.name} отдаст голевую передачу`,
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlPlayerExtraBindingError
      && error.code === "ADMIN_ID_COLLISION"
  );

  await assert.rejects(
    confirmKhlPlayerExtraBinding(prisma, {
      khlPlayerId: second.khlPlayerId,
      extraCode: "unknown" as "scores",
      adminExtraId: "unknown-extra",
      adminExtraName: null,
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlPlayerExtraBindingError
      && error.code === "INVALID_BINDING"
  );
});

test("player-extra bindings never enter the canonical delivery payload contract", () => {
  const payloadSource = readFileSync("backend/src/results/khl/adminPayload.ts", "utf8");
  assert.doesNotMatch(payloadSource, /KhlPlayerExtraBinding|playerExtras|extraBindings/);
});
