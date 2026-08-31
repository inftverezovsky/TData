import assert from "node:assert/strict";
import test from "node:test";

import {
  MonitorProbeError,
  runParserMonitor,
  type ParserProbe,
} from "../backend/src/monitoring/parserMonitorCore";
import {
  processTelegramTransition,
  type TelegramNotificationState,
} from "../backend/src/monitoring/parserMonitorTelegram";
import type { ParserMonitorReport, SourceProbeResult } from "../backend/src/monitoring/parserMonitorTypes";

test("required warnings retry, exit non-zero and participate in Telegram incident/recovery state", async () => {
  let requiredAttempts = 0;
  let optionalAttempts = 0;
  const report = await runParserMonitor({
    probes: [
      warningProbe("required-warning", true, () => { requiredAttempts += 1; }),
      warningProbe("optional-warning", false, () => { optionalAttempts += 1; }),
    ],
    retryDelaysMs: [0, 0],
    sleep: async () => undefined,
  });

  assert.equal(requiredAttempts, 3);
  assert.equal(optionalAttempts, 1);
  assert.equal(report.results[0].status, "warning");
  assert.equal(report.results[0].attempts, 3);
  assert.equal(report.exitCode, 1);

  const sent: string[] = [];
  const initial: TelegramNotificationState = { activeFailureFingerprint: null };
  const first = await processTelegramTransition(report, initial, notificationOptions(sent));
  const duplicate = await processTelegramTransition(report, first.state, notificationOptions(sent));
  const recovered = await processTelegramTransition(healthyReport(), duplicate.state, notificationOptions(sent));

  assert.equal(first.sent, "failure");
  assert.equal(duplicate.sent, null);
  assert.equal(recovered.sent, "recovery");
  assert.equal(sent.length, 2);
  assert.match(sent[0], /warning\/cloudflare_block/);
  assert.match(sent[1], /восстанов/i);
});

test("an adapter that ignores abort is bounded and quarantines its hostname", async () => {
  let sameHostSecondRan = false;
  const startedAt = Date.now();
  const report = await runParserMonitor({
    probes: [
      {
        id: "ignores-abort",
        source: "ignores-abort",
        hostname: "stuck.example",
        required: true,
        timeoutMs: 5,
        cleanupGraceMs: 5,
        run: async () => new Promise(() => undefined),
      },
      {
        id: "same-host-next",
        source: "same-host-next",
        hostname: "stuck.example",
        required: true,
        run: async () => {
          sameHostSecondRan = true;
          return { rawCandidates: 1, normalizedItems: 1, detailChecked: true };
        },
      },
      {
        id: "other-host",
        source: "other-host",
        hostname: "healthy.example",
        required: true,
        run: async () => ({ rawCandidates: 1, normalizedItems: 1, detailChecked: true }),
      },
    ],
    retryDelaysMs: [0, 0],
    sleep: async () => undefined,
  });

  assert.ok(Date.now() - startedAt < 500);
  assert.equal(sameHostSecondRan, false);
  assert.deepEqual(report.results.map((result) => result.status), ["failed", "failed", "healthy"]);
  assert.equal(report.results[0].attempts, 1);
  assert.equal(report.results[0].errorClass, "upstream_timeout");
  assert.match(report.results[1].summary, /was not started/i);
});

test("a global monitor abort waits for every active probe cleanup and starts no pending probe", async () => {
  const controller = new AbortController();
  const cleaned: string[] = [];
  let pendingProbeRan = false;
  let started = 0;
  let markBothStarted: (() => void) | undefined;
  const bothStarted = new Promise<void>((resolve) => { markBothStarted = resolve; });

  const activeProbe = (id: string, cleanupDelayMs: number): ParserProbe => ({
    id,
    source: id,
    hostname: `${id}.example`,
    required: true,
    cleanupGraceMs: 100,
    async run(_attempt, signal) {
      started += 1;
      if (started === 2) markBothStarted?.();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          setTimeout(() => {
            cleaned.push(id);
            reject(signal.reason);
          }, cleanupDelayMs);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    },
  });

  const monitor = runParserMonitor({
    probes: [
      activeProbe("active-a", 15),
      activeProbe("active-b", 30),
      {
        id: "pending",
        source: "pending",
        hostname: "pending.example",
        required: true,
        async run() {
          pendingProbeRan = true;
          return { rawCandidates: 1, normalizedItems: 1, detailChecked: true };
        },
      },
    ],
    maxConcurrency: 2,
    retryDelaysMs: [60_000],
    signal: controller.signal,
  });

  await bothStarted;
  let settled = false;
  const observed = monitor.then(
    () => {
      settled = true;
      throw new Error("monitor unexpectedly completed after abort");
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  const rejected = assert.rejects(observed, /service stopping/u);
  controller.abort(new Error("service stopping"));

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false);
  await rejected;
  assert.deepEqual(cleaned.sort(), ["active-a", "active-b"]);
  assert.equal(pendingProbeRan, false);
});

test("a global monitor abort cancels the retry wait and prevents another attempt", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let receivedSleepSignal: AbortSignal | undefined;
  let markSleeping: (() => void) | undefined;
  const sleeping = new Promise<void>((resolve) => { markSleeping = resolve; });

  const monitor = runParserMonitor({
    probes: [{
      id: "retrying",
      source: "retrying",
      hostname: "retrying.example",
      required: true,
      async run() {
        attempts += 1;
        throw new MonitorProbeError("upstream_timeout", "retry me");
      },
    }],
    retryDelaysMs: [60_000],
    signal: controller.signal,
    sleep: async (_milliseconds, signal) => {
      receivedSleepSignal = signal;
      markSleeping?.();
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });

  await sleeping;
  const rejected = assert.rejects(monitor, /operator interrupted/u);
  controller.abort(new Error("operator interrupted"));
  await rejected;

  assert.equal(receivedSleepSignal, controller.signal);
  assert.equal(attempts, 1);
});

function warningProbe(id: string, required: boolean, onRun: () => void): ParserProbe {
  return {
    id,
    source: id,
    hostname: `${id}.example`,
    required,
    async run() {
      onRun();
      return {
        rawCandidates: 1,
        normalizedItems: 1,
        detailChecked: true,
        status: "warning",
        errorClass: "cloudflare_block",
        summary: "primary discovery is blocked",
      };
    },
  };
}

function notificationOptions(sent: string[]) {
  return {
    botToken: "unused",
    chatId: "unused",
    transport: async (text: string) => { sent.push(text); },
  };
}

function healthyReport(): ParserMonitorReport {
  const result: SourceProbeResult = {
    id: "healthy",
    source: "healthy",
    scope: null,
    hostname: "healthy.example",
    required: true,
    status: "healthy",
    errorClass: null,
    summary: "one match",
    rawCandidates: 1,
    normalizedItems: 1,
    detailChecked: true,
    cacheHit: false,
    stale: false,
    attempts: 1,
    durationMs: 1,
    checkedAt: "2026-08-30T15:00:00.000Z",
  };
  return {
    schemaVersion: 1,
    runId: "healthy",
    startedAt: result.checkedAt,
    finishedAt: result.checkedAt,
    durationMs: 1,
    results: [result],
    summary: { total: 1, healthy: 1, healthyEmpty: 0, warning: 0, failed: 0 },
    exitCode: 0,
  };
}
