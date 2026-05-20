import { NextResponse } from "next/server";
import { runHltvScript } from "@/lib/hltv/scraper";
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
