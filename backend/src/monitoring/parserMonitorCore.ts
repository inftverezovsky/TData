import crypto from "node:crypto";

import type {
  ParserMonitorReport,
  ParserProbeErrorClass,
  ParserProbeStatus,
  SourceProbeResult,
} from "./parserMonitorTypes";
import { redactMonitorText } from "./parserMonitorRedaction";

export interface ProbeObservation {
  rawCandidates: number;
  normalizedItems: number;
  detailChecked: boolean;
  explicitEmpty?: boolean;
  cacheHit?: boolean;
  stale?: boolean;
  summary?: string;
  errorClass?: ParserProbeErrorClass | null;
  status?: "warning";
}

export interface ParserProbe {
  id: string;
  source: string;
  scope?: string | null;
  hostname: string;
  required: boolean;
  timeoutMs?: number;
  cleanupGraceMs?: number;
  run(attempt: number, signal: AbortSignal): Promise<ProbeObservation>;
}

export class MonitorProbeError extends Error {
  readonly errorClass: ParserProbeErrorClass;

  constructor(errorClass: ParserProbeErrorClass, message: string) {
    super(message);
    this.name = "MonitorProbeError";
    this.errorClass = errorClass;
  }
}

export interface RunParserMonitorOptions {
  probes: readonly ParserProbe[];
  maxConcurrency?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  signal?: AbortSignal;
}

const DEFAULT_RETRY_DELAYS_MS = [30_000, 120_000] as const;
const QUARANTINE_HOST_AFTER_TIMEOUT = Symbol("quarantine-host-after-timeout");

type InternalSourceProbeResult = SourceProbeResult & {
  [QUARANTINE_HOST_AFTER_TIMEOUT]?: true;
};

class MonitorProbeCleanupTimeoutError extends MonitorProbeError {}

export function buildParserMonitorRunnerFailureReport(
  error: unknown,
  now = new Date(),
): ParserMonitorReport {
  const timestamp = now.toISOString();
  const result: SourceProbeResult = {
    id: "parser-monitor-runner",
    source: "parser-monitor",
    scope: "configuration",
    hostname: "monitor.local",
    required: true,
    status: "failed",
    errorClass: classifyMonitorError(error),
    summary: safeErrorMessage(error),
    rawCandidates: 0,
    normalizedItems: 0,
    detailChecked: false,
    cacheHit: false,
    stale: false,
    attempts: 1,
    durationMs: 0,
    checkedAt: timestamp,
  };
  return {
    schemaVersion: 1,
    runId: `${toFileTimestamp(now)}-runner-${crypto.randomBytes(3).toString("hex")}`,
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    results: [result],
    summary: { total: 1, healthy: 0, healthyEmpty: 0, warning: 0, failed: 1 },
    exitCode: 2,
  };
}

export async function runParserMonitor(options: RunParserMonitorOptions): Promise<ParserMonitorReport> {
  options.signal?.throwIfAborted();
  const maxConcurrency = clampConcurrency(options.maxConcurrency ?? 3);
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultMonitorSleep;
  const now = options.now ?? (() => new Date());
  const started = now();
  const results = new Array<SourceProbeResult>(options.probes.length);
  await runScheduled(options.probes, results, maxConcurrency, retryDelaysMs, sleep, now, options.signal);
  const finished = now();
  const summary = {
    total: results.length,
    healthy: results.filter((result) => result.status === "healthy").length,
    healthyEmpty: results.filter((result) => result.status === "healthy_empty").length,
    warning: results.filter((result) => result.status === "warning").length,
    failed: results.filter((result) => result.status === "failed" && result.required).length,
  };
  const hasConfigurationFailure = results.some((result) => (
    result.required
    && result.status === "failed"
    && result.errorClass === "uncovered_provider"
  ));
  const hasRequiredIncident = results.some((result) => (
    result.required && (result.status === "failed" || result.status === "warning")
  ));

  return {
    schemaVersion: 1,
    runId: `${toFileTimestamp(started)}-${crypto.randomBytes(3).toString("hex")}`,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
    results,
    summary,
    exitCode: hasConfigurationFailure ? 2 : hasRequiredIncident ? 1 : 0,
  };
}

async function runScheduled(
  probes: readonly ParserProbe[],
  results: SourceProbeResult[],
  maxConcurrency: number,
  retryDelaysMs: readonly number[],
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  now: () => Date,
  signal?: AbortSignal,
) {
  const pending = probes.map((_, index) => index);
  const active = new Map<number, Promise<void>>();
  const activeHosts = new Set<string>();
  const quarantinedHosts = new Set<string>();

  while (pending.length > 0 || active.size > 0) {
    if (signal?.aborted) {
      await Promise.allSettled([...active.values()]);
      throw monitorAbortReason(signal);
    }
    while (active.size < maxConcurrency && !signal?.aborted) {
      const pendingPosition = pending.findIndex((index) => {
        const hostname = hostKey(probes[index].hostname);
        return !activeHosts.has(hostname) && !quarantinedHosts.has(hostname);
      });
      if (pendingPosition < 0) break;
      const [index] = pending.splice(pendingPosition, 1);
      const probe = probes[index];
      const hostname = hostKey(probe.hostname);
      activeHosts.add(hostname);
      const task = runProbe(probe, retryDelaysMs, sleep, now, signal)
        .then((result) => {
          results[index] = result;
          if (!(result as InternalSourceProbeResult)[QUARANTINE_HOST_AFTER_TIMEOUT]) return;
          quarantinedHosts.add(hostname);
          for (let position = pending.length - 1; position >= 0; position -= 1) {
            const skippedIndex = pending[position];
            if (hostKey(probes[skippedIndex].hostname) !== hostname) continue;
            pending.splice(position, 1);
            const skippedProbe = probes[skippedIndex];
            results[skippedIndex] = buildErrorResult(
              skippedProbe,
              new MonitorProbeError(
                "upstream_timeout",
                `${skippedProbe.id} was not started because a previous probe on ${hostname} ignored abort cleanup`,
              ),
              1,
              Date.now(),
              now(),
            );
          }
        })
        .finally(() => {
          active.delete(index);
          activeHosts.delete(hostname);
        });
      active.set(index, task);
    }
    if (signal?.aborted) {
      await Promise.allSettled([...active.values()]);
      throw monitorAbortReason(signal);
    }
    if (active.size > 0) {
      try {
        await Promise.race(active.values());
      } catch (error) {
        // A global abort rejects each active attempt only after its adapter has
        // settled abort cleanup. Wait for every remaining hostname slot before
        // allowing the runner to unwind and exit.
        await Promise.allSettled([...active.values()]);
        if (signal?.aborted) throw monitorAbortReason(signal);
        throw error;
      }
    }
  }
}

async function runProbe(
  probe: ParserProbe,
  retryDelaysMs: readonly number[],
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  now: () => Date,
  signal?: AbortSignal,
): Promise<SourceProbeResult> {
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryDelaysMs.length + 1; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const observation = await runProbeAttempt(probe, attempt, signal);
      signal?.throwIfAborted();
      const evaluated = evaluateObservation(observation);
      const incidentNeedsRetry = evaluated.status === "failed"
        || (probe.required && evaluated.status === "warning");
      if (!incidentNeedsRetry || attempt > retryDelaysMs.length) {
        return buildResult(probe, observation, evaluated.status, evaluated.errorClass, attempt, startedAt, now());
      }
      lastError = new MonitorProbeError(evaluated.errorClass || "parse_failed", evaluated.summary);
    } catch (error) {
      if (signal?.aborted) throw monitorAbortReason(signal);
      lastError = error;
      if (error instanceof MonitorProbeCleanupTimeoutError) {
        return buildErrorResult(probe, error, attempt, startedAt, now());
      }
      if (attempt > retryDelaysMs.length) {
        return buildErrorResult(probe, error, attempt, startedAt, now());
      }
    }
    await sleepWithSignal(retryDelaysMs[attempt - 1], sleep, signal);
  }

  return buildErrorResult(probe, lastError, retryDelaysMs.length + 1, startedAt, now());
}

function evaluateObservation(observation: ProbeObservation): {
  status: ParserProbeStatus;
  errorClass: ParserProbeErrorClass | null;
  summary: string;
} {
  if (!isCount(observation.rawCandidates) || !isCount(observation.normalizedItems)) {
    return { status: "failed", errorClass: "schema_drift", summary: "Source returned invalid counters" };
  }
  if (observation.stale || observation.cacheHit) {
    return { status: "failed", errorClass: "stale_cache", summary: observation.summary || "Fresh source data was not confirmed" };
  }
  if (observation.status === "warning") {
    return {
      status: "warning",
      errorClass: observation.errorClass ?? null,
      summary: observation.summary || "Source canary succeeded with a degraded fallback",
    };
  }
  if (observation.errorClass) {
    return { status: "failed", errorClass: observation.errorClass, summary: observation.summary || observation.errorClass };
  }
  if (observation.normalizedItems > 0 && observation.detailChecked) {
    return { status: "healthy", errorClass: null, summary: observation.summary || `${observation.normalizedItems} normalized items` };
  }
  if (observation.normalizedItems === 0 && observation.explicitEmpty && observation.detailChecked) {
    return { status: "healthy_empty", errorClass: null, summary: observation.summary || "Source explicitly confirms an empty season/window" };
  }
  if (observation.rawCandidates > 0 && observation.normalizedItems === 0) {
    return { status: "failed", errorClass: "filter_excluded", summary: observation.summary || "Raw source candidates were lost during normalization/filtering" };
  }
  return { status: "failed", errorClass: "schema_drift", summary: observation.summary || "Source returned an unconfirmed empty result" };
}

function buildResult(
  probe: ParserProbe,
  observation: ProbeObservation,
  status: ParserProbeStatus,
  errorClass: ParserProbeErrorClass | null,
  attempts: number,
  startedAt: number,
  checkedAt: Date,
): SourceProbeResult {
  return {
    id: probe.id,
    source: probe.source,
    scope: probe.scope ?? null,
    hostname: probe.hostname,
    required: probe.required,
    status,
    errorClass,
    summary: redactMonitorText(observation.summary || defaultSummary(status, observation)).slice(0, 800),
    rawCandidates: observation.rawCandidates,
    normalizedItems: observation.normalizedItems,
    detailChecked: observation.detailChecked,
    cacheHit: Boolean(observation.cacheHit),
    stale: Boolean(observation.stale),
    attempts,
    durationMs: Math.max(0, Date.now() - startedAt),
    checkedAt: checkedAt.toISOString(),
  };
}

function buildErrorResult(
  probe: ParserProbe,
  error: unknown,
  attempts: number,
  startedAt: number,
  checkedAt: Date,
): SourceProbeResult {
  const result: InternalSourceProbeResult = {
    id: probe.id,
    source: probe.source,
    scope: probe.scope ?? null,
    hostname: probe.hostname,
    required: probe.required,
    status: "failed",
    errorClass: classifyMonitorError(error),
    summary: safeErrorMessage(error),
    rawCandidates: 0,
    normalizedItems: 0,
    detailChecked: false,
    cacheHit: false,
    stale: false,
    attempts,
    durationMs: Math.max(0, Date.now() - startedAt),
    checkedAt: checkedAt.toISOString(),
  };
  if (error instanceof MonitorProbeCleanupTimeoutError) {
    Object.defineProperty(result, QUARANTINE_HOST_AFTER_TIMEOUT, { value: true });
  }
  return result;
}

async function runProbeAttempt(probe: ParserProbe, attempt: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const timeoutMs = Math.max(1, probe.timeoutMs ?? 60_000);
  const cleanupGraceMs = Math.max(1, probe.cleanupGraceMs ?? 5_000);
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  let timeoutError: MonitorProbeError | null = null;
  let externallyAborted = false;
  let externalAbortReason: unknown;
  let rejectExternalAbort: ((reason: unknown) => void) | undefined;
  const externalAbort = new Promise<never>((_resolve, reject) => {
    rejectExternalAbort = reject;
  });
  const onExternalAbort = () => {
    if (externallyAborted) return;
    externallyAborted = true;
    externalAbortReason = monitorAbortReason(signal);
    controller.abort(externalAbortReason);
    rejectExternalAbort?.(externalAbortReason);
  };
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (signal?.aborted) onExternalAbort();

  const operation = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return probe.run(attempt, controller.signal);
  });
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timeoutError = new MonitorProbeError("upstream_timeout", `${probe.id} exceeded its ${timeoutMs} ms probe timeout`);
          reject(timeoutError);
          controller.abort(timeoutError);
        }, timeoutMs);
      }),
      ...(signal ? [externalAbort] : []),
    ]);
  } catch (error) {
    if (externallyAborted || timeoutError) {
      // Do not release the hostname slot while an aborted adapter is still
      // unwinding sockets, browser processes, or other upstream resources.
      // Every production probe receives the signal and must settle its run
      // promise only after cleanup is complete.
      const cleanupSettled = await waitForProbeCleanup(operation, cleanupGraceMs);
      if (!cleanupSettled) {
        throw new MonitorProbeCleanupTimeoutError(
          "upstream_timeout",
          externallyAborted
            ? `${probe.id} did not stop within ${cleanupGraceMs} ms after the monitor was aborted`
            : `${probe.id} exceeded its ${timeoutMs} ms timeout and did not stop within ${cleanupGraceMs} ms after abort`,
        );
      }
      if (externallyAborted) throw externalAbortReason;
      if (timeoutError) throw timeoutError;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

async function sleepWithSignal(
  milliseconds: number,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const operation = Promise.resolve().then(() => sleep(milliseconds, signal));
  if (!signal) {
    await operation;
    return;
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(monitorAbortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([operation, aborted]);
    signal.throwIfAborted();
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function defaultMonitorSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(monitorAbortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function monitorAbortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Parser monitor was aborted", "AbortError");
}

async function waitForProbeCleanup(operation: Promise<unknown>, cleanupGraceMs: number) {
  let cleanupTimer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.then(() => true, () => true),
      new Promise<false>((resolve) => {
        cleanupTimer = setTimeout(() => resolve(false), cleanupGraceMs);
      }),
    ]);
  } finally {
    if (cleanupTimer) clearTimeout(cleanupTimer);
  }
}

function classifyMonitorError(error: unknown): ParserProbeErrorClass {
  if (error instanceof MonitorProbeError) return error.errorClass;
  const message = safeErrorMessage(error).toLowerCase();
  if (/cloudflare|just a moment|challenge-platform|http 403/.test(message)) return "cloudflare_block";
  if (/abort|timed?\s*out|timeout/.test(message)) return "upstream_timeout";
  if (/404|not found/.test(message)) return "placeholder_404";
  if (/selector|schema|unexpected|invalid json|invalid html/.test(message)) return "schema_drift";
  return "parse_failed";
}

function defaultSummary(status: ParserProbeStatus, observation: ProbeObservation) {
  if (status === "healthy") return `${observation.normalizedItems} normalized items`;
  if (status === "healthy_empty") return "Explicit empty source window";
  if (status === "warning") return "Fresh source data was not confirmed";
  return "Parser semantic check failed";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown parser failure");
  return redactMonitorText(message.replace(/\s+/g, " ").trim()).slice(0, 800) || "Unknown parser failure";
}

function isCount(value: number) {
  return Number.isInteger(value) && value >= 0;
}

function clampConcurrency(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(3, Math.max(1, Math.trunc(value)));
}

function hostKey(value: string) {
  return value.trim().toLowerCase() || "local";
}

function toFileTimestamp(date: Date) {
  return date.toISOString().replace(/[.:]/g, "-");
}
