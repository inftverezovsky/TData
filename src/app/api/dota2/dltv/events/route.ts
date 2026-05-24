import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { runDltv } from "@/lib/dltv/queue";
import { getDltvErrorMessage, normalizeDltvErrorClass } from "@/lib/dltv/userFacingErrors";
import { emptyValidIfNoItems } from "@/lib/proxy/parserErrors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    const data = await runDltv("events", undefined, { noCache: force });
    const dltvEvents = Array.isArray(data.events) ? data.events : [];
    const dbTournaments = await prisma.tournament.findMany({
      where: { disciplineSlug: "dota2" },
      select: { id: true, name: true, sourceTitle: true, sourceUrl: true },
    });

    const events = dltvEvents.map((event: any) => {
      const lowerDltv = event.title.toLowerCase();
      const existing = dbTournaments.find((db) => {
        if (db.sourceUrl === event.url) return true;
        const lowerDb = db.name.toLowerCase();
        const lowerSource = db.sourceTitle.toLowerCase();
        return lowerDltv.includes(lowerDb) || lowerDb.includes(lowerDltv) || lowerDltv.includes(lowerSource) || lowerSource.includes(lowerDltv);
      });

      return {
        ...event,
        dbId: existing?.id || null,
        isLinked: !!existing,
      };
    });

    return NextResponse.json({
      ok: true,
      events,
      cacheHit: !!data.cacheHit,
      cacheLayer: data.cacheLayer || null,
      stale: !!data.stale,
      warning: data.warning || null,
      errorClass: data.errorClass || emptyValidIfNoItems([events.length]),
    });
  } catch (error: any) {
    const errorClass = normalizeDltvErrorClass(error.errorClass, error.message);
    console.error("[DLTV Events API] Error:", error);
    return NextResponse.json({
      ok: false,
      error: getDltvErrorMessage(errorClass, error.message),
      errorClass,
    }, { status: 500 });
  }
}
