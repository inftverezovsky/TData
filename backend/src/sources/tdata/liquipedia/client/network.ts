import { getLiquipediaUserAgent } from "@backend/config/env";
import { prisma } from "@backend/db/db";
import { registerLiquipediaBackoff, withGenericRateLimit, withParseRateLimit } from "@backend/sources/tdata/liquipedia/rateLimiter";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { markProxyFailure, markProxySuccess, maskProxyUrl, selectProxyCandidate } from "@backend/proxy/proxySelector";
import { classifyParserError, shouldCooldownProxyForError } from "@backend/proxy/parserErrors";
import crypto from "crypto";
import nodeFetch from "node-fetch";
import { ApiRequestOptions } from "./types";
import type { ParserErrorClass } from "@backend/proxy/parserErrors";

export const LIQUIPEDIA_API_TIMEOUT_MS = Number(process.env.LIQUIPEDIA_API_TIMEOUT_MS || 40000);
export const LIQUIPEDIA_API_MAX_RETRIES = Number(process.env.LIQUIPEDIA_API_MAX_RETRIES || 1);
export const LIQUIPEDIA_DIRECT_FALLBACK_ENABLED = process.env.LIQUIPEDIA_DIRECT_FALLBACK_ENABLED !== "0";

export class LiquipediaRequestError extends Error {
  errorClass: ParserErrorClass;
  statusCode?: number;

  constructor(message: string, params: { errorClass: ParserErrorClass; statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = "LiquipediaRequestError";
    this.errorClass = params.errorClass;
    this.statusCode = params.statusCode;
    this.cause = params.cause;
  }
}

export async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LIQUIPEDIA_API_TIMEOUT_MS);
  const fetchOptions: any = {
    method: "GET",
    headers: {
      "User-Agent": getLiquipediaUserAgent(),
      "Accept-Encoding": "gzip",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    },
    signal: controller.signal
  };

  const proxy = await selectProxyCandidate();
  const startedAt = Date.now();
  if (proxy?.proxyUrl) {
    fetchOptions.agent = proxy.proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxy.proxyUrl) : new HttpsProxyAgent(proxy.proxyUrl);
  }

  const response = await nodeFetch(url, fetchOptions as any)
    .catch(async (error) => {
      const errorClass = classifyParserError({ message: error instanceof Error ? error.message : String(error) });
      await markProxyFailure(proxy?.proxyId || null, {
        errorClass,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    })
    .finally(() => clearTimeout(timeoutId));
  if (!response.ok) {
    const errorClass = classifyParserError({ statusCode: response.status, message: `Failed to fetch HTML ${response.status}` });
    if (shouldCooldownProxyForError(errorClass)) {
      await markProxyFailure(proxy?.proxyId || null, {
        errorClass,
        errorMessage: `Liquipedia HTML request failed with ${response.status} (${errorClass})`,
        durationMs: Date.now() - startedAt,
        blocked: errorClass === "cloudflare_block",
      });
    }
    if (response.status === 403 || response.status === 424) {
      const htmlFromApi = await fetchHtmlViaMediaWikiApi(url).catch(() => "");
      if (htmlFromApi) return htmlFromApi;
    }
    throw new LiquipediaRequestError(
      `Liquipedia HTML request failed with ${response.status} (${errorClass})`,
      { errorClass, statusCode: response.status }
    );
  }
  await markProxySuccess(proxy?.proxyId || null, Date.now() - startedAt);
  return response.text();
}

export async function apiRequest<T>(
  apiUrl: string,
  params: Record<string, string>,
  isParse = false,
  retryCount = 0,
  options: ApiRequestOptions = {}
): Promise<T> {
  // Select proxy BEFORE rate limiting so each proxy gets its own rate limit channel
  const proxy = await selectProxyCandidate(retryCount + 1);
  const proxyKey = proxy?.proxyId || "direct";

  const execute = async () => {
    const timeoutMs = options.timeoutMs ?? LIQUIPEDIA_API_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? LIQUIPEDIA_API_MAX_RETRIES;
    const requestMode = options.mode ?? (isParse ? "parse" : "api");
    const url = new URL(apiUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    console.log(`[Liquipedia API Request] URL: ${url.toString()}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions: any = {
      method: "GET",
      headers: {
        "User-Agent": getLiquipediaUserAgent(),
        "Accept": "application/json, application/mediawiki+json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache"
      },
      signal: controller.signal
    };

    if (!proxy?.proxyUrl && !LIQUIPEDIA_DIRECT_FALLBACK_ENABLED) {
      throw new Error("Прокси не настроены. Пожалуйста, добавьте прокси в Proxy Pool.");
    }

    if (proxy?.proxyUrl) {
      fetchOptions.agent = proxy.proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxy.proxyUrl) : new HttpsProxyAgent(proxy.proxyUrl);
      console.log(`[Liquipedia API] Using Proxy from Pool: ${maskProxyUrl(proxy.proxyUrl)}`);
    } else {
      console.log("[Liquipedia API] Using direct connection; no active proxy is available.");
    }

    let response;
    let activeProxyId = proxy?.proxyId ?? null;
    let startedAt = Date.now();
    let recoveredWithDirectFallback = false;
    try {
      response = await nodeFetch(url.toString(), fetchOptions as any).finally(() => clearTimeout(timeoutId));
    } catch (e: any) {
      const durationMs = Date.now() - startedAt;
      const errorClass = classifyParserError({ message: e.message });
      await markProxyFailure(activeProxyId, {
        errorClass,
        errorMessage: e.message,
        durationMs,
      });
      await logLiquipediaRequest({
        mode: requestMode,
        proxyId: activeProxyId,
        errorClass,
        durationMs,
        queryHash: hashQuery(url.toString()),
      });
      if (LIQUIPEDIA_DIRECT_FALLBACK_ENABLED && activeProxyId) {
        console.warn(`[Liquipedia API] Proxy failed with ${errorClass}; trying direct fallback.`);
        const directController = new AbortController();
        const directTimeoutId = setTimeout(() => directController.abort(), timeoutMs);
        const directFetchOptions = {
          ...fetchOptions,
          headers: {
            "User-Agent": getLiquipediaUserAgent(),
            Accept: "application/json, application/mediawiki+json;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
          },
          signal: directController.signal,
        };
        delete directFetchOptions.agent;
        activeProxyId = null;
        startedAt = Date.now();
        try {
          response = await nodeFetch(url.toString(), directFetchOptions as any).finally(() => clearTimeout(directTimeoutId));
          recoveredWithDirectFallback = true;
        } catch (directError: any) {
          const directDurationMs = Date.now() - startedAt;
          const directErrorClass = classifyParserError({ message: directError.message });
          await logLiquipediaRequest({
            mode: requestMode,
            proxyId: null,
            errorClass: directErrorClass,
            durationMs: directDurationMs,
            queryHash: hashQuery(url.toString()),
          });
          if (retryCount < maxRetries) {
            console.log(`[Liquipedia API] Direct fallback failed, rotating proxy and retrying (Attempt ${retryCount + 1})...`);
            return apiRequest<T>(apiUrl, params, isParse, retryCount + 1, options);
          }
          throw directError;
        }
      } else if (retryCount < maxRetries) {
        console.log(`[Liquipedia API] Network error, rotating proxy and retrying (Attempt ${retryCount + 1})...`);
        return apiRequest<T>(apiUrl, params, isParse, retryCount + 1, options);
      }
      if (!recoveredWithDirectFallback) {
        throw e;
      }
    }

    if (!response) {
      throw new Error("Liquipedia API request failed without a response");
    }

    if (response.status === 424 || response.status === 403) {
      const durationMs = Date.now() - startedAt;
      const errorClass = classifyParserError({ statusCode: response.status, message: `Liquipedia blocked with ${response.status}` });
      registerLiquipediaBackoff(proxyKey, errorClass, response.headers.get("retry-after"), isParse ? "parse" : "generic");
      await markProxyFailure(activeProxyId, {
        errorClass,
        errorMessage: `Liquipedia blocked with ${response.status}`,
        durationMs,
        blocked: true,
      });
      await logLiquipediaRequest({
        mode: requestMode,
        proxyId: activeProxyId,
        statusCode: response.status,
        errorClass,
        durationMs,
        queryHash: hashQuery(url.toString()),
      });
      if (retryCount < maxRetries) {
        console.log(`[Liquipedia API] Blocked (${response.status}), rotating proxy and retrying (Attempt ${retryCount + 1})...`);
        return apiRequest<T>(apiUrl, params, isParse, retryCount + 1, options);
      }
    }

    const contentType = response.headers.get("content-type") || "";
    console.log(`[Liquipedia API Response] Status: ${response.status}, Content-Type: ${contentType}`);

    if (!response.ok) {
      const text = await response.text();
      const errorClass = classifyParserError({ statusCode: response.status, message: text });
      console.log(`[Liquipedia API Error Body] ${text.slice(0, 500)}`);
      registerLiquipediaBackoff(proxyKey, errorClass, response.headers.get("retry-after"), isParse ? "parse" : "generic");
      if (shouldCooldownProxyForError(errorClass)) {
        await markProxyFailure(activeProxyId, {
          errorClass,
          errorMessage: `Liquipedia API request failed with ${response.status} (${errorClass})`,
          durationMs: Date.now() - startedAt,
          blocked: errorClass === "cloudflare_block",
        });
      }
      await logLiquipediaRequest({
        mode: requestMode,
        proxyId: activeProxyId,
        statusCode: response.status,
        errorClass,
        durationMs: Date.now() - startedAt,
        bytesIn: text.length,
        queryHash: hashQuery(url.toString()),
      });
      throw new LiquipediaRequestError(
        `Liquipedia API request failed with ${response.status} (${errorClass})`,
        { errorClass, statusCode: response.status }
      );
    }

    if (!contentType.includes("application/json") && !contentType.includes("application/mediawiki+json")) {
      const text = await response.text();
      const errorClass = classifyParserError({
        statusCode: response.status,
        message: `non-json response ${text.slice(0, 500)}`,
      });
      console.log(`[Liquipedia API Non-JSON Body] ${text.slice(0, 500)}`);
      registerLiquipediaBackoff(proxyKey, errorClass, response.headers.get("retry-after"), isParse ? "parse" : "generic");
      if (shouldCooldownProxyForError(errorClass)) {
        await markProxyFailure(activeProxyId, {
          errorClass,
          errorMessage: `Liquipedia API non-JSON response ${response.status}`,
          durationMs: Date.now() - startedAt,
          blocked: errorClass === "cloudflare_block",
        });
      }
      await logLiquipediaRequest({
        mode: requestMode,
        proxyId: activeProxyId,
        statusCode: response.status,
        errorClass,
        durationMs: Date.now() - startedAt,
        bytesIn: text.length,
        queryHash: hashQuery(url.toString()),
      });
      throw new LiquipediaRequestError(
        `Liquipedia API returned non-JSON response (${errorClass}, status ${response.status})`,
        { errorClass, statusCode: response.status }
      );
    }

    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as T;
      await markProxySuccess(activeProxyId, Date.now() - startedAt);
      await logLiquipediaRequest({
        mode: requestMode,
        proxyId: activeProxyId,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        bytesIn: text.length,
        queryHash: hashQuery(url.toString()),
      });
      return parsed;
    } catch {
      await logLiquipediaRequest({
        mode: requestMode,
        proxyId: activeProxyId,
        statusCode: response.status,
        errorClass: "parse_failed",
        durationMs: Date.now() - startedAt,
        bytesIn: text.length,
        queryHash: hashQuery(url.toString()),
      });
      throw new LiquipediaRequestError(
        "Liquipedia API returned invalid JSON",
        { errorClass: "parse_failed", statusCode: response.status }
      );
    }
  };

  return isParse ? withParseRateLimit(execute, proxyKey) : withGenericRateLimit(execute, proxyKey);
}

export async function fetchHtmlViaMediaWikiApi(pageUrl: string) {
  const url = new URL(pageUrl);
  const [, slug, ...titleParts] = url.pathname.split("/");
  const title = decodeURIComponent(titleParts.join("/")).replace(/_/g, " ");
  if (!slug || !title) return "";

  const apiUrl = `${url.origin}/${slug}/api.php`;
  const response = await apiRequest<{ parse?: { text?: { "*"?: string } } }>(
    apiUrl,
    {
      action: "parse",
      format: "json",
      page: title,
      prop: "text",
      disabletoc: "1",
      redirects: "1"
    },
    true
  );

  return response.parse?.text?.["*"] ?? "";
}

export function hashQuery(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

async function logLiquipediaRequest(data: {
  mode: string;
  proxyId?: string | null;
  statusCode?: number;
  errorClass?: string;
  durationMs?: number;
  bytesIn?: number;
  queryHash?: string;
}) {
  await prisma.parserRequestLog.create({
    data: {
      source: "liquipedia",
      mode: data.mode,
      proxyId: data.proxyId || null,
      statusCode: data.statusCode,
      errorClass: data.errorClass,
      durationMs: data.durationMs,
      bytesIn: data.bytesIn,
      queryHash: data.queryHash,
    },
  }).catch(() => {});
}
