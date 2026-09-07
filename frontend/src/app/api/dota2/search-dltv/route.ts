import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { runDltv } from "@backend/sources/tdata/dltv/queue";
import { getDltvErrorMessage, normalizeDltvErrorClass } from "@backend/sources/tdata/dltv/userFacingErrors";
import { emptyValidIfNoItems } from "@backend/proxy/parserErrors";

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
    const errorClass = normalizeDltvErrorClass(error.errorClass, safeErrorMessage(error));
    const userMessage = getDltvErrorMessage(errorClass, safeErrorMessage(error));
    logApiError("api:dota2/search-dltv/route.ts", error);
    return NextResponse.json({
      ok: false,
      error: userMessage,
      debugError: safeErrorMessage(error),
      errorClass,
      userMessage,
    }, { status: 500 });
  }
}
