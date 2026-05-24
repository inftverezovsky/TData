import { NextResponse } from "next/server";
import { runDltv } from "@/lib/dltv/queue";
import { getDltvErrorMessage, normalizeDltvErrorClass } from "@/lib/dltv/userFacingErrors";
import { emptyValidIfNoItems } from "@/lib/proxy/parserErrors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const force = searchParams.get("force") === "true";

    if (!query) {
      return NextResponse.json({ ok: false, error: "Query is required" }, { status: 400 });
    }

    const data = await runDltv("search", query, { noCache: force });
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
    const errorClass = normalizeDltvErrorClass(error.errorClass, error.message);
    const userMessage = getDltvErrorMessage(errorClass, error.message);
    console.error("[DLTV Search API] Error:", error);
    return NextResponse.json({
      ok: false,
      error: userMessage,
      debugError: error.message,
      errorClass,
      userMessage,
    }, { status: 500 });
  }
}
