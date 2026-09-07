import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { runHltvScript } from "@backend/sources/tdata/hltv/scraper";
import { classifyParserError } from "@backend/proxy/parserErrors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    const data = await runHltvScript('health', undefined, { noCache: force });
    return NextResponse.json({
      ok: true,
      status: 'online',
      title: data.title,
      cacheHit: !!data.cacheHit,
      cacheLayer: data.cacheLayer || null,
      stale: !!data.stale,
      warning: data.warning || null,
      errorClass: data.errorClass || null,
    });
  } catch (error: any) {
    const errorClass = classifyParserError({ message: safeErrorMessage(error) });
    logApiError("api:counterstrike/hltv/health/route.ts", error);
    return NextResponse.json({ 
      ok: false, 
      status: 'error', 
      error: safeErrorMessage(error),
      errorClass,
      isCloudflare: errorClass === "cloudflare_block"
    }, { status: 500 });
  }
}
