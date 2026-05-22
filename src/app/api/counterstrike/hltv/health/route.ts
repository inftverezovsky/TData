import { NextResponse } from "next/server";
import { runHltvScript } from "@/lib/hltv/scraper";
import { classifyParserError } from "@/lib/proxy/parserErrors";
import { requireAdmin } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    if (force) {
      const unauthorized = await requireAdmin(request);
      if (unauthorized) return unauthorized;
    }

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
    const errorClass = classifyParserError({ message: error.message });
    console.error('[HLTV Health API] Error:', error);
    return NextResponse.json({ 
      ok: false, 
      status: 'error', 
      error: error.message,
      errorClass,
      isCloudflare: errorClass === "cloudflare_block"
    }, { status: 500 });
  }
}
