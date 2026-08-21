import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";
import {
  KhlBindingConflictError,
  confirmKhlMatchBinding,
  confirmKhlPlayerBinding,
  confirmKhlTeamBinding,
} from "../backend/src/results/khl/bindings";
import { ingestKhlEventDetail } from "../backend/src/results/khl/repository";
import { acquireKhlDatabaseSuiteLock } from "./helpers/khlDatabaseSuiteLock";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for khlBindings.test.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let releaseSuiteLock: (() => Promise<void>) | undefined;

const compatibleCandidate = {
  adminMatchId: "admin-match-42",
  startsAt: "2026-05-21T16:30:00.000Z",
  homeAdminTeamId: "admin-team-home",
  awayAdminTeamId: "admin-team-away",
  season: "2025/2026",
  stageId: "395",
};

async function clearKhlTables() {
  await prisma.$transaction([
    prisma.khlDeliveryAttempt.deleteMany(),
    prisma.khlDelivery.deleteMany(),
    prisma.khlPlayerStatTarget.deleteMany(),
    prisma.khlTeamStatTarget.deleteMany(),
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
  const rawBody = readFileSync(
    join(process.cwd(), "tests", "fixtures", "khl", "regulation-901973.json"),
    "utf8"
  );
  await ingestKhlEventDetail(prisma, {
    rawBody,
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
  });
});

test.after(async () => {
  try {
    await clearKhlTables();
  } finally {
    try {
      await prisma.$disconnect();
    } finally {
      await releaseSuiteLock?.();
    }
  }
});

test("match binding is blocked until both team ids are explicitly confirmed", async () => {
  await assert.rejects(
    confirmKhlMatchBinding(prisma, {
      khlGameId: "901973",
      adminMatchId: "admin-match-42",
      candidates: [compatibleCandidate],
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "UNMAPPED_TEAM"
  );
});

test("confirmed team and match mappings produce a stable identity key", async () => {
  const match = await prisma.khlMatch.findUniqueOrThrow({
    where: { khlGameId: "901973" },
    include: { homeTeam: true, awayTeam: true },
  });
  await confirmKhlTeamBinding(prisma, {
    khlTeamId: match.homeTeam.khlTeamId,
    adminTeamId: "admin-team-home",
    confirmedBy: "test-admin",
  });
  await confirmKhlTeamBinding(prisma, {
    khlTeamId: match.awayTeam.khlTeamId,
    adminTeamId: "admin-team-away",
    confirmedBy: "test-admin",
  });
  await assert.rejects(
    confirmKhlMatchBinding(prisma, {
      khlGameId: "901973",
      adminMatchId: "admin-match-42",
      candidates: [],
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "MATCH_RESOLUTION_BLOCKED"
  );
  await assert.rejects(
    confirmKhlMatchBinding(prisma, {
      khlGameId: "901973",
      adminMatchId: "admin-match-42",
      candidates: [{ ...compatibleCandidate, stageId: "999" }],
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "MATCH_RESOLUTION_BLOCKED"
  );
  await assert.rejects(
    confirmKhlMatchBinding(prisma, {
      khlGameId: "901973",
      adminMatchId: "admin-match-42",
      candidates: [
        compatibleCandidate,
        { ...compatibleCandidate, adminMatchId: "admin-match-43" },
      ],
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "MATCH_RESOLUTION_BLOCKED"
  );
  const result = await confirmKhlMatchBinding(prisma, {
    khlGameId: "901973",
    adminMatchId: "admin-match-42",
    candidates: [compatibleCandidate],
    confirmedBy: "test-admin",
  });

  assert.deepEqual(result.matchKey, {
    khlGameId: "901973",
    season: match.season,
    stageId: match.stageId,
    homeAdminTeamId: "admin-team-home",
    awayAdminTeamId: "admin-team-away",
    adminMatchId: "admin-match-42",
  });
  assert.equal(result.match.adminBindingStatus, "CONFIRMED");
  assert.equal(result.match.adminBindingMode, "MANUAL");
});

test("team bindings cannot drift underneath an already confirmed match", async () => {
  const match = await prisma.khlMatch.findUniqueOrThrow({
    where: { khlGameId: "901973" },
    include: { homeTeam: true },
  });
  await assert.rejects(
    confirmKhlTeamBinding(prisma, {
      khlTeamId: match.homeTeam.khlTeamId,
      adminTeamId: "different-admin-team",
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "BOUND_MATCH_DEPENDS_ON_TEAM"
  );
});

test("player bindings persist globally and per match without allowing collisions", async () => {
  const match = await prisma.khlMatch.findUniqueOrThrow({
    where: { khlGameId: "901973" },
    include: {
      participants: {
        where: { isListed: true },
        include: { player: true },
        orderBy: { shirtNumber: "asc" },
        take: 2,
      },
    },
  });
  const [first, second] = match.participants;
  assert.ok(first?.player.khlPlayerId);
  assert.ok(second?.player.khlPlayerId);

  const saved = await confirmKhlPlayerBinding(prisma, {
    khlGameId: match.khlGameId,
    khlPlayerId: first.player.khlPlayerId,
    adminPlayerId: "admin-player-persistent-1",
    adminMatchPlayerId: "admin-match-player-persistent-1",
    confirmedBy: "test-admin",
  });
  assert.equal(saved.player.adminBindingStatus, "CONFIRMED");
  assert.equal(saved.player.adminPlayerId, "admin-player-persistent-1");
  assert.equal(saved.participant.adminMatchPlayerId, "admin-match-player-persistent-1");

  const repeated = await confirmKhlPlayerBinding(prisma, {
    khlGameId: match.khlGameId,
    khlPlayerId: first.player.khlPlayerId,
    adminPlayerId: "admin-player-persistent-1",
    adminMatchPlayerId: "admin-match-player-persistent-1",
    confirmedBy: "test-admin",
  });
  assert.equal(repeated.player.id, saved.player.id);
  assert.equal(repeated.participant.id, saved.participant.id);

  await assert.rejects(
    confirmKhlPlayerBinding(prisma, {
      khlGameId: match.khlGameId,
      khlPlayerId: first.player.khlPlayerId,
      adminPlayerId: "different-admin-player",
      adminMatchPlayerId: "admin-match-player-persistent-1",
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "PLAYER_ALREADY_BOUND"
  );
  await assert.rejects(
    confirmKhlPlayerBinding(prisma, {
      khlGameId: match.khlGameId,
      khlPlayerId: second.player.khlPlayerId,
      adminPlayerId: "admin-player-persistent-1",
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "ADMIN_PLAYER_ALREADY_BOUND"
  );
});

test("match binding rejects a rejected-first shell until a valid revision is activated", async () => {
  const validRaw = JSON.parse(readFileSync(
    join(process.cwd(), "tests", "fixtures", "khl", "regulation-901973.json"),
    "utf8"
  ));
  validRaw.id = 9_019_731;
  validRaw.khl_id = 9_019_732;
  validRaw.match_id = "9019732";
  const rejectedRaw = structuredClone(validRaw);
  rejectedRaw.start_at += 60_000;
  rejectedRaw.text_events = rejectedRaw.text_events.filter(
    (event: { text?: string }) => !event.text?.startsWith("Статистика 3-го периода:")
  );

  const rejected = await ingestKhlEventDetail(prisma, {
    rawBody: JSON.stringify(rejectedRaw),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=9019731&stage_id=395",
  });
  assert.equal(rejected.revision.state, "REJECTED");
  assert.equal(rejected.match.activeRevisionId, null);

  const rejectedCandidate = {
    ...compatibleCandidate,
    adminMatchId: "admin-match-rejected-shell",
    startsAt: new Date(rejectedRaw.start_at).toISOString(),
  };
  await assert.rejects(
    confirmKhlMatchBinding(prisma, {
      khlGameId: "9019732",
      adminMatchId: rejectedCandidate.adminMatchId,
      candidates: [rejectedCandidate],
      confirmedBy: "test-admin",
    }),
    (error: unknown) => error instanceof KhlBindingConflictError
      && error.code === "MATCH_RESOLUTION_BLOCKED"
  );

  const activated = await ingestKhlEventDetail(prisma, {
    rawBody: JSON.stringify(validRaw),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=9019731&stage_id=395",
  });
  assert.equal(activated.revision.state, "VALIDATED");
  assert.equal(activated.match.activeRevisionId, activated.revision.id);
  const result = await confirmKhlMatchBinding(prisma, {
    khlGameId: "9019732",
    adminMatchId: "admin-match-after-validation",
    candidates: [{
      ...compatibleCandidate,
      adminMatchId: "admin-match-after-validation",
      startsAt: new Date(validRaw.start_at).toISOString(),
    }],
    confirmedBy: "test-admin",
  });
  assert.equal(result.match.adminMatchId, "admin-match-after-validation");
});
