import { spawn } from "child_process";
import { prisma } from "@backend/db/db";
import { markProxyFailure, markProxySuccess, maskProxyUrl, selectProxyCandidate } from "@backend/proxy/proxySelector";
import {
  classifyParserError,
  isBlockedParserError,
  normalizeParserErrorClass,
  ParserErrorClass,
} from "@backend/proxy/parserErrors";
import { HltvMode } from "../scraper";
import {
  classifyHltvEmptyResult,
  logParserRequest,
  pickHltvErrorLine,
  readRelatedHltvSearchCache,
} from "./helpers";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

type HltvProxyCandidate = {
  proxyStr: string;
  proxyId: string | null;
};

export async function executeScraper(
  mode: HltvMode,
  queryOrId?: string,
  requestId = "hltv",
  attempt = 1,
  direct = false,
  options: { noCache?: boolean; signal?: AbortSignal } = {}
): Promise<any> {
  options.signal?.throwIfAborted();
  const MAX_ATTEMPTS = getMaxAttempts(mode);
  let proxyStr = "";
  let selectedProxyId: string | null = null;
  const startedAt = Date.now();

  if (!direct) {
    const candidate = await getHltvProxyCandidate(attempt);
    if (candidate) {
      proxyStr = candidate.proxyStr;
      selectedProxyId = candidate.proxyId;
      if (selectedProxyId) {
        await prisma.proxyPool.update({
          where: { id: selectedProxyId },
          data: { lastUsed: new Date() }
        }).catch(() => {});
      }
    }
  }

  if (!proxyStr && !direct) {
    if (shouldTryHltvDirectFallback("proxy_missing", false)) {
      console.log("[HLTV Scraper Lib] Proxy pool is unavailable, retrying once without proxy...");
      return executeScraper(mode, queryOrId, requestId, 1, true, options);
    }
    throw new Error("Прокси не настроены. Пожалуйста, добавьте прокси в Proxy Pool.");
  }

  const args = ["scripts/hltv_playwright.mjs", "--mode", mode];
  if (options.noCache) args.push("--no-cache");
  args.push("--request-id", requestId);

  if (mode === "search" && queryOrId) {
    args.push("--q", queryOrId);
  } else if (mode === "event" && queryOrId) {
    const eventId = queryOrId.match(/\/events\/(\d+)(?:\/|$)/)?.[1] || queryOrId;
    args.push("--id", eventId);
    if (/^https?:\/\/(?:www\.)?hltv\.org\/events\//i.test(queryOrId)) args.push("--url", queryOrId);
  }

  console.log(`[HLTV Scraper Lib] Executing request=${requestId} proxyId=${selectedProxyId ?? "none"} proxy=${proxyStr ? maskProxyUrl(proxyStr) : "none"} mode=${mode} attempt=${attempt}/${MAX_ATTEMPTS}${direct ? " direct" : ""}`);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutSettling = false;
    let aborted = false;
    let abortCleanup = Promise.resolve();

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: buildHltvChildEnvironment(proxyStr),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const settleResolve = (value: any) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onParentAbort);
      resolve(value);
      return true;
    };

    const settleReject = (error: Error) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onParentAbort);
      reject(error);
      return true;
    };

    const abortError = () => options.signal?.reason instanceof Error
      ? options.signal.reason
      : new Error("HLTV monitor request was aborted");
    const onParentAbort = () => {
      if (settled || aborted) return;
      aborted = true;
      timeoutSettling = true;
      abortCleanup = forceKillChild(child.pid ?? undefined);
    };
    options.signal?.addEventListener("abort", onParentAbort, { once: true });
    if (options.signal?.aborted) onParentAbort();

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutSettling = true;
      void (async () => {
        await forceKillChild(child.pid ?? undefined);
        await handleChildTimeout();
      })();
    }, getTimeoutMs(mode));

    const handleChildTimeout = async () => {
      const errorClass = classifyHltvError("HLTV request timed out. Proxy might be too slow.", true);
      const durationMs = Date.now() - startedAt;

      await markProxyFailure(selectedProxyId, {
        errorClass,
        errorMessage: "HLTV request timed out. Proxy might be too slow.",
        durationMs,
      });
      await logParserRequest({
        source: "hltv",
        mode,
        proxyId: selectedProxyId,
        attempt,
        errorClass,
        durationMs,
        bytesIn: stdout.length + stderr.length,
      });

      if (shouldTryHltvDirectFallback(errorClass, direct)) {
        console.log(`[HLTV Scraper Lib] ${errorClass} through proxy, retrying once without proxy...`);
        executeScraper(mode, queryOrId, requestId, 1, true, options).then(settleResolve, settleReject);
        return;
      }

      const relatedCache = mode === "search" ? readRelatedHltvSearchCache(queryOrId) : null;
      if (relatedCache) {
        console.log(`[HLTV Scraper Lib] Returning related HLTV search cache after timeout.`);
        settleResolve({
          ok: true,
          events: relatedCache.events,
          cacheHit: true,
          cacheLayer: "file-related",
          stale: true,
          warning: "HLTV upstream timed out, returned related cache.",
        });
        return;
      }

      const finalError = new Error("HLTV request timed out. Proxy might be too slow.") as Error & { errorClass?: string };
      finalError.errorClass = errorClass;
      settleReject(finalError);
    };

    const appendCapped = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString("utf8");
      return next.length > MAX_OUTPUT_BYTES ? next.slice(-MAX_OUTPUT_BYTES) : next;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk);
    });

    child.on("error", async (error) => {
      if (aborted) {
        if (!child.pid) settleReject(abortError());
        return;
      }
      if (settled || timeoutSettling) return;
      clearTimeout(timer);
      console.error(`[HLTV Scraper Lib] Spawn error on attempt ${attempt}: ${error.message}`);
      const durationMs = Date.now() - startedAt;
      await markProxyFailure(selectedProxyId, {
        errorClass: "process_failed",
        errorMessage: error.message,
        durationMs,
      });
      await logParserRequest({
        source: "hltv",
        mode,
        proxyId: selectedProxyId,
        attempt,
        errorClass: "process_failed",
        durationMs,
      });

      if (attempt < MAX_ATTEMPTS) {
        console.log(`[HLTV Scraper Lib] Retrying in 2 seconds...`);
        await new Promise(r => setTimeout(r, 2000));
        executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(settleResolve, settleReject);
        return;
      }

      return settleReject(new Error("HLTV scraper failed to start."));
    });

    child.on("close", async (code) => {
      if (aborted) {
        await abortCleanup;
        timeoutSettling = false;
        settleReject(abortError());
        return;
      }
      if (settled || timeoutSettling) return;
      clearTimeout(timer);
      if (code !== 0 || timedOut) {
        const errorMessage = pickHltvErrorLine(stderr, stdout) || "Unknown scraper failure";
        const errorClass = classifyHltvError(errorMessage, timedOut);
        const durationMs = Date.now() - startedAt;
        console.error(`[HLTV Scraper Lib] Process failed request=${requestId} proxyId=${selectedProxyId ?? "none"} mode=${mode} attempt=${attempt} class=${errorClass}: ${errorMessage}`);
        
        await markProxyFailure(selectedProxyId, {
          errorClass,
          errorMessage,
          durationMs,
          blocked: isBlockedParserError(errorClass),
        });
        await logParserRequest({
          source: "hltv",
          mode,
          proxyId: selectedProxyId,
          attempt,
          errorClass,
          durationMs,
          bytesIn: stdout.length + stderr.length,
        });

        if (shouldRetry(mode, errorClass, attempt, MAX_ATTEMPTS)) {
          console.log(`[HLTV Scraper Lib] Retrying in 2 seconds...`);
          await new Promise(r => setTimeout(r, 2000));
          executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(settleResolve, settleReject);
          return;
        }

        if (shouldTryHltvDirectFallback(errorClass, direct)) {
          console.log(`[HLTV Scraper Lib] ${errorClass} through proxy, retrying once without proxy...`);
          executeScraper(mode, queryOrId, requestId, 1, true, options).then(settleResolve, settleReject);
          return;
        }

        const relatedCache = mode === "search" ? readRelatedHltvSearchCache(queryOrId) : null;
        if (relatedCache) {
          console.log(`[HLTV Scraper Lib] Returning related HLTV search cache after ${errorClass}.`);
          settleResolve({
            ok: true,
            events: relatedCache.events,
            cacheHit: true,
            cacheLayer: "file-related",
            stale: true,
            warning: `HLTV upstream failed (${errorClass}), returned related cache.`,
          });
          return;
        }
        
        const finalError = new Error(timedOut ? "HLTV request timed out. Proxy might be too slow." : "HLTV scraper failed. Proxy might be blocked.") as Error & { errorClass?: string };
        finalError.errorClass = errorClass;
        return settleReject(finalError);
      }

      try {
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const data = JSON.parse(lastLine);
        
        if (data.ok) {
          const durationMs = Date.now() - startedAt;
          const matchesCount = Array.isArray(data.matches) ? data.matches.length : null;
          const eventsCount = Array.isArray(data.events) ? data.events.length : null;
          const emptyErrorClass = classifyHltvEmptyResult(mode, data, matchesCount, eventsCount);
          const staleErrorClass = data.stale && data.warning
            ? classifyHltvError(data.warning, false)
            : null;
          if (emptyErrorClass && emptyErrorClass !== "empty_valid") {
            const errorMessage = emptyErrorClass === "selector_changed"
              ? `HLTV ${mode} selector validation failed: source returned an unexplained empty result.`
              : `HLTV ${mode} parse failed: source returned an unexplained empty result.`;
            await markProxyFailure(selectedProxyId, {
              errorClass: emptyErrorClass,
              errorMessage,
              durationMs,
            });
            await logParserRequest({
              source: "hltv",
              mode,
              proxyId: selectedProxyId,
              attempt,
              durationMs,
              bytesIn: stdout.length + stderr.length,
              cacheHit: !!data.cacheHit,
              cacheLayer: data.cacheLayer || (data.cacheHit ? "file" : null),
              errorClass: emptyErrorClass,
              matchesCount,
              eventsCount,
            });

            if (shouldRetry(mode, emptyErrorClass, attempt, MAX_ATTEMPTS)) {
              await new Promise(r => setTimeout(r, 2000));
              executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(settleResolve, settleReject);
              return;
            }

            const semanticError = new Error(errorMessage) as Error & { errorClass?: string };
            semanticError.errorClass = emptyErrorClass;
            settleReject(semanticError);
            return;
          }
          if (staleErrorClass) {
            await markProxyFailure(selectedProxyId, {
              errorClass: staleErrorClass,
              errorMessage: data.warning,
              durationMs,
              blocked: isBlockedParserError(staleErrorClass),
            });
          } else {
            await markProxySuccess(selectedProxyId, durationMs);
          }
          await logParserRequest({
            source: "hltv",
            mode,
            proxyId: selectedProxyId,
            attempt,
            durationMs,
            bytesIn: stdout.length + stderr.length,
            cacheHit: !!data.cacheHit,
            cacheLayer: data.cacheLayer || (data.cacheHit ? "file" : null),
            errorClass: staleErrorClass || emptyErrorClass,
            matchesCount,
            eventsCount,
          });
          settleResolve(data);
        } else {
          const errorClass = data.errorClass
            ? normalizeParserErrorClass(data.errorClass)
            : classifyHltvError(data.error || "unknown", false);
          const durationMs = Date.now() - startedAt;
          await markProxyFailure(selectedProxyId, {
            errorClass,
            errorMessage: data.error || "unknown",
            durationMs,
            blocked: isBlockedParserError(errorClass),
          });
          await logParserRequest({
            source: "hltv",
            mode,
            proxyId: selectedProxyId,
            attempt,
            errorClass,
            durationMs,
            bytesIn: stdout.length + stderr.length,
          });

          if (shouldRetry(mode, errorClass, attempt, MAX_ATTEMPTS)) {
             console.log(`[HLTV Scraper Lib] Soft error on attempt ${attempt}: ${data.error}. Retrying...`);
             await new Promise(r => setTimeout(r, 2000));
             executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(settleResolve, settleReject);
             return;
          }
          if (shouldTryHltvDirectFallback(errorClass, direct)) {
            console.log(`[HLTV Scraper Lib] ${errorClass} through proxy, retrying once without proxy...`);
            executeScraper(mode, queryOrId, requestId, 1, true, options).then(settleResolve, settleReject);
            return;
          }
          const relatedCache = mode === "search" ? readRelatedHltvSearchCache(queryOrId) : null;
          if (relatedCache) {
            console.log(`[HLTV Scraper Lib] Returning related HLTV search cache after ${errorClass}.`);
            settleResolve({
              ok: true,
              events: relatedCache.events,
              cacheHit: true,
              cacheLayer: "file-related",
              stale: true,
              warning: `HLTV upstream failed (${errorClass}), returned related cache.`,
            });
            return;
          }
          const finalError = new Error(data.error || "Unknown scraper error") as Error & { errorClass?: string };
          finalError.errorClass = errorClass;
          return settleReject(finalError);
        }
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        console.error(`[HLTV Scraper Lib] Parse error. Stdout: ${stdout}`);
        await markProxyFailure(selectedProxyId, {
          errorClass: "parse_failed",
          errorMessage: e instanceof Error ? e.message : "Failed to parse scraper output",
          durationMs,
        });
        await logParserRequest({
          source: "hltv",
          mode,
          proxyId: selectedProxyId,
          attempt,
          errorClass: "parse_failed",
          durationMs,
          bytesIn: stdout.length + stderr.length,
        });
        
        if (attempt < Math.min(MAX_ATTEMPTS, 2)) {
          console.log(`[HLTV Scraper Lib] Parse error on attempt ${attempt}. Retrying...`);
          await new Promise(r => setTimeout(r, 2000));
          executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(settleResolve, settleReject);
          return;
        }
        
        return settleReject(new Error(`Failed to parse HLTV output after ${MAX_ATTEMPTS} attempts`));
      }
    });
  });
}

const HLTV_CHILD_ENV_ALLOWLIST = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "PLAYWRIGHT_BROWSERS_PATH",
  "HLTV_SEARCH_RESULT_WAIT_MS",
  "HLTV_EVENTS_FUTURE_WINDOW_DAYS",
  "HLTV_SEARCH_FUTURE_WINDOW_DAYS",
  "HLTV_SEARCH_ENRICH",
  "HLTV_SEARCH_TOP_RESULTS",
  "HLTV_SEARCH_MAX_EVENTS",
] as const;

export function buildHltvChildEnvironment(proxyUrl: string): NodeJS.ProcessEnv {
  const env = HLTV_CHILD_ENV_ALLOWLIST.reduce<NodeJS.ProcessEnv>(
    (current, key) => typeof process.env[key] === "string"
      ? { ...current, [key]: process.env[key] }
      : current,
    { NODE_ENV: process.env.NODE_ENV || "production" },
  );
  return proxyUrl ? { ...env, HLTV_PLAYWRIGHT_PROXY: proxyUrl } : env;
}

async function getHltvProxyCandidate(attempt: number): Promise<HltvProxyCandidate | null> {
  const candidate = await selectProxyCandidate(attempt);
  if (!candidate) return null;
  return { proxyStr: candidate.proxyUrl, proxyId: candidate.proxyId };
}

function getMaxAttempts(mode: HltvMode) {
  if (mode === "health") return 1;
  if (mode === "search") return Number(process.env.HLTV_SEARCH_MAX_ATTEMPTS || 2);
  if (mode === "events" || mode === "scrape") return 2;
  return 3;
}

function getTimeoutMs(mode: HltvMode) {
  if (mode === "health") return 30000;
  if (mode === "search") return Number(process.env.HLTV_SEARCH_TIMEOUT_MS || 30000);
  if (mode === "events" || mode === "scrape") return 90000;
  return 120000;
}

export function classifyHltvError(message: string, timedOut: boolean): ParserErrorClass {
  return classifyParserError({ message, timedOut });
}

function shouldRetry(mode: HltvMode, errorClass: string, attempt: number, maxAttempts: number) {
  if (attempt >= maxAttempts) return false;
  if (mode === "health") return false;
  const normalized = normalizeParserErrorClass(errorClass);

  if (normalized === "empty_valid") return false;
  if (normalized === "selector_changed" || normalized === "source_4xx" || normalized === "proxy_missing") return false;
  if (normalized === "cloudflare_block" || normalized === "parse_failed") return attempt < Math.min(maxAttempts, 2);
  return normalized !== "unknown" || attempt < 2;
}

function allowDirectFallback() {
  return process.env.HLTV_ALLOW_DIRECT_FALLBACK !== "0";
}

export function shouldTryHltvDirectFallback(
  errorClass: string,
  direct: boolean,
  enabled = allowDirectFallback(),
) {
  if (direct || !enabled) return false;

  const normalized = normalizeParserErrorClass(errorClass);
  return normalized === "cloudflare_block"
    || normalized === "proxy_missing"
    || normalized === "proxy_tunnel"
    || normalized === "timeout"
    || normalized === "network_error"
    || normalized === "process_failed";
}

type ForceKillChildDependencies = {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  killWindowsTree?: (pid: number) => Promise<void>;
};

function isSafeChildPid(pid: number | undefined): pid is number {
  return typeof pid === "number"
    && Number.isSafeInteger(pid)
    && pid > 1
    && pid !== process.pid;
}

async function killWindowsChildTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function forceKillChild(
  pid?: number,
  dependencies: ForceKillChildDependencies = {},
): Promise<void> {
  if (!isSafeChildPid(pid)) return;

  const platform = dependencies.platform ?? process.platform;
  const kill = dependencies.kill ?? ((targetPid: number, signal: NodeJS.Signals) => {
    process.kill(targetPid, signal);
  });

  if (platform === "win32") {
    try {
      kill(pid, "SIGKILL");
    } catch {}
    await (dependencies.killWindowsTree ?? killWindowsChildTree)(pid);
    return;
  }

  try {
    // The Unix scraper is spawned detached, making its PID the process-group ID
    // inherited by Playwright and Chromium descendants.
    kill(-pid, "SIGKILL");
  } catch {
    // If the group already disappeared, still terminate a surviving direct child.
    try {
      kill(pid, "SIGKILL");
    } catch {}
  }
}
