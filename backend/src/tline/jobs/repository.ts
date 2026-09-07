import type { Prisma } from "@prisma/client";

import {
  buildCancelJobQuery,
  buildClaimNextJobQuery,
  buildCompleteJobQuery,
  buildEnqueueJobQuery,
  buildFailJobAndRunQuery,
  buildHeartbeatJobQuery,
  buildRecoverExpiredJobsQuery,
  type CancelJobOptions,
  type ClaimNextJobOptions,
  type CompleteJobOptions,
  type EnqueueJobOptions,
  type FailJobAndRunOptions,
  type HeartbeatJobOptions,
  type RecoverExpiredJobsOptions,
} from "@backend/tline/jobs/queries";

export interface RawQueryExecutor {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

export interface TLineJobRow {
  id: string;
  status: string;
  [key: string]: unknown;
}

export async function enqueueJob(
  executor: RawQueryExecutor,
  options: EnqueueJobOptions,
): Promise<TLineJobRow> {
  const rows = await executor.$queryRaw<TLineJobRow[]>(buildEnqueueJobQuery(options));
  const job = rows[0];
  if (!job) throw new Error("TLine job enqueue did not return a row");
  return job;
}

/** Захват задачи выполняется SQL-запросом с арендой; разные worker не должны получить один запуск. */
export async function claimNextJob(
  executor: RawQueryExecutor,
  options: ClaimNextJobOptions,
): Promise<TLineJobRow | null> {
  const rows = await executor.$queryRaw<TLineJobRow[]>(buildClaimNextJobQuery(options));
  return rows[0] ?? null;
}

/** Продление возвращает false, если worker уже утратил право продолжать текущую попытку. */
export async function heartbeatJob(
  executor: RawQueryExecutor,
  options: HeartbeatJobOptions,
): Promise<boolean> {
  const rows = await executor.$queryRaw<TLineJobRow[]>(buildHeartbeatJobQuery(options));
  return rows.length === 1;
}

export async function cancelJob(
  executor: RawQueryExecutor,
  options: CancelJobOptions,
): Promise<TLineJobRow | null> {
  const rows = await executor.$queryRaw<TLineJobRow[]>(buildCancelJobQuery(options));
  return rows[0] ?? null;
}

export async function completeJob(
  executor: RawQueryExecutor,
  options: CompleteJobOptions,
): Promise<TLineJobRow | null> {
  const rows = await executor.$queryRaw<TLineJobRow[]>(buildCompleteJobQuery(options));
  return rows[0] ?? null;
}

/** Ошибка завершает задачу и незаконченные чемпионаты согласованно, только пока аренда принадлежит worker. */
export async function failJobAndRun(
  executor: RawQueryExecutor,
  options: FailJobAndRunOptions,
): Promise<boolean> {
  if (supportsInteractiveTransactions(executor)) {
    return executor.$transaction((transaction) => failJobAndRunTransaction(transaction, options));
  }
  const rows = await executor.$queryRaw<TLineJobRow[]>(buildFailJobAndRunQuery(options));
  return rows.length === 1;
}

export async function recoverExpiredJobs(
  executor: RawQueryExecutor,
  options: RecoverExpiredJobsOptions,
): Promise<TLineJobRow[]> {
  const rows = await executor.$queryRaw<TLineJobRow[]>(buildRecoverExpiredJobsQuery(options));
  return rows;
}

type InteractiveTransactionExecutor = RawQueryExecutor & {
  $transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};

function supportsInteractiveTransactions(executor: RawQueryExecutor): executor is InteractiveTransactionExecutor {
  return typeof (executor as { $transaction?: unknown }).$transaction === "function";
}

async function failJobAndRunTransaction(
  transaction: Prisma.TransactionClient,
  options: FailJobAndRunOptions,
) {
  const ownedJob = await transaction.tLineJob.findFirst({
    where: {
      id: options.jobId,
      status: "RUNNING",
      leaseOwner: options.workerId,
      attempts: options.attempt,
      leaseExpiresAt: { gt: options.now },
      cancelRequestedAt: null,
    },
    select: { id: true, runId: true },
  });
  if (!ownedJob) return false;

  if (!ownedJob.runId) {
    const updated = await transaction.tLineJob.updateMany({
      where: liveLeaseWhere(options),
      data: terminalJobData("FAILED", options),
    });
    return updated.count === 1;
  }

  await transaction.tLineRunChampionship.updateMany({
    where: { runId: ownedJob.runId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "FAILED",
      automaticStatus: "PARSER_FAILED",
      effectiveStatus: "PARSER_FAILED",
      severity: "ERROR",
      effectiveSeverity: "ERROR",
      reasonCodes: ["PARSER_FAILED"],
      completedAt: options.now,
      errorCode: options.errorCode,
      errorMessage: options.runErrorMessage,
      updatedAt: options.now,
    },
  });
  const championships = await transaction.tLineRunChampionship.findMany({
    where: { runId: ownedJob.runId },
    select: { status: true, effectiveSeverity: true },
  });
  const runStatus = resolveFailedRunStatus(championships.map((championship) => championship.status));
  const counts = countSeverities(championships.map((championship) => championship.effectiveSeverity));
  const run = await transaction.tLineRun.findUniqueOrThrow({
    where: { id: ownedJob.runId },
    select: { status: true },
  });
  const resolvedStatus = isTerminalStatus(run.status) ? run.status : runStatus;
  if (["QUEUED", "RUNNING"].includes(run.status)) {
    await transaction.tLineRun.update({
      where: { id: ownedJob.runId },
      data: {
        status: runStatus,
        progressTotal: championships.length,
        progressProcessed: championships.filter((championship) => !["QUEUED", "RUNNING"].includes(championship.status)).length,
        ...counts,
        completedAt: options.now,
        errorCode: runStatus === "FAILED" || runStatus === "PARTIAL" ? options.errorCode : null,
        errorMessage: runStatus === "FAILED" || runStatus === "PARTIAL" ? options.runErrorMessage : null,
        updatedAt: options.now,
      },
    });
  }
  const updated = await transaction.tLineJob.updateMany({
    where: liveLeaseWhere(options),
    data: terminalJobData(resolvedStatus, options),
  });
  return updated.count === 1;
}

function liveLeaseWhere(options: FailJobAndRunOptions) {
  return {
    id: options.jobId,
    status: "RUNNING" as const,
    leaseOwner: options.workerId,
    attempts: options.attempt,
    leaseExpiresAt: { gt: options.now },
    cancelRequestedAt: null,
  };
}

function terminalJobData(status: "SUCCEEDED" | "PARTIAL" | "CANCELLED" | "FAILED", options: FailJobAndRunOptions) {
  const failed = status === "FAILED" || status === "PARTIAL";
  return {
    status,
    completedAt: options.now,
    errorCode: failed ? options.errorCode : null,
    errorMessage: failed ? options.jobErrorMessage : null,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    updatedAt: options.now,
  };
}

function isTerminalStatus(status: string): status is "SUCCEEDED" | "PARTIAL" | "CANCELLED" | "FAILED" {
  return status === "SUCCEEDED" || status === "PARTIAL" || status === "CANCELLED" || status === "FAILED";
}

function resolveFailedRunStatus(statuses: readonly string[]): "SUCCEEDED" | "PARTIAL" | "CANCELLED" | "FAILED" {
  if (statuses.length === 0 || statuses.every((status) => status === "FAILED")) return "FAILED";
  if (statuses.every((status) => status === "CANCELLED")) return "CANCELLED";
  if (statuses.some((status) => status === "FAILED" || status === "PARTIAL")) return "PARTIAL";
  return "SUCCEEDED";
}

function countSeverities(severities: readonly string[]) {
  const count = (severity: string) => severities.filter((candidate) => candidate === severity).length;
  return {
    okCount: count("OK"),
    warningCount: count("WARNING"),
    errorCount: count("ERROR"),
    criticalCount: count("CRITICAL"),
    unprocessedCount: count("UNPROCESSED"),
  };
}
