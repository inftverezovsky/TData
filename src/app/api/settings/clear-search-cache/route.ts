import { NextResponse } from "next/server";
import { clearCacheFiles, isValidCacheDisciplineSlug, type CacheSource } from "@/lib/cache/cacheMaintenance";

const CACHE_SOURCES = new Set<CacheSource>(["hltv", "vlr", "dltv", "fandom", "liquipedia", "all"]);

export async function POST(request: Request) {
  try {
    // API remains callable directly; password gate is UI-only for settings visibility.

    const body = await request.json().catch(() => ({}));
    const source = typeof body.source === "string" && CACHE_SOURCES.has(body.source as CacheSource)
      ? body.source as CacheSource
      : "all";
    const disciplineSlug = typeof body.disciplineSlug === "string" && body.disciplineSlug.trim()
      ? body.disciplineSlug.trim().toLowerCase()
      : undefined;
    if (disciplineSlug && !isValidCacheDisciplineSlug(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Invalid disciplineSlug" }, { status: 400 });
    }

    const deletedCount = clearCacheFiles({ source, disciplineSlug });
    return NextResponse.json({ ok: true, deletedCount, source, disciplineSlug });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
