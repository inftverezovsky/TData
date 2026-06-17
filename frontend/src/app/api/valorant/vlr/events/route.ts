import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { emptyValidIfNoItems, classifyParserError } from "@backend/proxy/parserErrors";
import { runVlrScraper } from "@backend/sources/tdata/vlr/scraper";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    const data = await runVlrScraper("events", undefined, { noCache: force });
    const vlrEvents = Array.isArray(data.events) ? data.events : [];

    const dbTournaments = await prisma.tournament.findMany({
      where: { disciplineSlug: "valorant" },
      select: { id: true, name: true, sourceTitle: true },
    });

    const events = vlrEvents.map((event: any) => {
      const lowerVlr = event.title.toLowerCase();
      const existing = dbTournaments.find((db) => {
        const lowerDb = db.name.toLowerCase();
        const lowerSource = db.sourceTitle.toLowerCase();
        return lowerVlr.includes(lowerDb) || lowerDb.includes(lowerVlr) ||
          lowerVlr.includes(lowerSource) || lowerSource.includes(lowerVlr);
      });

      return { ...event, dbId: existing?.id || null, isLinked: !!existing };
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
    console.error("[VLR Events API] Error:", error);
    return NextResponse.json({ ok: false, error: error.message, errorClass }, { status: 500 });
  }
}
