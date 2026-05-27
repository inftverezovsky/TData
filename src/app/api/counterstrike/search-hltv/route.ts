import { NextResponse } from "next/server";
import { runHltvScript } from "@/lib/hltv/scraper";
import { filterHltvEventsByQuery } from "@/lib/hltv/searchFallback";
import { emptyValidIfNoItems } from "@/lib/proxy/parserErrors";
import { getHltvSearchErrorMessage, normalizeHltvErrorClass } from "@/lib/hltv/userFacingErrors";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for long scraping with retries

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const force = searchParams.get("force") === "true";
    
    if (!query) {
      return NextResponse.json({ ok: false, error: "Query is required" }, { status: 400 });
    }

    const data = await runHltvScript('search', query, { noCache: force });
    let results = Array.isArray(data.events) ? data.events : [];
    let fallbackData: any = null;
    if (results.length === 0) {
      fallbackData = await runHltvScript("events", undefined, { noCache: force }).catch((error) => ({
        ok: false,
        warning: error instanceof Error ? error.message : "HLTV events fallback failed.",
      }));
      if (Array.isArray(fallbackData.events)) {
        results = filterHltvEventsByQuery(fallbackData.events, query);
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      cacheHit: !!data.cacheHit || !!fallbackData?.cacheHit,
      cacheLayer: results.length > 0 && fallbackData ? `events-fallback${fallbackData.cacheLayer ? `:${fallbackData.cacheLayer}` : ""}` : data.cacheLayer || null,
      stale: !!data.stale || !!fallbackData?.stale,
      warning: data.warning || fallbackData?.warning || null,
      errorClass: results.length > 0 ? null : data.errorClass || emptyValidIfNoItems([results.length]),
    });
  } catch (error: any) {
    const errorClass = normalizeHltvErrorClass(error.errorClass, error.message);
    const userMessage = getHltvSearchErrorMessage(errorClass, error.message);
    console.error('[HLTV Search API] Error:', error);
    return NextResponse.json({
      ok: false,
      error: userMessage,
      debugError: error.message,
      errorClass,
      userMessage,
    }, { status: 500 });
  }
}
