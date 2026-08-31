import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../backend/src/db/db";
import {
  buildParserMonitorRunnerFailureReport,
  runParserMonitor,
} from "../backend/src/monitoring/parserMonitorCore";
import {
  DEFAULT_PARSER_MONITOR_DIRECTORY,
  persistParserMonitorNotificationState,
  persistParserMonitorReport,
  readParserMonitorNotificationState,
} from "../backend/src/monitoring/parserMonitorPersistence";
import { createProductionParserProbes } from "../backend/src/monitoring/parserMonitorProbes";
import { redactMonitorText } from "../backend/src/monitoring/parserMonitorRedaction";
import { processTelegramTransition, sendTelegramTestNotification } from "../backend/src/monitoring/parserMonitorTelegram";

type NotifyMode = "never" | "telegram" | "test";

type Options = {
  notify: NotifyMode;
  reportDirectory: string;
  maxConcurrency: number;
  retryDelaysMs: number[];
};

type RunnerFailureDependencies = {
  persistReport?: typeof persistParserMonitorReport;
  readNotificationState?: typeof readParserMonitorNotificationState;
  processTransition?: typeof processTelegramTransition;
  persistNotificationState?: typeof persistParserMonitorNotificationState;
  readTelegramConfig?: typeof readTelegramConfiguration;
  logError?: (label: string, message: string) => void;
};

type ParserMonitorSignalTarget = {
  once(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  removeListener(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
};

let activeOptions: Options | null = null;
let databaseMayBeInitialized = false;

async function main(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const options = parseArgs(process.argv.slice(2));
  activeOptions = options;
  if (options.notify === "test") {
    const telegram = readTelegramConfiguration();
    await sendTelegramTestNotification(telegram);
    console.log(JSON.stringify({ ok: true, notification: "test-sent" }));
    return;
  }
  databaseMayBeInitialized = true;
  const probes = await createProductionParserProbes();
  signal?.throwIfAborted();
  const report = await runParserMonitor({
    probes,
    maxConcurrency: options.maxConcurrency,
    retryDelaysMs: options.retryDelaysMs,
    signal,
  });
  signal?.throwIfAborted();
  const files = persistParserMonitorReport(report, { directory: options.reportDirectory, retentionDays: 90 });

  if (options.notify === "telegram") {
    const { botToken, chatId } = readTelegramConfiguration();
    const previous = readParserMonitorNotificationState(options.reportDirectory);
    const transition = await processTelegramTransition(report, previous, { botToken, chatId });
    persistParserMonitorNotificationState(transition.state, options.reportDirectory);
  }

  console.log(JSON.stringify({
    ok: report.exitCode === 0,
    runId: report.runId,
    summary: report.summary,
    report: files.latestPath,
  }));
  process.exitCode = report.exitCode;
}

function parseArgs(values: readonly string[]): Options {
  const options: Options = {
    notify: "never",
    reportDirectory: DEFAULT_PARSER_MONITOR_DIRECTORY,
    maxConcurrency: 3,
    retryDelaysMs: [30_000, 120_000],
  };
  // Keep the last safely parsed destination/notification mode available so
  // even an argument/configuration failure can replace a stale green report.
  activeOptions = options;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const [flag, inline] = value.split("=", 2);
    const next = inline ?? values[index + 1];
    if (flag === "--notify" && next) {
      if (next !== "never" && next !== "telegram" && next !== "test") throw new ConfigurationError(`Unsupported --notify value: ${next}`);
      options.notify = next;
      if (inline === undefined) index += 1;
    } else if (flag === "--report-dir" && next) {
      options.reportDirectory = path.resolve(next);
      if (inline === undefined) index += 1;
    } else if (flag === "--max-concurrency" && next) {
      options.maxConcurrency = Math.min(3, Math.max(1, parsePositiveInteger(next, flag)));
      if (inline === undefined) index += 1;
    } else if (flag === "--retry-delays-ms" && next) {
      options.retryDelaysMs = next === "none"
        ? []
        : next.split(",").map((item) => parseNonNegativeInteger(item, flag));
      if (inline === undefined) index += 1;
    } else if (value === "--help" || value === "-h") {
      console.log("Usage: npm run monitor:parsers -- [--notify=never|telegram|test] [--report-dir=PATH] [--max-concurrency=1..3] [--retry-delays-ms=30000,120000]");
      process.exit(0);
    } else {
      throw new ConfigurationError(`Unknown parser monitor argument: ${value}`);
    }
  }
  return options;
}

class ConfigurationError extends Error {}

export function installParserMonitorSignalHandlers(
  controller: AbortController,
  target: ParserMonitorSignalTarget = process as unknown as ParserMonitorSignalTarget,
) {
  const abortForSignal = (signalName: "SIGTERM" | "SIGINT") => {
    if (controller.signal.aborted) return;
    const error = new Error(`Parser monitor received ${signalName}`) as Error & {
      signalName?: "SIGTERM" | "SIGINT";
    };
    error.name = "AbortError";
    error.signalName = signalName;
    controller.abort(error);
  };
  const onSigterm = () => abortForSignal("SIGTERM");
  const onSigint = () => abortForSignal("SIGINT");
  target.once("SIGTERM", onSigterm);
  target.once("SIGINT", onSigint);
  return () => {
    target.removeListener("SIGTERM", onSigterm);
    target.removeListener("SIGINT", onSigint);
  };
}

function readTelegramConfiguration() {
  const botToken = process.env.TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN?.trim() || "";
  const chatId = process.env.TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID?.trim() || "";
  if (!botToken || !chatId) throw new ConfigurationError(
    "Telegram notifications require TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN and TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID",
  );
  return { botToken, chatId };
}

function parsePositiveInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ConfigurationError(`${flag} requires a positive integer`);
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new ConfigurationError(`${flag} requires non-negative integer delays`);
  return parsed;
}

export async function handleParserMonitorRunnerFailure(
  error: unknown,
  options: Pick<Options, "notify" | "reportDirectory">,
  dependencies: RunnerFailureDependencies = {},
) {
  const report = buildParserMonitorRunnerFailureReport(error);
  const logError = dependencies.logError
    ?? ((label: string, message: string) => console.error(label, message));

  try {
    (dependencies.persistReport ?? persistParserMonitorReport)(report, {
      directory: options.reportDirectory,
      retentionDays: 90,
    });
  } catch (persistenceError) {
    logError(
      "Parser monitor could not persist its runner failure:",
      redactMonitorText(errorMessage(persistenceError)),
    );
  }

  if (options.notify === "telegram") {
    const readNotificationState = dependencies.readNotificationState
      ?? readParserMonitorNotificationState;
    let previous: ReturnType<typeof readParserMonitorNotificationState> = {
      activeFailureFingerprint: null,
    };
    try {
      previous = readNotificationState(options.reportDirectory);
    } catch (stateReadError) {
      logError(
        "Parser monitor could not read notification state; treating this as a new incident:",
        redactMonitorText(errorMessage(stateReadError)),
      );
    }

    try {
      const { botToken, chatId } = (dependencies.readTelegramConfig ?? readTelegramConfiguration)();
      const transition = await (dependencies.processTransition ?? processTelegramTransition)(
        report,
        previous,
        { botToken, chatId },
      );
      (dependencies.persistNotificationState ?? persistParserMonitorNotificationState)(
        transition.state,
        options.reportDirectory,
      );
    } catch (notificationError) {
      logError(
        "Parser monitor could not notify its runner failure:",
        redactMonitorText(errorMessage(notificationError)),
      );
    }
  }

  return report;
}

if (isDirectExecution()) {
  const cliAbortController = new AbortController();
  const removeSignalHandlers = installParserMonitorSignalHandlers(cliAbortController);
  main(cliAbortController.signal).catch(async (error) => {
    const interrupted = cliAbortController.signal.aborted;
    const configurationError = error instanceof ConfigurationError;
    const options = activeOptions ?? {
      notify: "never" as const,
      reportDirectory: DEFAULT_PARSER_MONITOR_DIRECTORY,
      maxConcurrency: 3,
      retryDelaysMs: [30_000, 120_000],
    };
    if (!interrupted) await handleParserMonitorRunnerFailure(error, options);
    console.error(
      interrupted
        ? "Parser monitor interrupted:"
        : configurationError
          ? "Parser monitor configuration error:"
          : "Parser monitor failed:",
      redactMonitorText(errorMessage(error)),
    );
    process.exitCode = interrupted
      ? parserMonitorSignalExitCode(cliAbortController.signal.reason)
      : 2;
  }).finally(async () => {
    try {
      if (!databaseMayBeInitialized) return;
      await prisma.$disconnect().catch((error) => {
        console.error("Parser monitor database disconnect failed:", redactMonitorText(errorMessage(error)));
        process.exitCode = 2;
      });
    } finally {
      removeSignalHandlers();
    }
  });
}

function parserMonitorSignalExitCode(reason: unknown) {
  return reason instanceof Error
    && (reason as Error & { signalName?: string }).signalName === "SIGINT"
    ? 130
    : 143;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  const modulePath = path.resolve(fileURLToPath(import.meta.url));
  const entryPath = path.resolve(process.argv[1]);
  return process.platform === "win32"
    ? modulePath.toLowerCase() === entryPath.toLowerCase()
    : modulePath === entryPath;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown parser monitor failure");
}
