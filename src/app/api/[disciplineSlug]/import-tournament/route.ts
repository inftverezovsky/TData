import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { getOrCreateDiscipline } from "@/lib/config/disciplines";
import { makeLiquipediaPageUrl } from "@/lib/liquipedia/client";
import { getNormalizer } from "@/lib/normalizers/registry";
import { importTournamentRecursive } from "@/lib/liquipedia/importer";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { importHltvTournament } from "@/lib/importSources/hltv";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for long scraping with retries

type Body = {
  pageId?: unknown;
  title?: unknown;
  pageUrl?: unknown;
  source?: "liquipedia" | "hltv";
  force?: boolean;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const slug = disciplineSlug.trim().toLowerCase();

  const body = (await request.json()) as Body;
  const source = body.source || "liquipedia";
  const pageId = typeof body.pageId === "number" ? body.pageId : undefined;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const pageUrl = typeof body.pageUrl === "string" && body.pageUrl.trim().length > 0
    ? body.pageUrl.trim()
    : (source === 'hltv' ? "" : makeLiquipediaPageUrl(title, slug));

  if (!pageId && title.length < 2) {
    return NextResponse.json({ error: "Нужен pageId или title выбранной страницы" }, { status: 400 });
  }

  // 1. Resolve discipline and normalizer dynamically
  let discipline;
  let normalizer;
  try {
    discipline = await getOrCreateDiscipline(slug);
    normalizer = getNormalizer(slug);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Неподдерживаемая игровая дисциплина" },
      { status: 400 }
    );
  }

  // If source is HLTV, we handle it differently (skip Liquipedia recursive import)
  if (source === "hltv") {
    try {
      return NextResponse.json(await importHltvTournament({
        slug,
        title,
        pageUrl,
        force: body.force,
      }));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Не удалось загрузить HLTV турнир" },
        { status: slug !== "counterstrike" ? 400 : 500 }
      );
    }
  }

  const tournamentImport = await prisma.tournamentImport.create({
    data: {
      disciplineId: discipline.id,
      pageId,
      pageTitle: title,
      pageUrl,
      status: "PENDING"
    }
  });

  try {
    const apiUrl = discipline.baseApiUrl ?? `https://liquipedia.net/${slug}/api.php`;
    
    const importResult = await importTournamentRecursive({
      disciplineId: discipline.id,
      disciplineSlug: slug,
      apiUrl,
      pageId,
      title,
      pageUrl,
      normalizer,
      importRecordId: tournamentImport.id,
      force: body.force
    });
    const { tournament, normalized } = importResult;

    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: {
        status: normalized.status,
        finishedAt: new Date()
      }
    });

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: { participants: true, matches: true, lastImport: true }
    });

    return NextResponse.json({
      tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
      normalized,
      cacheHit: importResult.cacheHit,
      cacheLayer: importResult.cacheLayer,
      stale: importResult.stale,
      warning: importResult.warning,
      qualityScore: importResult.qualityScore,
      sourceBreakdown: importResult.sourceBreakdown,
      forceCleanupStats: importResult.forceCleanupStats,
    });
  } catch (error) {
    console.error(error);
    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown import error"
      }
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить турнир" },
      { status: 500 }
    );
  }
}
