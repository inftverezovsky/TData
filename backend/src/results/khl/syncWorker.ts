import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { KhlApiClient, type KhlScheduleEvent } from "@backend/sources/results/khl/client";
import { retryKhlRead, syncKhlResults, type KhlResultsSyncClient, type KhlSyncCheckpoint } from "./autoSync";
import { ingestKhlEventDetail } from "./repository";
import { getKhlResultsAutomationStatus } from "./automation";
import { safeKhlSyncError } from "./syncErrors";
import {
  claimKhlSync, fenceKhlSyncWrite, finishKhlSync, heartbeatKhlWorker,
  KhlSyncLeaseLostError, saveKhlSyncCheckpoint, tickKhlAutoSchedule,
  type KhlSyncClaim,
} from "./syncQueue";

type WorkerOptions = {
  prisma: PrismaClient;
  configured: boolean;
  owner?: string;
  signal?: AbortSignal;
  client?: KhlResultsSyncClient;
};

class KhlWorkerStoppingError extends Error {
  constructor() { super("KHL worker is stopping; saved work will resume after lease expiry."); }
}

/** One tick can also be used by the CLI; every entry point shares the database lease. */
export async function runKhlWorkerTick(options: WorkerOptions) {
  const { prisma, configured } = options;
  await heartbeatKhlWorker(prisma, null);
  await tickKhlAutoSchedule(prisma, configured);
  const claim = await claimKhlSync(prisma, options.owner || randomUUID());
  if (!claim) return null;
  const controller = new AbortController();
  let lostLease = false;
  let cancellationRequested = false;
  let heartbeatPending: Promise<void> | null = null;
  const onShutdown = () => controller.abort();
  options.signal?.addEventListener("abort", onShutdown, { once: true });
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = heartbeatKhlWorker(prisma, claim)
      .then(async () => {
        const currentRun = await prisma.khlSyncRun.findUniqueOrThrow({ where: { id: claim.run.id }, select: { trigger: true } });
        if (currentRun.trigger === "AUTOMATIC"
          && !(await getKhlResultsAutomationStatus(prisma, configured)).enabled) {
          cancellationRequested = true;
          controller.abort();
        }
      })
      .catch(() => { lostLease = true; controller.abort(); })
      .finally(() => { heartbeatPending = null; });
  }, 10_000);
  heartbeat.unref();
  const shouldStop = async () => {
    if (lostLease) throw new KhlSyncLeaseLostError();
    await prisma.$transaction((tx) => fenceKhlSyncWrite(tx, claim));
    if (options.signal?.aborted) throw new KhlWorkerStoppingError();
    if (cancellationRequested) return true;
    const currentRun = await prisma.khlSyncRun.findUniqueOrThrow({ where: { id: claim.run.id }, select: { trigger: true } });
    return currentRun.trigger === "AUTOMATIC"
      && !(await getKhlResultsAutomationStatus(prisma, configured)).enabled;
  };
  try {
    // Paused automatic work is checked before even requesting the stage list.
    const stop = await shouldStop();
    if (stop) {
      return await finishKhlSync(prisma, claim, cancelledSummary(claim));
    }
    const client = options.client || new KhlApiClient({ signal: controller.signal });
    if (claim.run.apiEventId && claim.run.stageId) {
      const detail = await retryKhlRead(() => client.getEventDetailEnvelope({
        apiEventId: claim.run.apiEventId!, stageId: claim.run.stageId!,
      }));
      const result = await ingestKhlEventDetail(prisma, {
        rawBody: detail.rawBody, rawBytes: detail.rawBytes, sourceUrl: detail.sourceUrl, fetchedAt: detail.fetchedAt,
        contentType: detail.contentType || "application/json",
        expectedIdentity: { apiEventId: claim.run.apiEventId, stageId: claim.run.stageId },
        allowedDateRange: { from: claim.run.from, to: claim.run.to }, requireFinished: true,
        assertCanWrite: (tx) => fenceKhlSyncWrite(tx, claim),
      });
      const summary = cancelledSummary(claim);
      summary.stopped = false;
      summary.events = { ...summary.events, discovered: 1, eligible: 1, checked: 1, ingested: 1,
        newlyChanged: Number(!result.reusedRevision),
        reusedSnapshots: Number(result.reusedSnapshot), reusedRevisions: Number(result.reusedRevision),
        rejectedRevisions: Number(result.revision.state !== "VALIDATED") };
      if (result.revision.state !== "VALIDATED") summary.failures = [{
        scope: "event", stageId: claim.run.stageId, apiEventId: claim.run.apiEventId,
        khlGameId: result.match.khlGameId, message: "KHL protocol was preserved as a rejected diagnostic revision.", persistedDiagnostic: true,
      }];
      return await finishKhlSync(prisma, claim, summary);
    }
    const candidates = claim.run.khlGameId ? await storedCandidate(prisma, claim.run.khlGameId) : undefined;
    const summary = await syncKhlResults({
      prisma, from: claim.run.from, to: claim.run.to,
      checkpoint: claim.run.checkpoint as KhlSyncCheckpoint | undefined,
      client,
      candidates, refreshExistingAfterMs: 0,
      shouldStop,
      assertCanWrite: (tx) => fenceKhlSyncWrite(tx, claim),
      onCheckpoint: (checkpoint) => {
        if (options.signal?.aborted) throw new KhlWorkerStoppingError();
        return saveKhlSyncCheckpoint(prisma, claim, checkpoint);
      },
    });
    if (lostLease) throw new KhlSyncLeaseLostError();
    return await finishKhlSync(prisma, claim, summary);
  } catch (cause) {
    if (options.signal?.aborted || cause instanceof KhlWorkerStoppingError) throw new KhlWorkerStoppingError();
    if (lostLease || cause instanceof KhlSyncLeaseLostError) throw new KhlSyncLeaseLostError();
    if (cancellationRequested) {
      return await finishKhlSync(prisma, claim, cancelledSummary(claim));
    }
    return await finishKhlSync(prisma, claim, null, new Date(), safeKhlWorkerError(cause));
  } finally {
    clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", onShutdown);
    await heartbeatPending;
  }
}

function cancelledSummary(claim: KhlSyncClaim) {
  const previous = claim.run.summary as unknown as KhlSyncCheckpoint["summary"] | null;
  return {
    startedAt: claim.run.startedAt!.toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
    range: { from: claim.run.from.toISOString(), to: claim.run.to.toISOString() },
    stages: { available: 0, selected: 0, scannedWindows: 0 },
    events: { discovered: 0, eligible: 0, checked: 0, newlyChanged: 0, ingested: 0,
      reusedSnapshots: 0, reusedRevisions: 0, rejectedRevisions: 0, skippedBeforeCutoff: 0,
      skippedAfterRange: 0, skippedNotFinished: 0, skippedDuplicate: 0, skippedRecentlyFetched: 0 },
    failures: [], ...previous, stopped: true,
  };
}

async function storedCandidate(prisma: PrismaClient, khlGameId: string): Promise<KhlScheduleEvent[]> {
  const match = await prisma.khlMatch.findUniqueOrThrow({ where: { khlGameId }, include: { homeTeam: true, awayTeam: true } });
  return [{
    apiEventId: match.apiEventId, khlGameId, matchId: khlGameId, stageId: match.stageId,
    khlStageId: match.khlStageId, stageName: "", name: "",
    startsAt: match.startsAt.toISOString(), eventStartsAt: match.startsAt.toISOString(), status: "finished",
    score: { home: 0, away: 0 }, periodScores: { P1: null, P2: null, P3: null, OT: null, SO: null },
    teams: {
      home: { khlTeamId: match.homeTeam.khlTeamId, apiTeamId: match.homeTeam.apiTeamId || "", name: match.homeTeam.name, location: null },
      away: { khlTeamId: match.awayTeam.khlTeamId, apiTeamId: match.awayTeam.apiTeamId || "", name: match.awayTeam.name, location: null },
    },
  }];
}

export function safeKhlWorkerError(cause: unknown) {
  return safeKhlSyncError(cause);
}
