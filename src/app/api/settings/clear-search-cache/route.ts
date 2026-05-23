import { NextResponse } from "next/server";
import { clearCacheFiles, type CacheSource } from "@/lib/cache/cacheMaintenance";
import { requireAdmin } from "@/lib/auth/adminAuth";

const CACHE_SOURCES = new Set<CacheSource>(["hltv", "liquipedia", "all"]);

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await request.json().catch(() => ({}));
    const source = typeof body.source === "string" && CACHE_SOURCES.has(body.source as CacheSource)
      ? body.source as CacheSource
      : "all";
    const disciplineSlug = typeof body.disciplineSlug === "string" && body.disciplineSlug.trim()
      ? body.disciplineSlug.trim().toLowerCase()
      : undefined;

    const deletedCount = clearCacheFiles({ source, disciplineSlug });
    return NextResponse.json({ ok: true, deletedCount, source, disciplineSlug });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
