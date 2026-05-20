import { spawn } from "child_process";
import { prisma } from "@/lib/db/db";
import { markProxyFailure, markProxySuccess, maskProxyUrl, selectProxyCandidate } from "@/lib/proxy/proxySelector";
import {
  classifyParserError,
  isBlockedParserError,
  normalizeParserErrorClass,
  ParserErrorClass,
} from "@/lib/proxy/parserErrors";
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
  options: { noCache?: boolean } = {}
): Promise<any> {
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
    throw new Error("Прокси не настроены. Пожалуйста, добавьте прокси в Proxy Pool.");
  }

  const args = ["scripts/hltv_playwright.mjs", "--mode", mode];
  if (proxyStr) args.push("--proxy", proxyStr);
  if (options.noCache) args.push("--no-cache");
  args.push("--request-id", requestId);

  if (mode === "search" && queryOrId) {
    args.push("--q", queryOrId);
  } else if (mode === "event" && queryOrId) {
    args.push("--id", queryOrId);
  }

  console.log(`[HLTV Scraper Lib] Executing request=${requestId} proxyId=${selectedProxyId ?? "none"} mode=${mode} attempt=${attempt}/${MAX_ATTEMPTS}${direct ? " direct" : ""}: node scripts/hltv_playwright.mjs ${proxyStr ? `--proxy ${maskProxyUrl(proxyStr)} ` : ""}--mode ${mode}`);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutSettling = false;

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const settleResolve = (value: any) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      resolve(value);
      return true;
    };

    const settleReject = (error: Error) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      reject(error);
      return true;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutSettling = true;
      forceKillChild(child.pid ?? undefined);
      void handleChildTimeout();
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

      if (shouldTryDirectFallback(errorClass, direct)) {
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
        executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(resolve, reject);
        return;
      }

      return settleReject(new Error("HLTV scraper failed to start."));
    });

    child.on("close", async (code) => {
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
          executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(resolve, reject);
          return;
        }

        if (shouldTryDirectFallback(errorClass, direct)) {
          console.log(`[HLTV Scraper Lib] ${errorClass} through proxy, retrying once without proxy...`);
          executeScraper(mode, queryOrId, requestId, 1, true, options).then(resolve, reject);
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
          const errorClass = classifyHltvError(data.error || "unknown", false);
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
             executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(resolve, reject);
             return;
          }
          if (shouldTryDirectFallback(errorClass, direct)) {
            console.log(`[HLTV Scraper Lib] ${errorClass} through proxy, retrying once without proxy...`);
            executeScraper(mode, queryOrId, requestId, 1, true, options).then(resolve, reject);
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
          executeScraper(mode, queryOrId, requestId, attempt + 1, direct, options).then(resolve, reject);
          return;
        }
        
        return settleReject(new Error(`Failed to parse HLTV output after ${MAX_ATTEMPTS} attempts`));
      }
    });
  });
}

async function getHltvProxyCandidate(attempt: number): Promise<HltvProxyCandidate | null> {
  const candidate = await selectProxyCandidate(attempt);
  if (!candidate) return null;
  return { proxyStr: candidate.proxyUrl, proxyId: candidate.proxyId };
}

function getMaxAttempts(mode: HltvMode) {
  if (mode === "health") return 1;
  if (mode === "search") return Number(process.env.HLTV_SEARCH_MAX_ATTEMPTS || 1);
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

function shouldTryDirectFallback(errorClass: string, direct: boolean) {
  if (direct || !allowDirectFallback()) return false;

  const normalized = normalizeParserErrorClass(errorClass);
  return normalized === "proxy_tunnel"
    || normalized === "timeout"
    || normalized === "network_error"
    || normalized === "process_failed";
}

function forceKillChild(pid?: number) {
  if (!pid) return;

  try {
    process.kill(pid, "SIGKILL");
  } catch {}

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => {});
  }
}
