import { NextResponse } from "next/server";
import { runHltvScript } from "@/lib/hltv/scraper";
import { prisma } from "@/lib/db/db";
import { classifyParserError, emptyValidIfNoItems } from "@/lib/proxy/parserErrors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    const data = await runHltvScript('events', undefined, { noCache: force });
    const hltvEvents = Array.isArray(data.events) ? data.events : [];

    // Fetch existing tournaments for this discipline
    const dbTournaments = await prisma.tournament.findMany({
      where: { disciplineSlug: "counterstrike" },
      select: { id: true, name: true, sourceTitle: true }
    });

    // Map by name (fuzzy logic)
    const events = hltvEvents.map((e: any) => {
      const lowerHltv = e.title.toLowerCase();
      const existing = dbTournaments.find(db => {
        const lowerDb = db.name.toLowerCase();
        const lowerSource = db.sourceTitle.toLowerCase();
        return lowerHltv.includes(lowerDb) || lowerDb.includes(lowerHltv) || 
               lowerHltv.includes(lowerSource) || lowerSource.includes(lowerHltv);
      });

      return {
        ...e,
        dbId: existing?.id || null,
        isLinked: !!existing
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
    const errorClass = classifyParserError({ message: error.message });
    console.error('[HLTV Events API] Error:', error);
    return NextResponse.json({ ok: false, error: error.message, errorClass }, { status: 500 });
  }
}
