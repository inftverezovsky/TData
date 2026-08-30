import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { failJobAndRun, recoverExpiredJobs } from "@backend/tline/jobs/repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("expired final-attempt jobs reconcile mixed and completed championships atomically", {
  skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is required for PostgreSQL integration",
}, async () => {
  const url = requireIsolatedDatabaseUrl(testDatabaseUrl!);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const suffix = randomUUID();
  const ids = {
    discipline: `tline-job-discipline-${suffix}`,
    sport: `tline-job-sport-${suffix}`,
    championshipOk: `tline-job-champ-ok-${suffix}`,
    championshipPending: `tline-job-champ-pending-${suffix}`,
    mixedRun: `tline-job-run-mixed-${suffix}`,
    mixedJob: `tline-job-mixed-${suffix}`,
    completedRun: `tline-job-run-completed-${suffix}`,
    completedJob: `tline-job-completed-${suffix}`,
    failureRun: `tline-job-run-failure-${suffix}`,
    failureJob: `tline-job-failure-${suffix}`,
  };
  const now = new Date("2026-08-30T12:00:00.000Z");
  const expiredAt = new Date(now.getTime() - 1_000);

  try {
    await prisma.discipline.create({ data: { id: ids.discipline, slug: ids.discipline, name: "TLine job recovery test" } });
    await prisma.tLineSportConfig.create({ data: { id: ids.sport, disciplineId: ids.discipline } });
    await prisma.tLineChampionship.createMany({ data: [
      { id: ids.championshipOk, sportConfigId: ids.sport, name: "OK", sourceProvider: "fixture", sourceUrl: `https://volley.ru/calendar/${suffix}/allgames` },
      { id: ids.championshipPending, sportConfigId: ids.sport, name: "Pending", sourceProvider: "fixture", sourceUrl: `https://volley.ru/calendar/${suffix}-pending/allgames` },
    ] });
    await prisma.tLineRun.create({
      data: {
        id: ids.mixedRun,
        sportConfigId: ids.sport,
        trigger: "MANUAL",
        status: "RUNNING",
        periodFrom: new Date("2026-08-01T00:00:00.000Z"),
        periodTo: new Date("2026-09-01T00:00:00.000Z"),
        progressTotal: 2,
        runChampionships: { create: [
          { championshipId: ids.championshipOk, status: "SUCCEEDED", automaticStatus: "AUTO_OK", effectiveStatus: "AUTO_OK", severity: "OK", effectiveSeverity: "OK", reasonCodes: [] },
          { championshipId: ids.championshipPending, status: "RUNNING", automaticStatus: "PROCESSING", effectiveStatus: "PROCESSING", severity: "UNPROCESSED", effectiveSeverity: "UNPROCESSED", reasonCodes: [] },
        ] },
        job: { create: { id: ids.mixedJob, sportConfigId: ids.sport, type: "RUN_CHECK", status: "RUNNING", idempotencyKey: ids.mixedJob, payload: { runId: ids.mixedRun }, attempts: 3, maxAttempts: 3, leaseOwner: "dead-worker", leaseExpiresAt: expiredAt } },
      },
    });
    const mixedRecovered = await recoverExpiredJobs(prisma, { now });
    assert.deepEqual(mixedRecovered.map((job) => [job.id, job.status]), [[ids.mixedJob, "PARTIAL"]]);

    await prisma.tLineRun.create({
      data: {
        id: ids.completedRun,
        sportConfigId: ids.sport,
        trigger: "MANUAL",
        status: "RUNNING",
        periodFrom: new Date("2026-09-01T00:00:00.000Z"),
        periodTo: new Date("2026-10-01T00:00:00.000Z"),
        progressTotal: 1,
        runChampionships: { create: { championshipId: ids.championshipOk, status: "SUCCEEDED", automaticStatus: "AUTO_OK", effectiveStatus: "AUTO_OK", severity: "OK", effectiveSeverity: "OK", reasonCodes: [] } },
        job: { create: { id: ids.completedJob, sportConfigId: ids.sport, type: "RUN_CHECK", status: "RUNNING", idempotencyKey: ids.completedJob, payload: { runId: ids.completedRun }, attempts: 3, maxAttempts: 3, leaseOwner: "dead-worker", leaseExpiresAt: expiredAt } },
      },
    });
    const completedRecovered = await recoverExpiredJobs(prisma, { now });
    assert.deepEqual(completedRecovered.map((job) => [job.id, job.status]), [[ids.completedJob, "SUCCEEDED"]]);

    const [mixedRun, completedRun] = await Promise.all([
      prisma.tLineRun.findUniqueOrThrow({ where: { id: ids.mixedRun }, include: { runChampionships: true, job: true } }),
      prisma.tLineRun.findUniqueOrThrow({ where: { id: ids.completedRun }, include: { job: true } }),
    ]);
    assert.equal(mixedRun.status, "PARTIAL");
    assert.equal(mixedRun.job?.status, "PARTIAL");
    assert.equal(mixedRun.progressProcessed, 2);
    assert.equal(mixedRun.okCount, 1);
    assert.equal(mixedRun.errorCount, 1);
    assert.deepEqual(mixedRun.runChampionships.map((item) => item.status).sort(), ["FAILED", "SUCCEEDED"]);
    assert.equal(completedRun.status, "SUCCEEDED");
    assert.equal(completedRun.job?.status, "SUCCEEDED");
    assert.equal(completedRun.okCount, 1);

    await prisma.tLineRun.create({
      data: {
        id: ids.failureRun,
        sportConfigId: ids.sport,
        trigger: "MANUAL",
        status: "RUNNING",
        periodFrom: new Date("2026-10-01T00:00:00.000Z"),
        periodTo: new Date("2026-11-01T00:00:00.000Z"),
        progressTotal: 2,
        runChampionships: { create: [
          { championshipId: ids.championshipOk, status: "SUCCEEDED", automaticStatus: "AUTO_OK", effectiveStatus: "AUTO_OK", severity: "OK", effectiveSeverity: "OK", reasonCodes: [] },
          { championshipId: ids.championshipPending, status: "RUNNING", automaticStatus: "PROCESSING", effectiveStatus: "PROCESSING", severity: "UNPROCESSED", effectiveSeverity: "UNPROCESSED", reasonCodes: [] },
        ] },
        job: { create: { id: ids.failureJob, sportConfigId: ids.sport, type: "RUN_CHECK", status: "RUNNING", idempotencyKey: ids.failureJob, payload: { runId: ids.failureRun }, attempts: 1, maxAttempts: 3, leaseOwner: "current-worker", leaseExpiresAt: new Date(now.getTime() + 60_000) } },
      },
    });
    const failureJobBefore = await prisma.tLineJob.findUniqueOrThrow({ where: { id: ids.failureJob } });
    assert.equal(failureJobBefore.status, "RUNNING");
    assert.equal(failureJobBefore.runId, ids.failureRun);
    assert.equal(failureJobBefore.leaseOwner, "current-worker");
    assert.equal(failureJobBefore.attempts, 1);
    assert.ok(failureJobBefore.leaseExpiresAt && failureJobBefore.leaseExpiresAt > now);
    const failureApplied = await failJobAndRun(prisma, {
      jobId: ids.failureJob,
      workerId: "current-worker",
      attempt: 1,
      now,
      errorCode: "ParserError",
      jobErrorMessage: "job failed",
      runErrorMessage: "run failed",
    });
    const failureState = await prisma.tLineRun.findUniqueOrThrow({
      where: { id: ids.failureRun },
      include: { runChampionships: true, job: true },
    });
    assert.equal(failureApplied, true, JSON.stringify({
      runStatus: failureState.status,
      jobStatus: failureState.job?.status,
      championshipStatuses: failureState.runChampionships.map((item) => item.status),
    }));
    const failureRun = await prisma.tLineRun.findUniqueOrThrow({ where: { id: ids.failureRun }, include: { runChampionships: true, job: true } });
    assert.equal(failureRun.status, "PARTIAL");
    assert.equal(failureRun.job?.status, "PARTIAL");
    assert.equal(failureRun.progressProcessed, 2);
    assert.equal(failureRun.okCount, 1);
    assert.equal(failureRun.errorCount, 1);
    assert.deepEqual(failureRun.runChampionships.map((item) => item.status).sort(), ["FAILED", "SUCCEEDED"]);
  } finally {
    await prisma.tLineRun.deleteMany({ where: { id: { in: [ids.mixedRun, ids.completedRun, ids.failureRun] } } });
    await prisma.tLineChampionship.deleteMany({ where: { id: { in: [ids.championshipOk, ids.championshipPending] } } });
    await prisma.tLineSportConfig.deleteMany({ where: { id: ids.sport } });
    await prisma.discipline.deleteMany({ where: { id: ids.discipline } });
    await prisma.$disconnect();
  }
});

function requireIsolatedDatabaseUrl(value: string) {
  const databaseName = new URL(value).pathname.replace(/^\//, "").toLowerCase();
  if (!databaseName.includes("test")) throw new Error("TEST_DATABASE_URL must name an isolated database containing test");
  return value;
}
