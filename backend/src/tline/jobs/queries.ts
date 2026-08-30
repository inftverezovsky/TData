import { Prisma } from "@prisma/client";

const MAX_LEASE_DURATION_MS = 86_400_000;

interface LeaseOptions {
  workerId: string;
  leaseDurationMs: number;
  now: Date;
}

export interface ClaimNextJobOptions extends LeaseOptions {}

export interface HeartbeatJobOptions extends LeaseOptions {
  jobId: string;
  attempt: number;
}

export interface CancelJobOptions {
  jobId: string;
  now: Date;
}

export interface RecoverExpiredJobsOptions {
  now: Date;
}

export interface EnqueueJobOptions {
  id: string;
  sportConfigId?: string | null;
  runId?: string | null;
  type: "RUN_CHECK" | "RETENTION_CLEANUP";
  idempotencyKey: string;
  scheduledAt?: Date | null;
  availableAt: Date;
  createdAt?: Date;
  priority?: number;
  payload: unknown;
  maxAttempts?: number;
}

export type TerminalTLineJobStatus = "SUCCEEDED" | "PARTIAL" | "CANCELLED" | "FAILED";

export interface CompleteJobOptions {
  jobId: string;
  workerId: string;
  attempt: number;
  status: TerminalTLineJobStatus;
  now: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface FailJobAndRunOptions extends Omit<CompleteJobOptions, "status" | "errorMessage"> {
  errorCode: string;
  jobErrorMessage: string;
  runErrorMessage: string;
}

export function buildClaimNextJobQuery(options: ClaimNextJobOptions): Prisma.Sql {
  assertLeaseOptions(options);

  return Prisma.sql`
    WITH candidate AS (
      SELECT "id"
      FROM "TLineJob"
      WHERE "status" = 'QUEUED'::"TLineJobStatus"
        AND "availableAt" <= ${options.now}
        AND "cancelRequestedAt" IS NULL
      ORDER BY "priority" DESC, "availableAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "TLineJob" AS job
    SET "status" = 'RUNNING'::"TLineJobStatus",
        "leaseOwner" = ${options.workerId},
        "leaseExpiresAt" = ${options.now} + (${options.leaseDurationMs} * interval '1 millisecond'),
        "heartbeatAt" = ${options.now},
        "attempts" = job."attempts" + 1,
        "startedAt" = COALESCE(job."startedAt", ${options.now}),
        "updatedAt" = ${options.now}
    FROM candidate
    WHERE job."id" = candidate."id"
    RETURNING job.*
  `;
}

export function buildEnqueueJobQuery(options: EnqueueJobOptions): Prisma.Sql {
  assertIdentifier(options.id, "id");
  assertIdentifier(options.idempotencyKey, "idempotencyKey");
  assertValidDate(options.availableAt, "availableAt");
  const createdAt = options.createdAt ?? new Date();
  assertValidDate(createdAt, "createdAt");
  if (options.scheduledAt) assertValidDate(options.scheduledAt, "scheduledAt");
  if (!(["RUN_CHECK", "RETENTION_CLEANUP"] as const).includes(options.type)) {
    throw new Error("type must be a supported TLine job type");
  }
  const priority = options.priority ?? 0;
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(priority)) throw new Error("priority must be a safe integer");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > 100) {
    throw new Error("maxAttempts must be an integer between 1 and 100");
  }
  const payload = JSON.stringify(options.payload);
  if (payload === undefined) throw new Error("payload must be JSON serializable");

  return Prisma.sql`
    INSERT INTO "TLineJob" (
      "id", "sportConfigId", "runId", "type", "status", "idempotencyKey",
      "scheduledAt", "availableAt", "priority", "payload", "maxAttempts",
      "createdAt", "updatedAt"
    ) VALUES (
      ${options.id}, ${options.sportConfigId ?? null}, ${options.runId ?? null},
      ${options.type}::"TLineJobType", 'QUEUED'::"TLineJobStatus",
      ${options.idempotencyKey}, ${options.scheduledAt ?? null}, ${options.availableAt},
      ${priority}, ${payload}::jsonb, ${maxAttempts}, ${createdAt}, ${createdAt}
    )
    ON CONFLICT ("idempotencyKey") DO UPDATE
      SET "idempotencyKey" = "TLineJob"."idempotencyKey"
    RETURNING *
  `;
}

export function buildHeartbeatJobQuery(options: HeartbeatJobOptions): Prisma.Sql {
  assertIdentifier(options.jobId, "jobId");
  assertAttempt(options.attempt);
  assertLeaseOptions(options);

  return Prisma.sql`
    UPDATE "TLineJob"
    SET "heartbeatAt" = ${options.now},
        "leaseExpiresAt" = ${options.now} + (${options.leaseDurationMs} * interval '1 millisecond'),
        "updatedAt" = ${options.now}
    WHERE "id" = ${options.jobId}
      AND "status" = 'RUNNING'::"TLineJobStatus"
      AND "leaseOwner" = ${options.workerId}
      AND "attempts" = ${options.attempt}
      AND "leaseExpiresAt" > ${options.now}
      AND "cancelRequestedAt" IS NULL
    RETURNING *
  `;
}

export function buildCancelJobQuery(options: CancelJobOptions): Prisma.Sql {
  assertIdentifier(options.jobId, "jobId");
  assertValidDate(options.now, "now");

  return Prisma.sql`
    UPDATE "TLineJob"
    SET "status" = CASE "status"::text
          WHEN 'QUEUED' THEN 'CANCELLED'::"TLineJobStatus"
          WHEN 'RUNNING' THEN "status"
          ELSE "status"
        END,
        "cancelRequestedAt" = CASE
          WHEN "status" IN ('QUEUED'::"TLineJobStatus", 'RUNNING'::"TLineJobStatus")
          THEN ${options.now}
          ELSE "cancelRequestedAt"
        END,
        "completedAt" = CASE
          WHEN "status" = 'QUEUED'::"TLineJobStatus" THEN ${options.now}
          ELSE "completedAt"
        END,
        "leaseOwner" = CASE
          WHEN "status" = 'QUEUED'::"TLineJobStatus" THEN NULL
          ELSE "leaseOwner"
        END,
        "leaseExpiresAt" = CASE
          WHEN "status" = 'QUEUED'::"TLineJobStatus" THEN NULL
          ELSE "leaseExpiresAt"
        END,
        "updatedAt" = ${options.now}
    WHERE "id" = ${options.jobId}
      AND "status" IN ('QUEUED'::"TLineJobStatus", 'RUNNING'::"TLineJobStatus")
    RETURNING *
  `;
}

export function buildRecoverExpiredJobsQuery(
  options: RecoverExpiredJobsOptions,
): Prisma.Sql {
  assertValidDate(options.now, "now");

  return Prisma.sql`
    WITH expired AS (
      SELECT *
      FROM "TLineJob"
      WHERE "status" = 'RUNNING'::"TLineJobStatus"
        AND "leaseExpiresAt" <= ${options.now}
      FOR UPDATE
    ), requeued_jobs AS (
      UPDATE "TLineJob" AS job
      SET "status" = 'QUEUED'::"TLineJobStatus",
          "availableAt" = ${options.now},
          "completedAt" = NULL,
          "errorCode" = NULL,
          "errorMessage" = NULL,
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "heartbeatAt" = NULL,
          "updatedAt" = ${options.now}
      FROM expired
      WHERE job."id" = expired."id"
        AND expired."cancelRequestedAt" IS NULL
        AND expired."attempts" < expired."maxAttempts"
      RETURNING job.*
    ), terminal_candidates AS (
      SELECT * FROM expired
      WHERE ("cancelRequestedAt" IS NOT NULL OR "attempts" >= "maxAttempts")
        AND "runId" IS NOT NULL
    ), terminal_without_run AS (
      UPDATE "TLineJob" AS job
      SET "status" = CASE
            WHEN expired."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED'::"TLineJobStatus"
            ELSE 'FAILED'::"TLineJobStatus"
          END,
          "completedAt" = ${options.now},
          "errorCode" = CASE WHEN expired."cancelRequestedAt" IS NULL THEN 'LEASE_EXPIRED' ELSE NULL END,
          "errorMessage" = CASE WHEN expired."cancelRequestedAt" IS NULL THEN 'Worker lease expired after maximum attempts' ELSE NULL END,
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "heartbeatAt" = NULL,
          "updatedAt" = ${options.now}
      FROM expired
      WHERE job."id" = expired."id"
        AND (expired."cancelRequestedAt" IS NOT NULL OR expired."attempts" >= expired."maxAttempts")
        AND expired."runId" IS NULL
      RETURNING job.*
    ), terminal_championships AS (
      UPDATE "TLineRunChampionship" AS championship
      SET "status" = CASE
            WHEN terminal_candidates."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED'::"TLineRunStatus"
            ELSE 'FAILED'::"TLineRunStatus"
          END,
          "automaticStatus" = CASE
            WHEN terminal_candidates."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED'::"TLineAutomaticStatus"
            ELSE 'PARSER_FAILED'::"TLineAutomaticStatus"
          END,
          "effectiveStatus" = CASE
            WHEN terminal_candidates."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED'::"TLineEffectiveStatus"
            ELSE 'PARSER_FAILED'::"TLineEffectiveStatus"
          END,
          "severity" = CASE
            WHEN terminal_candidates."cancelRequestedAt" IS NOT NULL THEN 'UNPROCESSED'::"TLineSeverity"
            ELSE 'ERROR'::"TLineSeverity"
          END,
          "effectiveSeverity" = CASE
            WHEN terminal_candidates."cancelRequestedAt" IS NOT NULL THEN 'UNPROCESSED'::"TLineSeverity"
            ELSE 'ERROR'::"TLineSeverity"
          END,
          "reasonCodes" = CASE
            WHEN terminal_candidates."cancelRequestedAt" IS NOT NULL THEN '["CANCELLED"]'::jsonb
            ELSE '["LEASE_EXPIRED"]'::jsonb
          END,
          "completedAt" = ${options.now},
          "errorCode" = CASE WHEN terminal_candidates."cancelRequestedAt" IS NULL THEN 'LEASE_EXPIRED' ELSE NULL END,
          "errorMessage" = CASE WHEN terminal_candidates."cancelRequestedAt" IS NULL THEN 'Worker lease expired after maximum attempts' ELSE NULL END,
          "updatedAt" = ${options.now}
      FROM terminal_candidates
      WHERE championship."runId" = terminal_candidates."runId"
        AND championship."status" IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
      RETURNING championship."id", championship."runId", championship."status", championship."effectiveSeverity"
    ), championship_summary AS (
      SELECT terminal_candidates."runId",
             COUNT(combined."runId")::integer AS "progressTotal",
             COUNT(combined."runId") FILTER (WHERE combined."status" NOT IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus"))::integer AS "progressProcessed",
             COUNT(combined."runId") FILTER (WHERE combined."status" = 'FAILED'::"TLineRunStatus")::integer AS "failedCount",
             COUNT(combined."runId") FILTER (WHERE combined."status" = 'PARTIAL'::"TLineRunStatus")::integer AS "partialCount",
             COUNT(combined."runId") FILTER (WHERE combined."status" = 'CANCELLED'::"TLineRunStatus")::integer AS "cancelledCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'OK'::"TLineSeverity")::integer AS "okCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'WARNING'::"TLineSeverity")::integer AS "warningCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'ERROR'::"TLineSeverity")::integer AS "errorCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'CRITICAL'::"TLineSeverity")::integer AS "criticalCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'UNPROCESSED'::"TLineSeverity")::integer AS "unprocessedCount"
      FROM terminal_candidates
      LEFT JOIN (
        SELECT championship."runId", championship."status", championship."effectiveSeverity"
        FROM "TLineRunChampionship" AS championship
        JOIN terminal_candidates ON terminal_candidates."runId" = championship."runId"
        WHERE championship."status" NOT IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
        UNION ALL
        SELECT "runId", "status", "effectiveSeverity" FROM terminal_championships
      ) AS combined ON combined."runId" = terminal_candidates."runId"
      GROUP BY terminal_candidates."runId"
    ), terminal_runs AS (
      UPDATE "TLineRun" AS run
      SET "status" = CASE
            WHEN terminal_candidates."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED'::"TLineRunStatus"
            WHEN championship_summary."progressTotal" = 0 THEN 'SUCCEEDED'::"TLineRunStatus"
            WHEN championship_summary."failedCount" = championship_summary."progressTotal" THEN 'FAILED'::"TLineRunStatus"
            WHEN championship_summary."cancelledCount" = championship_summary."progressTotal" THEN 'CANCELLED'::"TLineRunStatus"
            WHEN championship_summary."failedCount" > 0 OR championship_summary."partialCount" > 0 THEN 'PARTIAL'::"TLineRunStatus"
            ELSE 'SUCCEEDED'::"TLineRunStatus"
          END,
          "progressTotal" = championship_summary."progressTotal",
          "progressProcessed" = championship_summary."progressProcessed",
          "okCount" = championship_summary."okCount",
          "warningCount" = championship_summary."warningCount",
          "errorCount" = championship_summary."errorCount",
          "criticalCount" = championship_summary."criticalCount",
          "unprocessedCount" = championship_summary."unprocessedCount",
          "completedAt" = ${options.now},
          "errorCode" = CASE WHEN terminal_candidates."cancelRequestedAt" IS NULL AND championship_summary."failedCount" > 0 THEN 'LEASE_EXPIRED' ELSE NULL END,
          "errorMessage" = CASE WHEN terminal_candidates."cancelRequestedAt" IS NULL AND championship_summary."failedCount" > 0 THEN 'Worker lease expired after maximum attempts' ELSE NULL END,
          "updatedAt" = ${options.now}
      FROM terminal_candidates
      JOIN championship_summary ON championship_summary."runId" = terminal_candidates."runId"
      WHERE run."id" = terminal_candidates."runId"
        AND run."status" IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
      RETURNING run."id", run."status"
    ), resolved_runs AS (
      SELECT "id", "status" FROM terminal_runs
      UNION ALL
      SELECT run."id", run."status"
      FROM "TLineRun" AS run
      JOIN terminal_candidates ON terminal_candidates."runId" = run."id"
      WHERE run."status" NOT IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
    ), completed_jobs AS (
      UPDATE "TLineJob" AS job
      SET "status" = resolved_runs."status"::text::"TLineJobStatus",
          "completedAt" = ${options.now},
          "errorCode" = CASE WHEN resolved_runs."status" IN ('FAILED'::"TLineRunStatus", 'PARTIAL'::"TLineRunStatus") THEN 'LEASE_EXPIRED' ELSE NULL END,
          "errorMessage" = CASE WHEN resolved_runs."status" IN ('FAILED'::"TLineRunStatus", 'PARTIAL'::"TLineRunStatus") THEN 'Worker lease expired after maximum attempts' ELSE NULL END,
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "heartbeatAt" = NULL,
          "updatedAt" = ${options.now}
      FROM terminal_candidates
      JOIN resolved_runs ON resolved_runs."id" = terminal_candidates."runId"
      WHERE job."id" = terminal_candidates."id"
      RETURNING job.*
    )
    SELECT * FROM requeued_jobs
    UNION ALL
    SELECT * FROM terminal_without_run
    UNION ALL
    SELECT * FROM completed_jobs
  `;
}

export function buildCompleteJobQuery(options: CompleteJobOptions): Prisma.Sql {
  assertIdentifier(options.jobId, "jobId");
  assertIdentifier(options.workerId, "workerId");
  assertAttempt(options.attempt);
  assertValidDate(options.now, "now");
  if (!(["SUCCEEDED", "PARTIAL", "CANCELLED", "FAILED"] as const).includes(options.status)) {
    throw new Error("status must be a terminal status");
  }

  return Prisma.sql`
    UPDATE "TLineJob"
    SET "status" = ${options.status}::"TLineJobStatus",
        "completedAt" = ${options.now},
        "errorCode" = ${options.errorCode ?? null},
        "errorMessage" = ${options.errorMessage ?? null},
        "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "heartbeatAt" = NULL,
        "updatedAt" = ${options.now}
    WHERE "id" = ${options.jobId}
      AND "status" = 'RUNNING'::"TLineJobStatus"
      AND "leaseOwner" = ${options.workerId}
      AND "attempts" = ${options.attempt}
      AND "leaseExpiresAt" > ${options.now}
    RETURNING *
  `;
}

export function buildFailJobAndRunQuery(options: FailJobAndRunOptions): Prisma.Sql {
  assertIdentifier(options.jobId, "jobId");
  assertIdentifier(options.workerId, "workerId");
  assertAttempt(options.attempt);
  assertValidDate(options.now, "now");
  assertIdentifier(options.errorCode, "errorCode");
  assertIdentifier(options.jobErrorMessage, "jobErrorMessage");
  assertIdentifier(options.runErrorMessage, "runErrorMessage");

  return Prisma.sql`
    WITH owned_job AS (
      SELECT * FROM "TLineJob" AS job
      WHERE job."id" = ${options.jobId}
        AND job."status" = 'RUNNING'::"TLineJobStatus"
        AND job."leaseOwner" = ${options.workerId}
        AND job."attempts" = ${options.attempt}
        AND job."leaseExpiresAt" > ${options.now}
        AND job."cancelRequestedAt" IS NULL
      FOR UPDATE
    ), failed_championships AS (
      UPDATE "TLineRunChampionship" AS championship
      SET "status" = 'FAILED'::"TLineRunStatus",
          "automaticStatus" = 'PARSER_FAILED'::"TLineAutomaticStatus",
          "effectiveStatus" = 'PARSER_FAILED'::"TLineEffectiveStatus",
          "severity" = 'ERROR'::"TLineSeverity",
          "effectiveSeverity" = 'ERROR'::"TLineSeverity",
          "reasonCodes" = '["PARSER_FAILED"]'::jsonb,
          "completedAt" = ${options.now},
          "errorCode" = ${options.errorCode},
          "errorMessage" = ${options.runErrorMessage},
          "updatedAt" = ${options.now}
      FROM owned_job
      WHERE championship."runId" = owned_job."runId"
        AND championship."status" IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
      RETURNING championship."id", championship."runId", championship."status", championship."effectiveSeverity"
    ), failure_summary AS (
      SELECT owned_job."runId",
             COUNT(combined."runId")::integer AS "progressTotal",
             COUNT(combined."runId") FILTER (WHERE combined."status" NOT IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus"))::integer AS "progressProcessed",
             COUNT(combined."runId") FILTER (WHERE combined."status" = 'FAILED'::"TLineRunStatus")::integer AS "failedCount",
             COUNT(combined."runId") FILTER (WHERE combined."status" = 'PARTIAL'::"TLineRunStatus")::integer AS "partialCount",
             COUNT(combined."runId") FILTER (WHERE combined."status" = 'CANCELLED'::"TLineRunStatus")::integer AS "cancelledCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'OK'::"TLineSeverity")::integer AS "okCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'WARNING'::"TLineSeverity")::integer AS "warningCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'ERROR'::"TLineSeverity")::integer AS "errorCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'CRITICAL'::"TLineSeverity")::integer AS "criticalCount",
             COUNT(combined."runId") FILTER (WHERE combined."effectiveSeverity" = 'UNPROCESSED'::"TLineSeverity")::integer AS "unprocessedCount"
      FROM owned_job
      LEFT JOIN (
        SELECT championship."runId", championship."status", championship."effectiveSeverity"
        FROM "TLineRunChampionship" AS championship
        JOIN owned_job ON owned_job."runId" = championship."runId"
        WHERE championship."status" NOT IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
        UNION ALL
        SELECT "runId", "status", "effectiveSeverity" FROM failed_championships
      ) AS combined ON combined."runId" = owned_job."runId"
      GROUP BY owned_job."runId"
    ), failed_run AS (
      UPDATE "TLineRun" AS run
      SET "status" = CASE
            WHEN failure_summary."progressTotal" = 0 THEN 'FAILED'::"TLineRunStatus"
            WHEN failure_summary."failedCount" = failure_summary."progressTotal" THEN 'FAILED'::"TLineRunStatus"
            WHEN failure_summary."cancelledCount" = failure_summary."progressTotal" THEN 'CANCELLED'::"TLineRunStatus"
            WHEN failure_summary."failedCount" > 0 OR failure_summary."partialCount" > 0 THEN 'PARTIAL'::"TLineRunStatus"
            ELSE 'SUCCEEDED'::"TLineRunStatus"
          END,
          "progressTotal" = failure_summary."progressTotal",
          "progressProcessed" = failure_summary."progressProcessed",
          "okCount" = failure_summary."okCount",
          "warningCount" = failure_summary."warningCount",
          "errorCount" = failure_summary."errorCount",
          "criticalCount" = failure_summary."criticalCount",
          "unprocessedCount" = failure_summary."unprocessedCount",
          "completedAt" = ${options.now},
          "errorCode" = CASE WHEN failure_summary."failedCount" > 0 OR failure_summary."progressTotal" = 0 THEN ${options.errorCode} ELSE NULL END,
          "errorMessage" = CASE WHEN failure_summary."failedCount" > 0 OR failure_summary."progressTotal" = 0 THEN ${options.runErrorMessage} ELSE NULL END,
          "updatedAt" = ${options.now}
      FROM owned_job
      JOIN failure_summary ON failure_summary."runId" = owned_job."runId"
      WHERE run."id" = owned_job."runId"
        AND run."status" IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
      RETURNING run."id", run."status"
    ), resolved_failure_run AS (
      SELECT "id", "status" FROM failed_run
      UNION ALL
      SELECT run."id", run."status"
      FROM "TLineRun" AS run
      JOIN owned_job ON owned_job."runId" = run."id"
      WHERE run."status" NOT IN ('QUEUED'::"TLineRunStatus", 'RUNNING'::"TLineRunStatus")
    ), failed_job AS (
      UPDATE "TLineJob" AS job
      SET "status" = resolved_failure_run."status"::text::"TLineJobStatus",
          "completedAt" = ${options.now},
          "errorCode" = CASE WHEN resolved_failure_run."status" IN ('FAILED'::"TLineRunStatus", 'PARTIAL'::"TLineRunStatus") THEN ${options.errorCode} ELSE NULL END,
          "errorMessage" = CASE WHEN resolved_failure_run."status" IN ('FAILED'::"TLineRunStatus", 'PARTIAL'::"TLineRunStatus") THEN ${options.jobErrorMessage} ELSE NULL END,
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "heartbeatAt" = NULL,
          "updatedAt" = ${options.now}
      FROM owned_job
      JOIN resolved_failure_run ON resolved_failure_run."id" = owned_job."runId"
      WHERE job."id" = owned_job."id"
      RETURNING job.*
    )
    SELECT * FROM failed_job
  `;
}

function assertLeaseOptions(options: LeaseOptions) {
  assertIdentifier(options.workerId, "workerId");
  assertValidDate(options.now, "now");
  if (
    !Number.isSafeInteger(options.leaseDurationMs) ||
    options.leaseDurationMs <= 0 ||
    options.leaseDurationMs > MAX_LEASE_DURATION_MS
  ) {
    throw new Error(`leaseDurationMs must be an integer between 1 and ${MAX_LEASE_DURATION_MS}`);
  }
}

function assertIdentifier(value: string, name: string) {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertAttempt(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("attempt must be a positive safe integer");
}

function assertValidDate(value: Date, name: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
}
