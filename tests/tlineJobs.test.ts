import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCancelJobQuery,
  buildClaimNextJobQuery,
  buildCompleteJobQuery,
  buildEnqueueJobQuery,
  buildFailJobAndRunQuery,
  buildHeartbeatJobQuery,
  buildRecoverExpiredJobsQuery,
} from "@backend/tline/jobs/queries";
import {
  cancelJob,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJobAndRun,
  heartbeatJob,
  recoverExpiredJobs,
} from "@backend/tline/jobs/repository";
import {
  createTLineLeaseGuard,
  TLineJobLeaseLostError,
} from "@backend/tline/jobs/leaseGuard";
import {
  buildScheduledRunRequests,
  computeDueScheduleSlots,
} from "@backend/tline/scheduler/slots";

function sqlText(query: { strings: readonly string[] }) {
  return query.strings.join("?");
}

test("worker entrypoint remains compatible with the production CommonJS tsx loader", () => {
  const source = readFileSync(new URL("../scripts/tline-worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^await main\(\);/m);
  assert.match(source, /^void main\(\)\.catch\(/m);
});

test("claim query uses SKIP LOCKED and parameterizes lease ownership", () => {
  const query = buildClaimNextJobQuery({
    workerId: "worker-'unsafe",
    leaseDurationMs: 30_000,
    now: new Date("2026-08-30T05:00:00.000Z"),
  });
  const text = sqlText(query);

  assert.match(text, /FOR UPDATE SKIP LOCKED/);
  assert.match(text, /UPDATE "TLineJob"/);
  assert.match(text, /"attempts" = job\."attempts" \+ 1/);
  assert.doesNotMatch(text, /worker-'unsafe/);
  assert.ok(query.values.includes("worker-'unsafe"));
});

test("enqueue query is idempotent and parameterizes the JSON payload", () => {
  const query = buildEnqueueJobQuery({
    id: "job-1",
    sportConfigId: "sport-1",
    runId: "run-1",
    type: "RUN_CHECK",
    idempotencyKey: "tline:run:unsafe-'key",
    scheduledAt: null,
    availableAt: new Date("2026-08-30T05:00:00.000Z"),
    priority: 10,
    payload: { runId: "run-1", secretLookingValue: "not-a-secret" },
    maxAttempts: 3,
  });
  const text = sqlText(query);

  assert.match(text, /INSERT INTO "TLineJob"/);
  assert.match(text, /ON CONFLICT \("idempotencyKey"\)/);
  assert.doesNotMatch(text, /unsafe-'key/);
  assert.ok(query.values.includes("tline:run:unsafe-'key"));
  assert.ok(query.values.includes('{"runId":"run-1","secretLookingValue":"not-a-secret"}'));
});

test("claim query rejects unsafe lease durations", () => {
  assert.throws(
    () =>
      buildClaimNextJobQuery({
        workerId: "worker-1",
        leaseDurationMs: 0,
        now: new Date(),
      }),
    /leaseDurationMs/,
  );
  assert.throws(
    () =>
      buildClaimNextJobQuery({
        workerId: "worker-1",
        leaseDurationMs: 86_400_001,
        now: new Date(),
      }),
    /leaseDurationMs/,
  );
});

test("heartbeat query can only extend the current live lease", () => {
  const query = buildHeartbeatJobQuery({
    jobId: "job-1",
    workerId: "worker-1",
    attempt: 2,
    leaseDurationMs: 15_000,
    now: new Date("2026-08-30T05:01:00.000Z"),
  });
  const text = sqlText(query);

  assert.match(text, /"status" = 'RUNNING'/);
  assert.match(text, /"leaseOwner" =/);
  assert.match(text, /"attempts" =/);
  assert.match(text, /"leaseExpiresAt" >/);
  assert.match(text, /"cancelRequestedAt" IS NULL/);
});

test("cancel query immediately cancels queued work and flags running work", () => {
  const query = buildCancelJobQuery({
    jobId: "job-1",
    now: new Date("2026-08-30T05:02:00.000Z"),
  });
  const text = sqlText(query);

  assert.match(text, /WHEN 'QUEUED' THEN 'CANCELLED'/);
  assert.match(text, /WHEN 'RUNNING' THEN/);
  assert.match(text, /"cancelRequestedAt"/);
});

test("expired leases are requeued until max attempts and then failed", () => {
  const query = buildRecoverExpiredJobsQuery({
    now: new Date("2026-08-30T05:03:00.000Z"),
  });
  const text = sqlText(query);

  assert.match(text, /"attempts" >= "maxAttempts"/);
  assert.match(text, /requeued_jobs/);
  assert.match(text, /completed_jobs/);
  assert.match(text, /"leaseExpiresAt" <=/);
  assert.match(text, /UPDATE "TLineRun"/);
  assert.match(text, /UPDATE "TLineRunChampionship"/);
  assert.match(text, /LEASE_EXPIRED/);
  assert.match(text, /"progressProcessed"/);
  assert.match(text, /"errorCount"/);
  assert.match(text, /"unprocessedCount"/);
  assert.match(text, /"failedCount" = championship_summary\."progressTotal" THEN 'FAILED'/);
  assert.match(text, /"failedCount" > 0 OR championship_summary\."partialCount" > 0 THEN 'PARTIAL'/);
  assert.match(text, /resolved_runs\."status"::text::"TLineJobStatus"/);
});

test("complete query only accepts terminal states and verifies lease owner", () => {
  const query = buildCompleteJobQuery({
    jobId: "job-1",
    workerId: "worker-1",
    attempt: 2,
    status: "PARTIAL",
    now: new Date("2026-08-30T05:04:00.000Z"),
    errorCode: "CHAMPIONSHIP_FAILED",
    errorMessage: "One championship failed",
  });
  const text = sqlText(query);

  assert.match(text, /"status" =/);
  assert.match(text, /"leaseOwner" =/);
  assert.match(text, /"attempts" =/);
  assert.match(text, /"leaseExpiresAt" >/);
  assert.match(text, /"leaseOwner" = NULL/);
  assert.throws(
    () =>
      buildCompleteJobQuery({
        jobId: "job-1",
        workerId: "worker-1",
        attempt: 2,
        status: "RUNNING" as "FAILED",
        now: new Date(),
      }),
    /terminal status/,
  );
});

test("failure completion fences the run update behind the same live job lease", () => {
  const text = sqlText(buildFailJobAndRunQuery({
    jobId: "job-1",
    workerId: "worker-1",
    attempt: 2,
    now: new Date("2026-08-30T05:04:00.000Z"),
    errorCode: "ParserError",
    jobErrorMessage: "TLine worker execution failed.",
    runErrorMessage: "TLine worker could not execute this run.",
  }));

  assert.match(text, /WITH owned_job AS/);
  assert.match(text, /"leaseOwner" =/);
  assert.match(text, /"attempts" =/);
  assert.match(text, /"leaseExpiresAt" >/);
  assert.match(text, /UPDATE "TLineRunChampionship" AS championship/);
  assert.match(text, /UPDATE "TLineRun" AS run[\s\S]*FROM owned_job/);
  assert.match(text, /"progressProcessed" = failure_summary\."progressProcessed"/);
  assert.match(text, /resolved_failure_run\."status"::text::"TLineJobStatus"/);
});

test("job repository returns one claimed row and boolean mutation outcomes", async () => {
  const rows = [
    [{ id: "job-0", status: "QUEUED" }],
    [{ id: "job-1", status: "RUNNING" }],
    [{ id: "job-1", status: "RUNNING" }],
    [{ id: "job-1", status: "CANCELLED" }],
    [{ id: "job-1", status: "SUCCEEDED" }],
    [{ id: "job-1", status: "FAILED" }],
    [{ id: "job-2", status: "QUEUED" }, { id: "job-3", status: "FAILED" }],
  ];
  const executor = {
    async $queryRaw<T>() {
      return rows.shift() as T;
    },
  };
  const now = new Date("2026-08-30T05:00:00.000Z");

  assert.deepEqual(
    await enqueueJob(executor, {
      id: "job-0",
      type: "RUN_CHECK",
      idempotencyKey: "tline:run:run-0",
      availableAt: now,
      payload: { runId: "run-0" },
    }),
    { id: "job-0", status: "QUEUED" },
  );

  assert.deepEqual(
    await claimNextJob(executor, { workerId: "worker-1", leaseDurationMs: 10_000, now }),
    { id: "job-1", status: "RUNNING" },
  );
  assert.equal(
    await heartbeatJob(executor, {
      jobId: "job-1",
      workerId: "worker-1",
      attempt: 2,
      leaseDurationMs: 10_000,
      now,
    }),
    true,
  );
  assert.deepEqual(await cancelJob(executor, { jobId: "job-1", now }), {
    id: "job-1",
    status: "CANCELLED",
  });
  assert.deepEqual(
    await completeJob(executor, {
      jobId: "job-1",
      workerId: "worker-1",
      attempt: 2,
      status: "SUCCEEDED",
      now,
    }),
    { id: "job-1", status: "SUCCEEDED" },
  );
  assert.equal(await failJobAndRun(executor, {
    jobId: "job-1",
    workerId: "worker-1",
    attempt: 2,
    now,
    errorCode: "ParserError",
    jobErrorMessage: "job failed",
    runErrorMessage: "run failed",
  }), true);
  assert.deepEqual(await recoverExpiredJobs(executor, { now }), [
    { id: "job-2", status: "QUEUED" },
    { id: "job-3", status: "FAILED" },
  ]);
});

test("lease guard aborts source work and fences completion after ownership is lost", () => {
  const guard = createTLineLeaseGuard();
  guard.assertOwned();

  guard.lose(new Error("heartbeat rejected"));

  assert.equal(guard.signal.aborted, true);
  assert.throws(() => guard.assertOwned(), TLineJobLeaseLostError);
});

test("scheduler emits missed Moscow slots once and in chronological order", () => {
  const slots = computeDueScheduleSlots({
    lastTickAt: new Date("2026-08-30T04:59:59.000Z"),
    now: new Date("2026-08-30T19:00:00.000Z"),
    timezone: "Europe/Moscow",
    slotHours: [22, 8, 12, 16, 12],
  });

  assert.deepEqual(
    slots.map((slot) => slot.toISOString()),
    [
      "2026-08-30T05:00:00.000Z",
      "2026-08-30T09:00:00.000Z",
      "2026-08-30T13:00:00.000Z",
      "2026-08-30T19:00:00.000Z",
    ],
  );
});

test("scheduler validates timezone, hours, and inverted windows", () => {
  assert.throws(
    () =>
      computeDueScheduleSlots({
        lastTickAt: new Date("2026-08-30T06:00:00.000Z"),
        now: new Date("2026-08-30T05:00:00.000Z"),
        timezone: "Europe/Moscow",
        slotHours: [8],
      }),
    /now must not precede lastTickAt/,
  );
  assert.throws(
    () =>
      computeDueScheduleSlots({
        lastTickAt: new Date("2026-08-30T04:00:00.000Z"),
        now: new Date("2026-08-30T05:00:00.000Z"),
        timezone: "Not\/AZone",
        slotHours: [8],
      }),
    /timezone/,
  );
  assert.throws(
    () =>
      computeDueScheduleSlots({
        lastTickAt: new Date("2026-08-30T04:00:00.000Z"),
        now: new Date("2026-08-30T05:00:00.000Z"),
        timezone: "Europe/Moscow",
        slotHours: [24],
      }),
    /slotHours/,
  );
});

test("scheduler builds deterministic idempotent requests for active sports", () => {
  const slot = new Date("2026-08-30T05:00:00.000Z");
  const requests = buildScheduledRunRequests({
    slots: [slot],
    sports: [
      {
        id: "disabled",
        active: true,
        autoEnabled: false,
        autoPeriodFromOffsetMinutes: -60,
        autoPeriodToOffsetMinutes: 180,
      },
      {
        id: "volleyball",
        active: true,
        autoEnabled: true,
        autoPeriodFromOffsetMinutes: -60,
        autoPeriodToOffsetMinutes: 180,
      },
    ],
  });

  assert.deepEqual(requests, [
    {
      sportConfigId: "volleyball",
      scheduledAt: slot,
      periodFrom: new Date("2026-08-30T04:00:00.000Z"),
      periodTo: new Date("2026-08-30T08:00:00.000Z"),
      idempotencyKey: "tline:run:volleyball:2026-08-30T05:00:00.000Z",
    },
  ]);
});

test("scheduler refuses enabled sports with incomplete periods", () => {
  assert.throws(
    () =>
      buildScheduledRunRequests({
        slots: [new Date("2026-08-30T05:00:00.000Z")],
        sports: [
          {
            id: "volleyball",
            active: true,
            autoEnabled: true,
            autoPeriodFromOffsetMinutes: null,
            autoPeriodToOffsetMinutes: 180,
          },
        ],
      }),
    /period offsets/,
  );
});
