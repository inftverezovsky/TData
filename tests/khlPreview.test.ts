import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  KhlBindingStatus,
  KhlStatScope,
  PrismaClient,
} from "@prisma/client";
import { KHL_TEAM_STAT_CODES } from "../backend/src/results/khl/adminPayload";
import { confirmKhlMatchBinding, confirmKhlTeamBinding } from "../backend/src/results/khl/bindings";
import { stageKhlAdminDelivery } from "../backend/src/results/khl/delivery";
import { buildKhlAdminDeliveryDiff } from "../backend/src/results/khl/diff";
import { buildKhlAdminPreview } from "../backend/src/results/khl/preview";
import { ingestKhlEventDetail } from "../backend/src/results/khl/repository";
import {
  KhlTargetBindingError,
  confirmKhlResultTargets,
} from "../backend/src/results/khl/targetBindings";
import { acquireKhlDatabaseSuiteLock } from "./helpers/khlDatabaseSuiteLock";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for khlPreview.test.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const playerCodes = ["goals", "assists", "points"] as const;
let releaseSuiteLock: (() => Promise<void>) | undefined;

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
    prisma.khlStatMapping.deleteMany(),
  ]);
}

test.before(async () => {
  releaseSuiteLock = await acquireKhlDatabaseSuiteLock(databaseUrl);
  await clearKhlTables();
  await ingestKhlEventDetail(prisma, {
    rawBody: readFileSync(join(process.cwd(), "tests/fixtures/khl/regulation-901973.json"), "utf8"),
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

test("preview reports every missing confirmed mapping and stays fail-closed", async () => {
  const preview = await buildKhlAdminPreview(prisma, "901973");
  assert.equal(preview.ready, false);
  if (preview.ready) return;
  assert.ok(preview.issues.some((issue) => /Admin match id/i.test(issue)));
  assert.ok(preview.issues.some((issue) => /shots_on_goal/i.test(issue)));
  assert.ok(preview.issues.some((issue) => /player goals type/i.test(issue)));
  assert.ok(preview.issues.some((issue) => /participant binding/i.test(issue)));
});

test("preview blocks when the match projection diverges from its active revision", async () => {
  const match = await prisma.khlMatch.findUniqueOrThrow({ where: { khlGameId: "901973" } });
  await prisma.khlMatch.update({
    where: { id: match.id },
    data: { startsAt: new Date(match.startsAt.getTime() + 60_000) },
  });
  try {
    const preview = await buildKhlAdminPreview(prisma, "901973");
    assert.equal(preview.ready, false);
    if (!preview.ready) {
      assert.ok(preview.issues.some((issue) => /active revision identity.*projection/i.test(issue)));
    }
  } finally {
    await prisma.khlMatch.update({
      where: { id: match.id },
      data: { startsAt: match.startsAt },
    });
  }
});

test("fully confirmed target records produce deterministic preview without sending", async () => {
  const match = await prisma.khlMatch.findUniqueOrThrow({
    where: { khlGameId: "901973" },
    include: { homeTeam: true, awayTeam: true, participants: { include: { player: true } } },
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
  await confirmKhlMatchBinding(prisma, {
    khlGameId: match.khlGameId,
    adminMatchId: "admin-match-42",
    candidates: [{
      adminMatchId: "admin-match-42",
      startsAt: match.startsAt.toISOString(),
      homeAdminTeamId: "admin-team-home",
      awayAdminTeamId: "admin-team-away",
      season: match.season,
      stageId: match.stageId,
    }],
    confirmedBy: "test-admin",
  });

  const mappings = new Map<string, string>();
  for (const code of KHL_TEAM_STAT_CODES) {
    const mapping = await prisma.khlStatMapping.create({
      data: {
        scope: KhlStatScope.TEAM,
        semanticCode: code,
        adminStatTypeId: `admin-team-type-${code}`,
        adminBindingStatus: KhlBindingStatus.CONFIRMED,
        adminConfirmedAt: new Date(),
        adminConfirmedBy: "test-admin",
      },
    });
    mappings.set(`TEAM:${code}`, mapping.id);
  }
  for (const code of playerCodes) {
    const mapping = await prisma.khlStatMapping.create({
      data: {
        scope: KhlStatScope.PLAYER,
        semanticCode: code,
        adminStatTypeId: `admin-player-type-${code}`,
        adminBindingStatus: KhlBindingStatus.CONFIRMED,
        adminConfirmedAt: new Date(),
        adminConfirmedBy: "test-admin",
      },
    });
    mappings.set(`PLAYER:${code}`, mapping.id);
  }
  for (const teamId of [match.homeTeamId, match.awayTeamId]) {
    for (const code of KHL_TEAM_STAT_CODES) {
      await prisma.khlTeamStatTarget.create({
        data: {
          matchId: match.id,
          teamId,
          statMappingId: mappings.get(`TEAM:${code}`)!,
          adminMatchStatId: `admin-match-stat-${teamId}-${code}`,
          adminBindingStatus: KhlBindingStatus.CONFIRMED,
          adminConfirmedAt: new Date(),
          adminConfirmedBy: "test-admin",
        },
      });
    }
  }
  for (const participant of match.participants) {
    await prisma.khlPlayer.update({
      where: { id: participant.playerId },
      data: {
        adminPlayerId: `admin-player-${participant.player.khlPlayerId}`,
        adminBindingStatus: KhlBindingStatus.CONFIRMED,
        adminConfirmedAt: new Date(),
        adminConfirmedBy: "test-admin",
      },
    });
    await prisma.khlMatchParticipant.update({
      where: { id: participant.id },
      data: {
        adminMatchPlayerId: `admin-match-player-${participant.player.khlPlayerId}`,
        adminBindingStatus: KhlBindingStatus.CONFIRMED,
        adminConfirmedAt: new Date(),
        adminConfirmedBy: "test-admin",
      },
    });
    for (const code of playerCodes) {
      await prisma.khlPlayerStatTarget.create({
        data: {
          participantId: participant.id,
          statMappingId: mappings.get(`PLAYER:${code}`)!,
          adminPlayerStatId: `admin-player-stat-${participant.player.khlPlayerId}-${code}`,
          adminBindingStatus: KhlBindingStatus.CONFIRMED,
          adminConfirmedAt: new Date(),
          adminConfirmedBy: "test-admin",
        },
      });
    }
  }

  const targetInput = {
    khlGameId: match.khlGameId,
    teamStatTypes: {
      shots_on_goal: "admin-team-type-shots_on_goal",
      faceoffs_won: "admin-team-type-faceoffs_won",
      power_play_goals: "admin-team-type-power_play_goals",
      penalty_minutes_2_4: "admin-team-type-penalty_minutes_2_4",
    },
    playerStatTypes: {
      goals: "admin-player-type-goals",
      assists: "admin-player-type-assists",
      points: "admin-player-type-points",
    },
    teams: {
      home: { stats: {
        shots_on_goal: { adminMatchStatId: `admin-match-stat-${match.homeTeamId}-shots_on_goal` },
        faceoffs_won: { adminMatchStatId: `admin-match-stat-${match.homeTeamId}-faceoffs_won` },
        power_play_goals: { adminMatchStatId: `admin-match-stat-${match.homeTeamId}-power_play_goals` },
        penalty_minutes_2_4: { adminMatchStatId: `admin-match-stat-${match.homeTeamId}-penalty_minutes_2_4` },
      } },
      away: { stats: {
        shots_on_goal: { adminMatchStatId: `admin-match-stat-${match.awayTeamId}-shots_on_goal` },
        faceoffs_won: { adminMatchStatId: `admin-match-stat-${match.awayTeamId}-faceoffs_won` },
        power_play_goals: { adminMatchStatId: `admin-match-stat-${match.awayTeamId}-power_play_goals` },
        penalty_minutes_2_4: { adminMatchStatId: `admin-match-stat-${match.awayTeamId}-penalty_minutes_2_4` },
      } },
    },
    players: match.participants.map((participant) => ({
      khlPlayerId: participant.player.khlPlayerId,
      adminPlayerId: `admin-player-${participant.player.khlPlayerId}`,
      adminMatchPlayerId: `admin-match-player-${participant.player.khlPlayerId}`,
      stats: {
        goals: `admin-player-stat-${participant.player.khlPlayerId}-goals`,
        assists: `admin-player-stat-${participant.player.khlPlayerId}-assists`,
        points: `admin-player-stat-${participant.player.khlPlayerId}-points`,
      },
    })),
    confirmedBy: "test-admin",
  } as const;
  const targets = await confirmKhlResultTargets(prisma, targetInput);
  assert.deepEqual(targets, {
    khlGameId: "901973",
    adminMatchId: "admin-match-42",
    teamTargets: 8,
    players: 43,
    playerTargets: 129,
  });
  await assert.rejects(
    confirmKhlResultTargets(prisma, {
      ...targetInput,
      players: [null] as unknown as typeof targetInput.players,
    }),
    (error: unknown) => error instanceof KhlTargetBindingError
      && error.code === "INVALID_TARGET_BINDINGS"
  );
  await assert.rejects(
    confirmKhlResultTargets(prisma, {
      ...targetInput,
      teamStatTypes: { ...targetInput.teamStatTypes, shots_on_goal: "different-stat-type" },
    }),
    (error: unknown) => error instanceof KhlTargetBindingError
      && error.code === "CONFIRMED_BINDING_IMMUTABLE"
  );

  const first = await buildKhlAdminPreview(prisma, "901973");
  assert.equal(first.ready, true);
  if (!first.ready) return;
  assert.equal(first.payload.players.length, 43);
  assert.ok(first.payload.players.some((player) => player.goals === 0 && player.assists === 0));
  assert.equal(first.payload.match.adminMatchId, "admin-match-42");
  assert.equal(first.revisionId, first.payload.source.revisionId);
  assert.equal(first.payload.teamStatistics.length, 4);
  assert.match(first.payloadHash, /^[a-f0-9]{64}$/);

  const repeated = await buildKhlAdminPreview(prisma, "901973");
  assert.equal(repeated.ready, true);
  if (repeated.ready) assert.equal(repeated.payloadHash, first.payloadHash);
  assert.equal(await prisma.khlDelivery.count(), 0);

  const newDiff = await buildKhlAdminDeliveryDiff(prisma, "901973");
  assert.equal(newDiff.status, "NEW");
  assert.equal(newDiff.currentPayloadHash, first.payloadHash);
  assert.equal(newDiff.baseline, null);
  assert.deepEqual(newDiff.changes, []);

  for (const expected of [
    { expectedRevisionId: "stale-revision", expectedPayloadHash: first.payloadHash },
    { expectedRevisionId: first.revisionId, expectedPayloadHash: "0".repeat(64) },
  ]) {
    await assert.rejects(
      stageKhlAdminDelivery(prisma, {
        khlGameId: "901973",
        endpointVersion: "admin-results-contract-v1",
        ...expected,
      }),
      /reviewed preview no longer matches/i
    );
  }
  assert.equal(await prisma.khlDelivery.count(), 0);

  const [staged, stagedAgain] = await Promise.all([
    stageKhlAdminDelivery(prisma, {
      khlGameId: "901973",
      endpointVersion: "admin-results-contract-v1",
      expectedRevisionId: first.revisionId,
      expectedPayloadHash: first.payloadHash,
    }),
    stageKhlAdminDelivery(prisma, {
      khlGameId: "901973",
      endpointVersion: "admin-results-contract-v1",
      expectedRevisionId: first.revisionId,
      expectedPayloadHash: first.payloadHash,
    }),
  ]);
  assert.deepEqual([staged.reused, stagedAgain.reused].sort(), [false, true]);
  assert.equal(staged.delivery.state, "PENDING");
  assert.equal(stagedAgain.delivery.id, staged.delivery.id);
  assert.equal(await prisma.khlDelivery.count(), 1);
  assert.equal(await prisma.khlDeliveryAttempt.count(), 0);

  const unchangedDiff = await buildKhlAdminDeliveryDiff(prisma, "901973");
  assert.equal(unchangedDiff.status, "UNCHANGED");
  assert.equal(unchangedDiff.currentPayloadHash, first.payloadHash);
  assert.equal(unchangedDiff.baseline?.deliveryId, staged.delivery.id);
  assert.equal(unchangedDiff.baseline?.payloadHash, first.payloadHash);
  assert.deepEqual(unchangedDiff.changes, []);

  const changedBaseline = structuredClone(first.payload);
  changedBaseline.match.regulationScore.home = 99;
  await prisma.khlDelivery.update({
    where: { id: staged.delivery.id },
    data: {
      payloadHash: "f".repeat(64),
      payloadJson: changedBaseline,
    },
  });
  const changedDiff = await buildKhlAdminDeliveryDiff(prisma, "901973");
  assert.equal(changedDiff.status, "CHANGED");
  assert.ok(changedDiff.changes.some((change) => (
    change.path === "/match/regulationScore/home"
    && change.before === 99
    && change.after === first.payload.match.regulationScore.home
  )));
  assert.equal(changedDiff.truncated, false);

  const changedRaw = JSON.parse(
    readFileSync(join(process.cwd(), "tests/fixtures/khl/regulation-901973.json"), "utf8")
  ) as Record<string, unknown>;
  changedRaw.start_at = Number(changedRaw.start_at) + 60_000;
  const [raceStage] = await Promise.allSettled([
    stageKhlAdminDelivery(prisma, {
      khlGameId: "901973",
      endpointVersion: "admin-results-contract-race-v1",
      expectedRevisionId: first.revisionId,
      expectedPayloadHash: first.payloadHash,
    }),
    ingestKhlEventDetail(prisma, {
      rawBody: JSON.stringify(changedRaw),
      sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
    }),
  ]);
  if (raceStage.status === "fulfilled") {
    assert.equal(raceStage.value.delivery.revisionId, first.revisionId);
    assert.equal(raceStage.value.delivery.payloadHash, first.payloadHash);
  } else {
    assert.match(String(raceStage.reason), /reviewed preview no longer matches|active revision/i);
  }
  const activeAfterRace = await prisma.khlMatch.findUniqueOrThrow({
    where: { khlGameId: "901973" },
    select: { activeRevisionId: true, adminMatchId: true, adminBindingStatus: true },
  });
  assert.notEqual(activeAfterRace.activeRevisionId, first.revisionId);
  assert.equal(activeAfterRace.adminMatchId, null);
  assert.equal(activeAfterRace.adminBindingStatus, "UNMAPPED");
  assert.equal(await prisma.khlTeamStatTarget.count({
    where: { adminBindingStatus: "CONFIRMED" },
  }), 0);
  assert.equal(await prisma.khlPlayerStatTarget.count({
    where: { adminBindingStatus: "CONFIRMED" },
  }), 0);
  assert.equal(await prisma.khlMatchParticipant.count({
    where: { adminBindingStatus: "CONFIRMED" },
  }), 0);
  const previewAfterIdentityChange = await buildKhlAdminPreview(prisma, "901973");
  assert.equal(previewAfterIdentityChange.ready, false);
  if (!previewAfterIdentityChange.ready) {
    assert.ok(previewAfterIdentityChange.issues.some((issue) => /Admin match id/i.test(issue)));
  }
  const activeMatch = await prisma.khlMatch.findUniqueOrThrow({
    where: { khlGameId: "901973" },
    include: { homeTeam: true, awayTeam: true },
  });
  await confirmKhlMatchBinding(prisma, {
    khlGameId: "901973",
    adminMatchId: "admin-match-42",
    candidates: [{
      adminMatchId: "admin-match-42",
      startsAt: activeMatch.startsAt.toISOString(),
      homeAdminTeamId: activeMatch.homeTeam.adminTeamId!,
      awayAdminTeamId: activeMatch.awayTeam.adminTeamId!,
      season: activeMatch.season,
      stageId: activeMatch.stageId,
    }],
    confirmedBy: "test-admin",
  });
  await confirmKhlResultTargets(prisma, targetInput);
  const revalidatedPreview = await buildKhlAdminPreview(prisma, "901973");
  assert.equal(revalidatedPreview.ready, true);
  const raceDeliveries = await prisma.khlDelivery.findMany({
    where: { endpointVersion: "admin-results-contract-race-v1" },
  });
  assert.ok(raceDeliveries.every((delivery) => (
    delivery.revisionId === first.revisionId && delivery.payloadHash === first.payloadHash
  )));
});

test("preview, diff and staging block when a rejected revision is newer than active", async () => {
  const reviewed = await buildKhlAdminPreview(prisma, "901973");
  assert.equal(reviewed.ready, true);
  if (!reviewed.ready) return;

  const rejectedRaw = JSON.parse(
    readFileSync(join(process.cwd(), "tests/fixtures/khl/regulation-901973.json"), "utf8")
  ) as { start_at: unknown; team_b: Record<string, unknown> };
  rejectedRaw.start_at = Number(rejectedRaw.start_at) + 60_000;
  rejectedRaw.team_b.vbr = Number(rejectedRaw.team_b.vbr) + 1;
  const rejected = await ingestKhlEventDetail(prisma, {
    rawBody: JSON.stringify(rejectedRaw),
    sourceUrl: "https://khl.api.webcaster.pro/api/khl_mobile/event_v2.json?id=2986031&stage_id=395",
  });
  assert.equal(rejected.revision.state, "REJECTED");
  assert.equal(rejected.match.activeRevisionId, reviewed.revisionId);

  const deliveryCountBefore = await prisma.khlDelivery.count();
  const [preview, diff, stage] = await Promise.all([
    buildKhlAdminPreview(prisma, "901973"),
    buildKhlAdminDeliveryDiff(prisma, "901973"),
    stageKhlAdminDelivery(prisma, {
      khlGameId: "901973",
      endpointVersion: "admin-results-contract-rejected-latest-v1",
      expectedRevisionId: reviewed.revisionId,
      expectedPayloadHash: reviewed.payloadHash,
    }).then(
      () => ({ status: "fulfilled" as const, reason: "" }),
      (cause: unknown) => ({ status: "rejected" as const, reason: String(cause) })
    ),
  ]);

  assert.equal(preview.ready, false);
  if (!preview.ready) {
    assert.ok(preview.issues.some((issue) => /latest revision.*active validated revision/i.test(issue)));
  }
  assert.equal(diff.status, "BLOCKED");
  assert.equal(stage.status, "rejected");
  assert.match(stage.reason, /latest revision.*active validated revision/i);
  assert.equal(await prisma.khlDelivery.count(), deliveryCountBefore);
});
