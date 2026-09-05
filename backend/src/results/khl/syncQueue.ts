import { Prisma, type KhlSyncRun, type PrismaClient } from "@prisma/client";
import {
  defaultKhlSyncFrom, KHL_RESULTS_CUTOFF, type KhlResultsSyncSummary, type KhlSyncCheckpoint,
} from "./autoSync";
import { KHL_RESULTS_AUTO_SYNC_PAUSED_KEY } from "./automation";

const CONTROL_ID = "khl";
export const KHL_SYNC_LEASE_MS = 60_000;
const ACTIVE_STATUSES = ["QUEUED", "RUNNING"] as const;

export type KhlSyncClaim = { run: KhlSyncRun; owner: string };
export type KhlSyncRunView = {
  id: string; trigger: "MANUAL" | "AUTOMATIC"; status: KhlSyncRun["status"];
  khlGameId: string | null; full: boolean;
  requestedAt: string; startedAt: string | null; completedAt: string | null;
  summary: KhlResultsSyncSummary | null; error: string | null;
};
export type KhlSyncStatus = {
  latestRun: KhlSyncRunView | null; activeRun: KhlSyncRunView | null;
  workerHeartbeatAt: string | null; lastAttemptAt: string | null;
  lastSuccessAt: string | null; lastChangedAt: string | null;
  nextRunAt: string | null; bootstrapCompletedAt: string | null;
};

export class KhlSyncLeaseLostError extends Error {
  constructor() { super("KHL sync lease lost; refusing an unfenced write."); }
}
export class KhlSyncRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type EnqueueInput = { khlGameId?: string; apiEventId?: string; stageId?: string; trigger?: "MANUAL" | "AUTOMATIC"; full?: boolean; now?: Date };

async function lockControl(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`INSERT INTO "KhlSyncControl" ("id", "updatedAt") VALUES (${CONTROL_ID}, NOW()) ON CONFLICT ("id") DO NOTHING`;
  await tx.$queryRaw`SELECT "id" FROM "KhlSyncControl" WHERE "id" = ${CONTROL_ID} FOR UPDATE`;
  return tx.khlSyncControl.findUniqueOrThrow({ where: { id: CONTROL_ID } });
}

export function khlSyncIntervalMinutes() {
  const value = Number(process.env.KHL_RESULTS_AUTO_SYNC_INTERVAL_MINUTES || "10");
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_440 ? value : 10;
}

async function enqueueLocked(tx: Prisma.TransactionClient, input: EnqueueInput, bootstrapCompleted: boolean) {
  const now = input.now || new Date();
  if ((input.apiEventId || input.stageId) && (!input.apiEventId || !input.stageId
    || !/^[1-9]\d{0,127}$/.test(input.apiEventId) || !/^[1-9]\d{0,127}$/.test(input.stageId))) {
    throw new KhlSyncRequestError("apiEventId and stageId must be positive decimal strings.", 400);
  }
  const scopeKey = input.khlGameId ? `game:${input.khlGameId}` : input.apiEventId ? `event:${input.stageId}:${input.apiEventId}` : "all";
  const existing = await tx.khlSyncRun.findFirst({
    where: {
      scopeKey, status: { in: [...ACTIVE_STATUSES] },
      ...(input.full ? { full: true } : {}),
      // Do not promote an automatic executor that may already have observed a pause.
      ...((input.trigger || "MANUAL") === "MANUAL"
        ? { OR: [{ trigger: "MANUAL" as const }, { status: "QUEUED" as const }] } : {}),
    }, orderBy: { requestedAt: "asc" },
  });
  if (existing) {
    // A manual request remains executable if the operator later pauses automation.
    const run = (input.trigger || "MANUAL") === "MANUAL" && existing.trigger === "AUTOMATIC"
      ? await tx.khlSyncRun.update({ where: { id: existing.id }, data: { trigger: "MANUAL" } }) : existing;
    return { run, reused: true };
  }
  let from = input.full || input.apiEventId || !bootstrapCompleted ? KHL_RESULTS_CUTOFF : defaultKhlSyncFrom(now);
  if (input.khlGameId) {
    if (!/^[1-9]\d{0,127}$/.test(input.khlGameId)) throw new KhlSyncRequestError("khlGameId must be a positive decimal string.", 400);
    const match = await tx.khlMatch.findUnique({ where: { khlGameId: input.khlGameId }, select: { startsAt: true } });
    if (!match || match.startsAt < KHL_RESULTS_CUTOFF || match.startsAt > now) {
      throw new KhlSyncRequestError("Stored KHL match was not found in the supported date range.", 404);
    }
    from = match.startsAt;
  }
  // Prevent unbounded public requests for different matches from flooding the queue.
  if (await tx.khlSyncRun.count({ where: { status: { in: [...ACTIVE_STATUSES] } } }) >= 100) {
    throw new KhlSyncRequestError("KHL sync queue is full. Wait for the current collection.", 429);
  }
  const run = await tx.khlSyncRun.create({ data: {
    trigger: input.trigger || "MANUAL", scopeKey, khlGameId: input.khlGameId || null,
    apiEventId: input.apiEventId || null, stageId: input.stageId || null,
    full: !input.khlGameId && !input.apiEventId && (input.full || !bootstrapCompleted), from, to: now, requestedAt: now,
  } });
  return { run, reused: false };
}

export async function enqueueKhlSync(prisma: PrismaClient, input: EnqueueInput = {}) {
  return prisma.$transaction(async (tx) => {
    const control = await lockControl(tx);
    return enqueueLocked(tx, input, !!control.bootstrapCompletedAt);
  });
}

export async function setKhlSyncPaused(prisma: PrismaClient, paused: boolean, configured: boolean, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const control = await lockControl(tx);
    await tx.globalSettings.upsert({
      where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY },
      create: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY, value: paused ? "1" : "0" },
      update: { value: paused ? "1" : "0" },
    });
    if (paused) {
      await tx.khlSyncRun.updateMany({
        where: { trigger: "AUTOMATIC", status: "QUEUED" },
        data: { status: "CANCELLED", completedAt: now },
      });
    }
    const queued = !paused && configured
      ? await enqueueLocked(tx, { trigger: "AUTOMATIC", now }, !!control.bootstrapCompletedAt)
      : null;
    await tx.khlSyncControl.update({ where: { id: CONTROL_ID }, data: { nextRunAt: paused ? null : now } });
    return { automation: { configured, paused, enabled: configured && !paused }, run: queued ? khlSyncRunView(queued.run) : null };
  });
}

export async function tickKhlAutoSchedule(prisma: PrismaClient, configured: boolean, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const control = await lockControl(tx);
    const paused = await tx.globalSettings.findUnique({ where: { key: KHL_RESULTS_AUTO_SYNC_PAUSED_KEY } });
    if (!configured || paused?.value === "1" || (control.nextRunAt && control.nextRunAt > now)) return null;
    const queued = await enqueueLocked(tx, { trigger: "AUTOMATIC", now }, !!control.bootstrapCompletedAt);
    await tx.khlSyncControl.update({ where: { id: CONTROL_ID }, data: {
      nextRunAt: new Date(now.getTime() + khlSyncIntervalMinutes() * 60_000),
    } });
    return queued;
  });
}

export async function claimKhlSync(prisma: PrismaClient, owner: string, now = new Date()): Promise<KhlSyncClaim | null> {
  return prisma.$transaction(async (tx) => {
    const control = await lockControl(tx);
    if (control.activeRunId && control.leaseExpiresAt && control.leaseExpiresAt > now) return null;
    const stale = control.activeRunId
      ? await tx.khlSyncRun.findUnique({ where: { id: control.activeRunId } }) : null;
    const next = stale?.status === "RUNNING" ? stale : await tx.khlSyncRun.findFirst({
      where: { status: "QUEUED" }, orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    });
    if (!next) return null;
    const run = await tx.khlSyncRun.update({ where: { id: next.id }, data: {
      status: "RUNNING", startedAt: next.startedAt || now, attempts: { increment: 1 },
    } });
    await tx.khlSyncControl.update({ where: { id: CONTROL_ID }, data: {
      activeRunId: run.id, leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + KHL_SYNC_LEASE_MS),
      workerHeartbeatAt: now, lastAttemptAt: now,
    } });
    return { run, owner };
  });
}

export async function fenceKhlSyncWrite(tx: Prisma.TransactionClient, claim: KhlSyncClaim, now = new Date()) {
  const control = await lockControl(tx);
  if (control.activeRunId !== claim.run.id || control.leaseOwner !== claim.owner
    || !control.leaseExpiresAt || control.leaseExpiresAt <= now) throw new KhlSyncLeaseLostError();
}

export async function heartbeatKhlWorker(prisma: PrismaClient, claim: KhlSyncClaim | null, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    if (claim) await fenceKhlSyncWrite(tx, claim, now);
    else await lockControl(tx);
    await tx.khlSyncControl.update({ where: { id: CONTROL_ID }, data: {
      workerHeartbeatAt: now,
      ...(claim ? { leaseExpiresAt: new Date(now.getTime() + KHL_SYNC_LEASE_MS) } : {}),
    } });
  });
}

export async function saveKhlSyncCheckpoint(prisma: PrismaClient, claim: KhlSyncClaim, checkpoint: KhlSyncCheckpoint) {
  return prisma.$transaction(async (tx) => {
    await fenceKhlSyncWrite(tx, claim);
    await tx.khlSyncRun.update({ where: { id: claim.run.id }, data: {
      checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
      summary: checkpoint.summary as unknown as Prisma.InputJsonValue,
    } });
  });
}

export async function finishKhlSync(prisma: PrismaClient, claim: KhlSyncClaim, summary: KhlResultsSyncSummary | null, now = new Date(), error?: string) {
  return prisma.$transaction(async (tx) => {
    await fenceKhlSyncWrite(tx, claim, now);
    const status = error ? "FAILED" : summary?.stopped ? "CANCELLED" : summary?.failures.length ? "PARTIAL" : "SUCCEEDED";
    const run = await tx.khlSyncRun.update({ where: { id: claim.run.id }, data: {
      status, completedAt: now, error: error?.slice(0, 2_000) || null,
      ...(summary ? { summary: summary as unknown as Prisma.InputJsonValue } : {}),
    } });
    await tx.khlSyncControl.update({ where: { id: CONTROL_ID }, data: {
      activeRunId: null, leaseOwner: null, leaseExpiresAt: null,
      ...(status === "SUCCEEDED" ? { lastSuccessAt: now } : {}),
      ...(summary?.events.newlyChanged ? { lastChangedAt: now } : {}),
      // A failed historical candidate must not fall out of the rolling window after restart.
      ...((error || summary?.retryRequired || summary?.failures.some((failure) => !failure.persistedDiagnostic)) && !summary?.stopped
        ? { bootstrapCompletedAt: null } : {}),
      // Rejected protocols do not prevent completion of the initial discovery scan.
      ...(!error && !summary?.stopped && !summary?.retryRequired && claim.run.full && !summary?.failures.some((failure) => !failure.persistedDiagnostic)
        ? { bootstrapCompletedAt: now } : {}),
    } });
    return run;
  });
}

export function khlSyncRunView(run: KhlSyncRun): KhlSyncRunView {
  return {
    id: run.id, trigger: run.trigger, status: run.status, khlGameId: run.khlGameId, full: run.full,
    requestedAt: run.requestedAt.toISOString(), startedAt: run.startedAt?.toISOString() || null,
    completedAt: run.completedAt?.toISOString() || null,
    summary: run.summary as KhlResultsSyncSummary | null, error: run.error,
  };
}

export async function getKhlSyncStatus(prisma: PrismaClient): Promise<KhlSyncStatus> {
  const [control, latest, active] = await Promise.all([
    prisma.khlSyncControl.findUnique({ where: { id: CONTROL_ID } }),
    prisma.khlSyncRun.findFirst({ orderBy: [{ requestedAt: "desc" }, { id: "desc" }] }),
    prisma.khlSyncRun.findFirst({ where: { status: { in: [...ACTIVE_STATUSES] } }, orderBy: { requestedAt: "asc" } }),
  ]);
  return {
    latestRun: latest ? khlSyncRunView(latest) : null, activeRun: active ? khlSyncRunView(active) : null,
    workerHeartbeatAt: control?.workerHeartbeatAt?.toISOString() || null,
    lastAttemptAt: control?.lastAttemptAt?.toISOString() || null,
    lastSuccessAt: control?.lastSuccessAt?.toISOString() || null,
    lastChangedAt: control?.lastChangedAt?.toISOString() || null,
    nextRunAt: control?.nextRunAt?.toISOString() || null,
    bootstrapCompletedAt: control?.bootstrapCompletedAt?.toISOString() || null,
  };
}
