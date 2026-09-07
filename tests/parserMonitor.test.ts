import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { handleParserMonitorRunnerFailure, installParserMonitorSignalHandlers } from "../scripts/parser-monitor";
import { sourceProviders } from "../backend/src/sources/providerRegistry";
import {
  buildParserMonitorRunnerFailureReport,
  MonitorProbeError,
  runParserMonitor,
  type ParserProbe,
} from "../backend/src/monitoring/parserMonitorCore";
import {
  buildDltvProbeFailure,
  buildKhlProbeObservation,
  createStaticParserProbes,
  findUncoveredTLineProviders,
  hltvDetailChecked,
} from "../backend/src/monitoring/parserMonitorProbes";
import {
  persistParserMonitorReport,
  persistParserMonitorNotificationState,
  readLatestParserMonitorReport,
  readParserMonitorNotificationState,
} from "../backend/src/monitoring/parserMonitorPersistence";
import {
  processTelegramTransition,
  redactMonitorText,
  selectTelegramProxyUrls,
  sendTelegramMessage,
  sendTelegramTestNotification,
  type TelegramNotificationState,
} from "../backend/src/monitoring/parserMonitorTelegram";
import type { ParserMonitorReport, SourceProbeResult } from "../backend/src/monitoring/parserMonitorTypes";

function probe(
  id: string,
  hostname: string,
  run: ParserProbe["run"],
): ParserProbe {
  return { id, source: id, hostname, required: true, run };
}

test("monitor classifies semantic results and retries a failed source", async () => {
  let attempts = 0;
  const report = await runParserMonitor({
    probes: [
      probe("healthy", "one.example", async () => ({
        rawCandidates: 4,
        normalizedItems: 3,
        detailChecked: true,
        summary: "3 matches parsed",
      })),
      probe("seasonal", "two.example", async () => ({
        rawCandidates: 4,
        normalizedItems: 0,
        explicitEmpty: true,
        detailChecked: true,
        summary: "official season is empty",
      })),
      probe("retry", "three.example", async () => {
        attempts += 1;
        if (attempts < 3) throw new MonitorProbeError("upstream_timeout", "timed out");
        return { rawCandidates: 1, normalizedItems: 1, detailChecked: true };
      }),
      probe("filtered", "four.example", async () => ({
        rawCandidates: 2,
        normalizedItems: 0,
        detailChecked: false,
      })),
      probe("warning", "five.example", async () => ({
        rawCandidates: 1,
        normalizedItems: 1,
        detailChecked: true,
        status: "warning",
        errorClass: "cloudflare_block",
        summary: "Primary canary blocked; stable fallback passed",
      })),
      probe("unsafe-warning", "six.example", async () => ({
        rawCandidates: 1,
        normalizedItems: 1,
        detailChecked: true,
        status: "warning",
        stale: true,
      })),
    ],
    retryDelaysMs: [30, 120],
    sleep: async () => undefined,
    now: () => new Date("2026-08-30T15:00:00.000Z"),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(report.results.map((result) => result.status), [
    "healthy",
    "healthy_empty",
    "healthy",
    "failed",
    "warning",
    "failed",
  ]);
  assert.equal(report.results[3].errorClass, "filter_excluded");
  assert.equal(report.summary.failed, 2);
  assert.equal(report.exitCode, 1);
});

test("monitor enforces global concurrency and serializes requests per hostname", async () => {
  let globalActive = 0;
  let globalPeak = 0;
  const hostActive = new Map<string, number>();
  const hostPeak = new Map<string, number>();

  const make = (id: string, hostname: string) => probe(id, hostname, async () => {
    globalActive += 1;
    globalPeak = Math.max(globalPeak, globalActive);
    const active = (hostActive.get(hostname) || 0) + 1;
    hostActive.set(hostname, active);
    hostPeak.set(hostname, Math.max(hostPeak.get(hostname) || 0, active));
    await new Promise((resolve) => setTimeout(resolve, 10));
    hostActive.set(hostname, active - 1);
    globalActive -= 1;
    return { rawCandidates: 1, normalizedItems: 1, detailChecked: true };
  });

  await runParserMonitor({
    probes: [
      make("a", "same.example"),
      make("b", "same.example"),
      make("c", "other.example"),
      make("d", "third.example"),
    ],
    maxConcurrency: 3,
    retryDelaysMs: [],
  });

  assert.ok(globalPeak <= 3);
  assert.equal(hostPeak.get("same.example"), 1);
});

test("monitor treats stale data as a confirmed failure and fail-closes invalid or blocked responses", async () => {
  const report = await runParserMonitor({
    probes: [
      probe("stale", "stale.example", async () => ({
        rawCandidates: 2,
        normalizedItems: 2,
        detailChecked: true,
        stale: true,
      })),
      probe("invalid", "invalid.example", async () => ({
        rawCandidates: -1,
        normalizedItems: 0,
        detailChecked: false,
      })),
      probe("blocked", "blocked.example", async () => {
        throw new Error("HTTP 403 Just a moment Cloudflare challenge");
      }),
    ],
    retryDelaysMs: [],
  });

  assert.equal(report.results[0].status, "failed");
  assert.equal(report.results[0].errorClass, "stale_cache");
  assert.equal(report.results[1].errorClass, "schema_drift");
  assert.equal(report.results[2].errorClass, "cloudflare_block");
  assert.equal(report.exitCode, 1);
});

test("monitor enforces a per-attempt timeout and redacts report summaries", async () => {
  const report = await runParserMonitor({
    probes: [
      {
        id: "hung",
        source: "hung",
        hostname: "hung.example",
        required: true,
        timeoutMs: 5,
        run: async (_attempt, signal) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      },
      probe("secret", "secret.example", async () => {
        throw new Error("proxy https://alice:secret@proxy.example token=12345:ABCDEF password=hunter2");
      }),
    ],
    retryDelaysMs: [],
  });

  assert.equal(report.results[0].errorClass, "upstream_timeout");
  assert.doesNotMatch(report.results[1].summary, /alice|secret@|12345:ABCDEF|hunter2/);
});

test("a timed-out probe finishes abort cleanup before the hostname lock is released", async () => {
  let active = 0;
  let peak = 0;
  let cleanupFinished = false;
  const enter = () => {
    active += 1;
    peak = Math.max(peak, active);
  };
  const leave = () => { active -= 1; };

  const report = await runParserMonitor({
    probes: [
      {
        id: "timed-out",
        source: "timed-out",
        hostname: "locked.example",
        required: true,
        timeoutMs: 5,
        async run(_attempt, signal) {
          enter();
          try {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", async () => {
                await new Promise((resolve) => setTimeout(resolve, 15));
                cleanupFinished = true;
                reject(signal.reason);
              }, { once: true });
            });
            return { rawCandidates: 1, normalizedItems: 1, detailChecked: true };
          } finally {
            leave();
          }
        },
      },
      probe("next", "locked.example", async () => {
        assert.equal(cleanupFinished, true);
        enter();
        leave();
        return { rawCandidates: 1, normalizedItems: 1, detailChecked: true };
      }),
    ],
    maxConcurrency: 2,
    retryDelaysMs: [],
  });

  assert.equal(report.results[0].errorClass, "upstream_timeout");
  assert.equal(report.results[1].status, "healthy");
  assert.equal(peak, 1);
});

test("static monitor registry covers every tournament provider and all Liquipedia scopes", () => {
  const probes = createStaticParserProbes();
  const covered = new Set(probes.map((item) => item.source));
  assert.deepEqual(
    sourceProviders.map((provider) => provider.id).filter((id) => !covered.has(id)),
    [],
  );
  assert.deepEqual(
    probes.filter((item) => item.source === "liquipedia").map((item) => item.scope).sort(),
    ["counterstrike", "dota2", "leagueoflegends", "valorant"],
  );
  assert.ok(probes.some((item) => item.source === "khl"));
});

test("Liquipedia monitor discovery uses the fail-closed read-only portal mode", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "backend", "src", "monitoring", "parserMonitorProbes.ts"),
    "utf8",
  );
  assert.match(source, /fetchDisciplinePortal\(scope, \{ force: true, readOnly: true, failClosed: true, signal \}\)/);
});

test("parser monitor one-shot always disconnects Prisma and redacts fatal CLI errors", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts", "parser-monitor.ts"),
    "utf8",
  );
  assert.match(source, /export async function handleParserMonitorRunnerFailure/);
  assert.match(source, /\.finally\(async \(\) => \{/);
  assert.match(source, /prisma\.\$disconnect\(\)/);
  assert.match(source, /redactMonitorText\(errorMessage\(error\)\)/);
});

test("parser monitor CLI signal handlers abort once and can be removed after cleanup", () => {
  const controller = new AbortController();
  const emitter = new EventEmitter();
  const removeHandlers = installParserMonitorSignalHandlers(controller, emitter as never);

  emitter.emit("SIGTERM");

  assert.equal(controller.signal.aborted, true);
  assert.match(String(controller.signal.reason), /SIGTERM/u);
  removeHandlers();
  assert.equal(emitter.listenerCount("SIGTERM"), 0);
  assert.equal(emitter.listenerCount("SIGINT"), 0);
});

test("parser monitor service targets the runner directly and the CLI threads its global signal", () => {
  const cliSource = fs.readFileSync(path.join(process.cwd(), "scripts", "parser-monitor.ts"), "utf8");
  const coreSource = fs.readFileSync(path.join(process.cwd(), "backend", "src", "monitoring", "parserMonitorCore.ts"), "utf8");
  const serviceSource = fs.readFileSync(path.join(process.cwd(), "deploy", "systemd", "tdata-parser-monitor.service"), "utf8");
  const readmeSource = fs.readFileSync(path.join(process.cwd(), "deploy", "systemd", "README.md"), "utf8");

  assert.match(cliSource, /installParserMonitorSignalHandlers\(cliAbortController/);
  assert.match(cliSource, /main\(cliAbortController\.signal\)/);
  assert.match(cliSource, /runParserMonitor\(\{[\s\S]+?signal/);
  assert.match(coreSource, /runScheduled\([\s\S]+?options\.signal/);
  assert.match(coreSource, /runProbeAttempt\(probe, attempt, signal\)/);
  assert.match(coreSource, /sleep\(milliseconds, signal\)/);
  assert.match(
    serviceSource,
    /timeout --signal=TERM --kill-after=30s 58m \/app\/node_modules\/\.bin\/tsx \/app\/scripts\/parser-monitor\.ts/,
  );
  assert.doesNotMatch(serviceSource, /npm run monitor:parsers/);
  assert.match(readmeSource, /direct `tsx` runner/i);
});

test("production monitor adapters propagate their abort signal into child processes and fetch clients", () => {
  const probes = fs.readFileSync(
    path.join(process.cwd(), "backend", "src", "monitoring", "parserMonitorProbes.ts"),
    "utf8",
  );
  for (const expected of [
    /runHltvScript\([^\n]+\{ noCache: true, signal \}/,
    /runVlrScraper\([^\n]+\{ noCache: true, signal \}/,
    /runDltv\([^\n]+\{ noCache: true, signal \}/,
    /fetchFandomTournamentCargoEvents\(undefined, \{ signal \}\)/,
    /searchAllVolleyballWorldBeachTournaments\([^\n]+signal/,
    /new KhlApiClient\(\{ signal \}\)/,
    /adapter\.testConnection\([\s\S]+?\}, \{ signal \}\)/,
  ]) assert.match(probes, expected);

  const hltv = fs.readFileSync(
    path.join(process.cwd(), "backend", "src", "sources", "tdata", "hltv", "scraper", "execute.ts"),
    "utf8",
  );
  assert.match(hltv, /signal\?\.addEventListener\("abort", onParentAbort/);
  assert.match(hltv, /abortCleanup = forceKillChild/);

  for (const relativePath of [
    ["tdata", "vlr", "scraper.ts"],
    ["tdata", "dltv", "client.ts"],
    ["tbvolley", "VolleyballWorld", "index.ts"],
    ["tbvolley", "beach.volley.ru", "index.ts"],
    ["tbvolley", "GermanBeachTour", "index.ts"],
    ["tbvolley", "TwelveNdr", "index.ts"],
    ["tbvolley", "CBV", "index.ts"],
    ["tbvolley", "Federvolley", "index.ts"],
    ["tablet", "WTT", "index.ts"],
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), "backend", "src", "sources", ...relativePath), "utf8");
    assert.match(source, /signal\?\.addEventListener\("abort"/);
  }
  const fandom = fs.readFileSync(
    path.join(process.cwd(), "backend", "src", "sources", "tdata", "fandom", "client.ts"),
    "utf8",
  );
  assert.match(fandom, /signal: options\.signal/);
  assert.match(fandom, /signal: input\.signal/);
});

test("parser monitor CLI persists a redacted exit-2 report on argument failure and exits cleanly", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tdata-parser-monitor-cli-failure-"));
  try {
    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [
      tsxCli,
      path.join(process.cwd(), "scripts", "parser-monitor.ts"),
      `--report-dir=${directory}`,
      "--unknown=token=cli-secret",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000,
    });

    assert.equal(result.status, 2, result.stderr);
    assert.doesNotMatch(result.stderr, /cli-secret/);
    const latest = readLatestParserMonitorReport(directory);
    assert.equal(latest?.exitCode, 2);
    assert.doesNotMatch(latest?.results[0].summary || "", /cli-secret/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("HLTV semantic event results count as a checked detail without a legacy title field", () => {
  assert.equal(hltvDetailChecked({ ok: true, matches: [{ id: "1" }], validEmpty: false }), true);
  assert.equal(hltvDetailChecked({ ok: true, matches: [], validEmpty: true }), true);
  assert.equal(hltvDetailChecked({ ok: true, matches: [], validEmpty: false }), false);
});

test("KHL accepts an empty local window only after a wider semantic detail succeeds", () => {
  assert.deepEqual(buildKhlProbeObservation(3, 0, true, 4), {
    rawCandidates: 4,
    normalizedItems: 0,
    detailChecked: true,
    explicitEmpty: true,
    summary: "KHL: 3 stages, 4 raw events, 0 in local canary window",
  });
  assert.equal(buildKhlProbeObservation(3, 0, false, 4).explicitEmpty, false);
  assert.equal(buildKhlProbeObservation(3, 0, false, 0).explicitEmpty, false);
});

test("DLTV monitor reports published placeholder match pages as placeholder_404", () => {
  assert.deepEqual(buildDltvProbeFailure([
    { url: "https://ru.dltv.org/matches/example", error: "DLTV request failed with 404", errorClass: "upstream_placeholder_404" },
  ]), {
    errorClass: "placeholder_404",
    summary: "DLTV: 1 match page failed (1 upstream placeholder 404)",
  });
  assert.deepEqual(buildDltvProbeFailure([
    { url: "https://ru.dltv.org/matches/example", error: "selector missing" },
  ]), {
    errorClass: "parse_failed",
    summary: "DLTV: 1 match page failed",
  });
  assert.equal(buildDltvProbeFailure([]), null);
});

test("unknown active TLine provider is a critical coverage failure", () => {
  assert.deepEqual(findUncoveredTLineProviders(["volley-ru", "nffr-floorball"]), []);
  assert.deepEqual(findUncoveredTLineProviders(["hockey-by"]), []);
  assert.deepEqual(findUncoveredTLineProviders(["volley-ru", "new-provider"]), ["new-provider"]);
});

test("an uncovered provider is a runner configuration failure", async () => {
  const report = await runParserMonitor({
    probes: [{
      id: "uncovered:new-provider",
      source: "new-provider",
      hostname: "monitor.local",
      required: true,
      async run() {
        throw new MonitorProbeError("uncovered_provider", "missing adapter");
      },
    }],
    retryDelaysMs: [],
  });

  assert.equal(report.summary.failed, 1);
  assert.equal(report.exitCode, 2);
});

test("a runner configuration failure replaces a stale green latest report and participates in incident transitions", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tdata-parser-monitor-runner-failure-"));
  try {
    persistParserMonitorReport(sampleReport([]), { directory });
    const failed = buildParserMonitorRunnerFailureReport(
      new Error("registry token=runner-secret <b>failed</b>\u0000"),
      new Date("2026-08-30T15:02:00.000Z"),
    );
    persistParserMonitorReport(failed, { directory });

    const latest = readLatestParserMonitorReport(directory);
    assert.equal(latest?.exitCode, 2);
    assert.equal(latest?.results[0].status, "failed");
    assert.doesNotMatch(latest?.results[0].summary || "", /runner-secret|<b>|\u0000/);

    const sent: string[] = [];
    const transition = await processTelegramTransition(
      failed,
      { activeFailureFingerprint: null },
      { botToken: "unused", chatId: "unused", transport: async (text) => { sent.push(text); } },
    );
    assert.equal(transition.sent, "failure");
    assert.equal(sent.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("runner failure notification is attempted even when report volume and state persistence fail", async () => {
  const sent: string[] = [];
  const logged: string[] = [];

  const report = await handleParserMonitorRunnerFailure(
    new Error("runner token=runner-secret <b>failed</b>\u0000"),
    { notify: "telegram", reportDirectory: "Z:\\unavailable-parser-monitor-volume" },
    {
      persistReport() {
        throw new Error("report volume password=report-secret");
      },
      readNotificationState() {
        throw new Error("state volume token=state-secret");
      },
      readTelegramConfig() {
        return { botToken: "unused", chatId: "unused" };
      },
      processTransition(current, previous, options) {
        return processTelegramTransition(current, previous, {
          ...options,
          now: new Date("2026-08-30T15:03:00.000Z"),
          transport: async (text) => { sent.push(text); },
        });
      },
      persistNotificationState() {
        throw new Error("state write api_key=state-write-secret");
      },
      logError(label, message) {
        logged.push(`${label} ${message}`);
      },
    },
  );

  assert.equal(report.exitCode, 2);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /parser-monitor\/configuration/);
  assert.doesNotMatch(sent[0], /runner-secret|<b>|\u0000/);
  assert.equal(logged.length, 3);
  assert.doesNotMatch(logged.join("\n"), /report-secret|state-secret|state-write-secret/);
});

test("report persistence writes atomic latest, timestamped JSON/Markdown and prunes old reports", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tdata-parser-monitor-"));
  try {
    const old = path.join(directory, "2026-01-01T00-00-00-000Z.json");
    fs.writeFileSync(old, "{}");
    fs.utimesSync(old, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    const report = sampleReport([sampleFailure("storage", "line one\nline | two")]);

    const written = persistParserMonitorReport(report, {
      directory,
      retentionDays: 90,
      now: new Date("2026-08-30T15:00:00Z"),
    });

    assert.ok(fs.existsSync(written.jsonPath));
    assert.ok(fs.existsSync(written.markdownPath));
    assert.ok(fs.existsSync(path.join(directory, "latest.json")));
    assert.equal(fs.existsSync(old), false);
    assert.deepEqual(readLatestParserMonitorReport(directory)?.runId, report.runId);
    persistParserMonitorNotificationState({
      activeFailureFingerprint: "abc",
      lastFailureAlertAt: "2026-08-30T15:00:00Z",
      lastRecoveryAt: "2026-08-29T15:00:00Z",
    }, directory);
    const state = readParserMonitorNotificationState(directory);
    assert.equal(state.activeFailureFingerprint, "abc");
    assert.equal(state.lastFailureAlertAt, "2026-08-30T15:00:00Z");
    assert.equal(state.lastRecoveryAt, "2026-08-29T15:00:00Z");
    fs.writeFileSync(path.join(directory, "latest.json"), "not-json");
    fs.writeFileSync(path.join(directory, "state.json"), "[]");
    assert.equal(readLatestParserMonitorReport(directory), null);
    assert.equal(readParserMonitorNotificationState(directory).activeFailureFingerprint, null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Telegram delivery retries twice and succeeds on the third attempt", async () => {
  let attempts = 0;
  await sendTelegramMessage({
    botToken: "12345:ABCDEF",
    chatId: "42",
    text: "test",
    retryDelaysMs: [1, 2],
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      return new Response("{}", { status: attempts === 3 ? 200 : 503 });
    },
  });
  assert.equal(attempts, 3);
});

test("Telegram delivery falls back to an authenticated proxy after a direct network failure", async () => {
  const attempts: Array<{ proxied: boolean }> = [];
  const proxyUrlsSeen: string[] = [];

  await sendTelegramMessage({
    botToken: "12345:ABCDEF",
    chatId: "42",
    text: "test",
    proxyUrls: ["http://alice:secret@proxy.example:8080"],
    retryDelaysMs: [0],
    sleep: async () => undefined,
    proxyAgentFactory(proxyUrl) {
      proxyUrlsSeen.push(proxyUrl);
      return { kind: "test-proxy-agent" } as never;
    },
    fetchImpl: async (_url, init) => {
      const proxied = Boolean((init as RequestInit & { agent?: unknown })?.agent);
      attempts.push({ proxied });
      if (!proxied) throw new TypeError("direct network unavailable");
      return new Response("{}", { status: 200 });
    },
  });

  assert.deepEqual(attempts, [{ proxied: false }, { proxied: true }]);
  assert.deepEqual(proxyUrlsSeen, ["http://alice:secret@proxy.example:8080"]);
});

test("Telegram proxy selection deduplicates candidates and ignores selector failures", async () => {
  const proxyUrls = await selectTelegramProxyUrls(async (attempt) => {
    if (attempt === 2) throw new Error("database temporarily unavailable");
    if (attempt === 3) return { proxyId: "proxy-duplicate", proxyUrl: "http://user:password@proxy.example:8080" };
    return { proxyId: "proxy-primary", proxyUrl: "http://user:password@proxy.example:8080" };
  });

  assert.deepEqual(proxyUrls, ["http://user:password@proxy.example:8080"]);
});

test("Telegram proxy fallback ignores invalid proxy schemes and never leaks proxy credentials in errors", async () => {
  let attempts = 0;
  await assert.rejects(
    sendTelegramMessage({
      botToken: "12345:ABCDEF",
      chatId: "42",
      text: "test",
      proxyUrls: [
        "not-a-url",
        "socks5://hidden:secret@proxy.example:1080",
        "https://hidden:secret@proxy.example:8443",
      ],
      retryDelaysMs: [0],
      sleep: async () => undefined,
      fetchImpl: async () => {
        attempts += 1;
        throw new TypeError("hidden:secret should not escape");
      },
    }),
    (error: unknown) => {
      assert.match(String(error), /API is unreachable/);
      assert.doesNotMatch(String(error), /hidden|secret|proxy\.example|12345:ABCDEF/);
      return true;
    },
  );
  assert.equal(attempts, 2);
});

test("Telegram proxy selection ignores null and unsupported candidates", async () => {
  const proxyUrls = await selectTelegramProxyUrls(async (attempt) => {
    if (attempt === 1) return null;
    if (attempt === 2) return { proxyId: "proxy-socks", proxyUrl: "socks5://proxy.example:1080" };
    return { proxyId: "proxy-https", proxyUrl: "https://proxy.example:8443" };
  });

  assert.deepEqual(proxyUrls, ["https://proxy.example:8443"]);
});

test("Telegram rejects missing configuration and surfaces failure after all retries", async () => {
  await assert.rejects(
    sendTelegramMessage({ botToken: "", chatId: "42", text: "test" }),
    /required/,
  );
  await assert.rejects(
    sendTelegramMessage({
      botToken: "12345:ABCDEF",
      chatId: "42",
      text: "test",
      retryDelaysMs: [],
      fetchImpl: async () => new Response("{}", { status: 500 }),
    }),
    /HTTP 500/,
  );
});

test("explicit Telegram test notification does not mutate incident state", async () => {
  const sent: string[] = [];
  await sendTelegramTestNotification({
    botToken: "12345:ABCDEF",
    chatId: "42",
    transport: async (text) => { sent.push(text); },
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /тест/i);
});

test("Telegram sends one failure, suppresses duplicates, redacts secrets, then sends one recovery", async () => {
  const sent: string[] = [];
  const transport = async (text: string) => { sent.push(text); };
  const initial: TelegramNotificationState = { activeFailureFingerprint: null };
  const failed = sampleReport([sampleFailure("hltv", "token=12345:ABCDEF password=hunter2")]);

  const first = await processTelegramTransition(failed, initial, {
    botToken: "12345:ABCDEF",
    chatId: "42",
    transport,
  });
  const duplicate = await processTelegramTransition(failed, first.state, {
    botToken: "12345:ABCDEF",
    chatId: "42",
    transport,
  });
  const recovered = await processTelegramTransition(sampleReport([]), duplicate.state, {
    botToken: "12345:ABCDEF",
    chatId: "42",
    transport,
  });
  await processTelegramTransition(sampleReport([]), recovered.state, {
    botToken: "12345:ABCDEF",
    chatId: "42",
    transport,
  });

  assert.equal(sent.length, 2);
  assert.match(sent[0], /HLTV/i);
  assert.doesNotMatch(sent[0], /12345:ABCDEF|hunter2/);
  assert.match(sent[1], /восстанов/i);
  assert.equal(redactMonitorText("https://api.telegram.org/bot12345:ABC/getUpdates"), "[REDACTED_TELEGRAM_URL]");
});

test("monitor redaction removes credential URLs, auth headers, secret assignments, HTML and control characters", () => {
  const input = [
    "socks5://alice:hunter2@proxy.example:1080",
    "http://bob:secret@proxy.example",
    "postgresql://dbuser:db-secret@postgres:5432/tdata",
    "Authorization: Bearer abc.def-123",
    "Authorization=Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
    '"api_key": "super-secret"',
    "password='space secret'",
    "token=plain-secret",
    "<b>unsafe</b><script>alert(1)</script>",
    "control\u0000\u0007\u0085text",
  ].join("\n");
  const redacted = redactMonitorText(input);

  assert.doesNotMatch(redacted, /alice|hunter2|bob:secret|dbuser|db-secret|abc\.def|QWxh|super-secret|space secret|plain-secret|<[^>]+>|\u0000|\u0007|\u0085/);
  assert.match(redacted, /\[REDACTED_CREDENTIAL_URL\]/);
  assert.match(redacted, /Authorization=\[REDACTED\]/i);
  assert.match(redacted, /api_key=\[REDACTED\]/i);
  assert.match(redacted, /unsafe/);
});

function sampleFailure(source: string, summary: string): SourceProbeResult {
  return {
    id: source,
    source,
    scope: "scope",
    hostname: `${source}.example`,
    required: true,
    status: "failed",
    errorClass: "parse_failed",
    summary,
    rawCandidates: 0,
    normalizedItems: 0,
    detailChecked: false,
    cacheHit: false,
    stale: false,
    attempts: 1,
    durationMs: 10,
    checkedAt: "2026-08-30T15:00:00.000Z",
  };
}

function sampleReport(results: SourceProbeResult[]): ParserMonitorReport {
  const failed = results.filter((result) => result.status === "failed").length;
  return {
    schemaVersion: 1,
    runId: "2026-08-30T15-00-00-000Z",
    startedAt: "2026-08-30T15:00:00.000Z",
    finishedAt: "2026-08-30T15:01:00.000Z",
    durationMs: 60_000,
    results,
    summary: {
      total: results.length,
      healthy: results.filter((result) => result.status === "healthy").length,
      healthyEmpty: results.filter((result) => result.status === "healthy_empty").length,
      warning: results.filter((result) => result.status === "warning").length,
      failed,
    },
    exitCode: failed > 0 ? 1 : 0,
  };
}
