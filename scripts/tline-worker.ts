import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { getPrismaClient } from "../backend/src/db/db";
import { createOptionalConfiguredAdminLineAdapter } from "../backend/src/tline/admin/configuration";
import { executeTLineRun } from "../backend/src/tline/application/executor";
import { assertTLineSchedulerReady } from "../backend/src/tline/application/scheduleState";
import { createTLineLeaseGuard, TLineJobLeaseLostError } from "../backend/src/tline/jobs/leaseGuard";
import { claimNextJob, completeJob, failJobAndRun, heartbeatJob, recoverExpiredJobs } from "../backend/src/tline/jobs/repository";
import { computeDueScheduleSlots } from "../backend/src/tline/scheduler/slots";
import { createOfficialSourceRegistry } from "../backend/src/tline/sources/registry";
import { createVolleyRuAdapter } from "../backend/src/tline/sources/volleyRu";

const POLL_INTERVAL_MS = 2_000;
const SCHEDULER_INTERVAL_MS = 30_000;
const RECOVERY_INTERVAL_MS = 60_000;
const LEASE_DURATION_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

const client = getPrismaClient();
const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
let stopping = false;
let lastSchedulerTick = 0;
let lastRecoveryTick = 0;

process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

void main().catch(async (error) => {
  console.error(JSON.stringify({ event: "tline_worker_fatal", errorClass: safeErrorCode(error) }));
  await client.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});

async function main() {
  while (!stopping) {
    if (process.env.TLINE_ENABLED !== "1") {
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    const now = new Date();
    if (now.getTime() - lastRecoveryTick >= RECOVERY_INTERVAL_MS) {
      await recoverExpiredJobs(client, { now });
      lastRecoveryTick = now.getTime();
    }
    if (now.getTime() - lastSchedulerTick >= SCHEDULER_INTERVAL_MS) {
      await scheduleDueRuns(now);
      lastSchedulerTick = now.getTime();
    }

    const claimNow = new Date();
    const job = await claimNextJob(client, { workerId, leaseDurationMs: LEASE_DURATION_MS, now: claimNow });
    if (!job) {
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    await processJob({ id: String(job.id), attempt: Number(job.attempts) });
  }
  await client.$disconnect();
}

async function processJob(job: { id: string; attempt: number }) {
  if (!Number.isSafeInteger(job.attempt) || job.attempt <= 0) {
    throw new Error("Claimed TLine job has an invalid attempt token");
  }
  const guard = createTLineLeaseGuard();
  let heartbeatStopped = false;
  let heartbeatChain = Promise.resolve();
  const pulse = () => {
    heartbeatChain = heartbeatChain.then(async () => {
      if (heartbeatStopped || guard.signal.aborted) return;
      try {
        const owned = await heartbeatJob(client, {
          jobId: job.id,
          workerId,
          attempt: job.attempt,
          leaseDurationMs: LEASE_DURATION_MS,
          now: new Date(),
        });
        if (!owned) guard.lose(new Error("Heartbeat no longer owns the TLine job lease"));
      } catch (error) {
        guard.lose(error);
      }
    });
  };
  const heartbeat = setInterval(pulse, HEARTBEAT_INTERVAL_MS);
  const stopHeartbeat = async () => {
    if (!heartbeatStopped) {
      heartbeatStopped = true;
      clearInterval(heartbeat);
    }
    await heartbeatChain;
  };
  try {
    const storedJob = await client.tLineJob.findUniqueOrThrow({
      where: { id: job.id },
      select: { type: true, runId: true },
    });
    if (storedJob.type !== "RUN_CHECK" || !storedJob.runId) {
      throw new Error("Unsupported TLine job payload");
    }
    const run = await executeTLineRun(client, storedJob.runId, {
      officialSources: createOfficialSourceRegistry([createVolleyRuAdapter()]),
      admin: createOptionalConfiguredAdminLineAdapter(),
      signal: guard.signal,
      verifyLease: async (transaction) => {
        guard.assertOwned();
        const owned = await heartbeatJob(transaction, {
          jobId: job.id,
          workerId,
          attempt: job.attempt,
          leaseDurationMs: LEASE_DURATION_MS,
          now: new Date(),
        });
        if (!owned) {
          guard.lose(new Error("Evidence transaction no longer owns the TLine job lease"));
          guard.assertOwned();
        }
      },
    });
    await stopHeartbeat();
    guard.assertOwned();
    const completed = await completeJob(client, {
      jobId: job.id,
      workerId,
      attempt: job.attempt,
      status: terminalJobStatus(run.status),
      now: new Date(),
    });
    if (!completed) throw new TLineJobLeaseLostError();
  } catch (error) {
    await stopHeartbeat();
    if (error instanceof TLineJobLeaseLostError || guard.signal.aborted) {
      console.error(JSON.stringify({ event: "tline_job_lease_lost", jobId: job.id }));
      return;
    }
    const completed = await failJobAndRun(client, {
      jobId: job.id,
      workerId,
      attempt: job.attempt,
      now: new Date(),
      errorCode: safeErrorCode(error),
      jobErrorMessage: "TLine worker execution failed.",
      runErrorMessage: "TLine worker could not execute this run.",
    });
    if (!completed) console.error(JSON.stringify({ event: "tline_job_failure_completion_not_owned", jobId: job.id }));
    console.error(JSON.stringify({ event: "tline_job_failed", jobId: job.id, errorClass: safeErrorCode(error) }));
  } finally {
    await stopHeartbeat();
  }
}

async function scheduleDueRuns(now: Date) {
  const state = await client.tLineScheduleState.findUnique({ where: { id: "global" } });
  if (!state?.enabled) return;
  try {
    await assertTLineSchedulerReady(client);
  } catch {
    await client.tLineScheduleState.update({ where: { id: "global" }, data: { enabled: false } });
    console.error(JSON.stringify({ event: "tline_scheduler_disabled", reason: "readiness_check_failed" }));
    return;
  }
  if (!state.lastTickAt) {
    await client.tLineScheduleState.update({ where: { id: "global" }, data: { lastTickAt: now } });
    return;
  }
  const catchUpFloor = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dueSlots = computeDueScheduleSlots({
    lastTickAt: state.lastTickAt < catchUpFloor ? catchUpFloor : state.lastTickAt,
    now,
    timezone: state.timezone,
    slotHours: state.slotHours,
  });
  const sports = await client.tLineSportConfig.findMany({
    where: { active: true, autoEnabled: true },
    include: {
      championships: {
        where: { active: true, autoEnabled: true, deletedAt: null },
        select: { id: true },
      },
    },
  });
  for (const scheduledAt of dueSlots) {
    for (const sport of sports) {
      if (
        sport.championships.length === 0
        || sport.autoPeriodFromOffsetMinutes === null
        || sport.autoPeriodToOffsetMinutes === null
      ) continue;
      const periodFrom = new Date(scheduledAt.getTime() + sport.autoPeriodFromOffsetMinutes * 60_000);
      const periodTo = new Date(scheduledAt.getTime() + sport.autoPeriodToOffsetMinutes * 60_000);
      if (periodTo <= periodFrom) continue;
      try {
        await client.$transaction(async (transaction) => {
          const run = await transaction.tLineRun.create({
            data: {
              sportConfigId: sport.id,
              trigger: "SCHEDULED",
              scheduledAt,
              periodFrom,
              periodTo,
              progressTotal: sport.championships.length,
              unprocessedCount: sport.championships.length,
              runChampionships: {
                create: sport.championships.map(({ id }) => ({ championshipId: id, reasonCodes: [] })),
              },
            },
          });
          await transaction.tLineJob.create({
            data: {
              sportConfigId: sport.id,
              runId: run.id,
              type: "RUN_CHECK",
              idempotencyKey: `tline:schedule:${sport.id}:${scheduledAt.toISOString()}`,
              scheduledAt,
              payload: { runId: run.id, scheduledAt: scheduledAt.toISOString() },
            },
          });
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
    }
  }
  await client.tLineScheduleState.update({ where: { id: "global" }, data: { lastTickAt: now } });
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function safeErrorCode(error: unknown) {
  return error instanceof Error ? error.name.slice(0, 128) : "UnknownError";
}

function terminalJobStatus(status: string): "SUCCEEDED" | "PARTIAL" | "CANCELLED" | "FAILED" {
  return status === "SUCCEEDED" || status === "PARTIAL" || status === "CANCELLED" || status === "FAILED"
    ? status
    : "FAILED";
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
