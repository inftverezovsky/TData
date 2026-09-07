import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { emptyValidIfNoItems, classifyParserError } from "@backend/proxy/parserErrors";
import { runVlrScraper } from "@backend/sources/tdata/vlr/scraper";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const force = searchParams.get("force") === "true";

    if (!query) {
      return NextResponse.json({ ok: false, error: "Query is required" }, { status: 400 });
    }

    const data = await runVlrScraper("search", query, { noCache: force });
    const results = Array.isArray(data.events) ? data.events : [];
    return NextResponse.json({
      ok: true,
      results,
      cacheHit: !!data.cacheHit,
      cacheLayer: data.cacheLayer || null,
      stale: !!data.stale,
      warning: data.warning || null,
      errorClass: data.errorClass || emptyValidIfNoItems([results.length]),
    });
  } catch (error: any) {
    const errorClass = classifyParserError({ message: safeErrorMessage(error) });
    const userMessage = getVlrErrorMessage(errorClass, safeErrorMessage(error));
    logApiError("api:valorant/search-vlr/route.ts", error);
    return NextResponse.json({
      ok: false,
      error: userMessage,
      debugError: safeErrorMessage(error),
      errorClass,
      userMessage,
    }, { status: 500 });
  }
}

function getVlrErrorMessage(errorClass: string | null | undefined, fallback: string) {
  if (errorClass === "selector_changed" || errorClass === "parse_failed") return "VLR изменил разметку страницы. Нужно обновить парсер.";
  if (errorClass === "rate_limited" || errorClass === "cloudflare_block") return "VLR временно ограничил доступ. Повторите позже или включите прокси.";
  if (errorClass === "network_error" || errorClass === "timeout") return "VLR не ответил вовремя. Повторите запрос.";
  return fallback || "Не удалось загрузить VLR";
}
