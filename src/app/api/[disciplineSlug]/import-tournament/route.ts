import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { getOrCreateDiscipline } from "@/lib/config/disciplines";
import { makeLiquipediaPageUrl } from "@/lib/liquipedia/client";
import { getNormalizer } from "@/lib/normalizers/registry";
import { importTournamentRecursive } from "@/lib/liquipedia/importer";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { importHltvTournament } from "@/lib/importSources/hltv";
import { importVlrTournament } from "@/lib/importSources/vlr";
import { importDltvTournament } from "@/lib/importSources/dltv";
import { importFandomTournament } from "@/lib/importSources/fandom";
import { importVolleyballWorldTournament } from "@/lib/importSources/volleyballworld";
import { importBeachVolleyRuTournament } from "@/lib/importSources/beachVolleyRu";
import { importGermanBeachTourTournament } from "@/lib/importSources/germanBeachTour";
import { getLiquipediaResponseStatus, toLiquipediaUserFacingError } from "@/lib/liquipedia/userFacingErrors";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for long scraping with retries

type Body = {
  pageId?: unknown;
  title?: unknown;
  pageUrl?: unknown;
  source?: "liquipedia" | "hltv" | "vlr" | "dltv" | "fandom" | "volleyballworld" | "beachvolleyru" | "germanbeachtour";
  tournamentNo?: unknown;
  eventId?: unknown;
  tournamentId?: unknown;
  gender?: unknown;
  fromDate?: unknown;
  toDate?: unknown;
  days?: unknown;
  force?: boolean;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const slug = disciplineSlug.trim().toLowerCase();

  const body = (await request.json()) as Body;
  const source = body.source || "liquipedia";
  const pageId = typeof body.pageId === "number" ? body.pageId : undefined;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const nonLiquipediaSource = source === "hltv" || source === "vlr" || source === "dltv" || source === "fandom" || source === "volleyballworld" || source === "beachvolleyru" || source === "germanbeachtour";
  const pageUrl = typeof body.pageUrl === "string" && body.pageUrl.trim().length > 0
    ? body.pageUrl.trim()
    : (nonLiquipediaSource ? "" : makeLiquipediaPageUrl(title, slug));

  if (!pageId && title.length < 2) {
    return NextResponse.json({ error: "Нужен pageId или title выбранной страницы" }, { status: 400 });
  }

  // 1. Resolve discipline and normalizer dynamically
  let discipline;
  try {
    discipline = await getOrCreateDiscipline(slug);
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

  if (source === "vlr") {
    try {
      return NextResponse.json(await importVlrTournament({
        slug,
        title,
        pageUrl,
        force: body.force,
      }));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Не удалось загрузить VLR турнир" },
        { status: slug !== "valorant" ? 400 : 500 }
      );
    }
  }

  if (source === "dltv") {
    try {
      return NextResponse.json(await importDltvTournament({
        slug,
        title,
        pageUrl,
        force: body.force,
      }));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Не удалось загрузить DLTV турнир" },
        { status: slug !== "dota2" ? 400 : 500 }
      );
    }
  }

  if (source === "fandom") {
    try {
      return NextResponse.json(await importFandomTournament({
        slug,
        disciplineId: discipline.id,
        pageId,
        title,
        pageUrl,
        force: body.force,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить Fandom турнир";
      return NextResponse.json(
        { error: message, userMessage: message },
        { status: slug !== "leagueoflegends" ? 400 : 500 }
      );
    }
  }

  if (source === "volleyballworld") {
    const tournamentNo = typeof body.tournamentNo === "string" || typeof body.tournamentNo === "number" ? body.tournamentNo : null;
    const gender = typeof body.gender === "string" ? body.gender : null;
    const fromDate = typeof body.fromDate === "string" ? body.fromDate : null;
    const toDate = typeof body.toDate === "string" ? body.toDate : null;
    const days = typeof body.days === "string" || typeof body.days === "number" ? body.days : null;

    try {
      return NextResponse.json(await importVolleyballWorldTournament({
        slug,
        disciplineId: discipline.id,
        title,
        pageUrl,
        tournamentNo,
        gender,
        fromDate,
        toDate,
        days,
        force: body.force,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить VolleyballWorld турнир";
      return NextResponse.json(
        { error: message, userMessage: message },
        { status: slug !== "beachvolleyball" ? 400 : 500 }
      );
    }
  }

  if (source === "beachvolleyru") {
    const eventId = typeof body.eventId === "string" || typeof body.eventId === "number" ? body.eventId : null;
    const gender = typeof body.gender === "string" ? body.gender : null;

    try {
      return NextResponse.json(await importBeachVolleyRuTournament({
        slug,
        disciplineId: discipline.id,
        title,
        pageUrl,
        eventId,
        gender,
        force: body.force,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить турнир beach.volley.ru";
      return NextResponse.json(
        { error: message, userMessage: message },
        { status: slug !== "beachvolleyball" ? 400 : 500 }
      );
    }
  }

  if (source === "germanbeachtour") {
    const tournamentId = typeof body.tournamentId === "string" || typeof body.tournamentId === "number" ? body.tournamentId : null;
    const gender = typeof body.gender === "string" ? body.gender : null;

    try {
      return NextResponse.json(await importGermanBeachTourTournament({
        slug,
        disciplineId: discipline.id,
        title,
        pageUrl,
        tournamentId,
        gender,
        force: body.force,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить турнир German Beach Tour";
      return NextResponse.json(
        { error: message, userMessage: message },
        { status: slug !== "beachvolleyball" ? 400 : 500 }
      );
    }
  }

  let normalizer;
  try {
    normalizer = getNormalizer(slug);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Неподдерживаемая игровая дисциплина" },
      { status: 400 }
    );
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
    const userFacingError = toLiquipediaUserFacingError(error);
    console.error(error);
    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: userFacingError.userMessage
      }
    });

    return NextResponse.json(
      { error: userFacingError.userMessage, userMessage: userFacingError.userMessage, errorClass: userFacingError.errorClass },
      { status: getLiquipediaResponseStatus(userFacingError.errorClass) }
    );
  }
}
