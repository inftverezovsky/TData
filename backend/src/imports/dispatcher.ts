import { getOrCreateDiscipline } from "@backend/config/disciplines";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";
import { getNormalizer } from "@backend/normalizers/registry";
import { importBeachVolleyRuTournament } from "@backend/sources/tbvolley/beach.volley.ru/importTournament";
import { importCBVTournament } from "@backend/sources/tbvolley/CBV/importTournament";
import { importFedervolleyTournament } from "@backend/sources/tbvolley/Federvolley/importTournament";
import { importGermanBeachTourTournament } from "@backend/sources/tbvolley/GermanBeachTour/importTournament";
import { importTwelveNdrTournament } from "@backend/sources/tbvolley/TwelveNdr/importTournament";
import { importVolleyballWorldTournament } from "@backend/sources/tbvolley/VolleyballWorld/importTournament";
import { importWttTournament } from "@backend/sources/tablet/WTT/importTournament";
import { importDltvTournament } from "@backend/sources/tdata/dltv/importTournament";
import { importFandomTournament } from "@backend/sources/tdata/fandom/importTournament";
import { importHltvTournament } from "@backend/sources/tdata/hltv/importTournament";
import { makeLiquipediaPageUrl } from "@backend/sources/tdata/liquipedia/client";
import { importTournamentRecursive } from "@backend/sources/tdata/liquipedia/importer";
import {
  getLiquipediaResponseStatus,
  toLiquipediaUserFacingError,
} from "@backend/sources/tdata/liquipedia/userFacingErrors";
import { importVlrTournament } from "@backend/sources/tdata/vlr/importTournament";

export type TournamentImportSource =
  | "liquipedia"
  | "hltv"
  | "vlr"
  | "dltv"
  | "fandom"
  | "volleyballworld"
  | "beachvolleyru"
  | "germanbeachtour"
  | "twelvendrcsvp"
  | "twelvendroevv"
  | "cbv"
  | "federvolley"
  | "wtt";

export type ImportTournamentRequestBody = {
  pageId?: unknown;
  title?: unknown;
  pageUrl?: unknown;
  source?: TournamentImportSource;
  tournamentNo?: unknown;
  eventId?: unknown;
  tournamentId?: unknown;
  tcode?: unknown;
  timezone?: unknown;
  calendarMode?: unknown;
  campeonatoId?: unknown;
  temporadaId?: unknown;
  etapaId?: unknown;
  federvolleyNodeId?: unknown;
  matchshareLid?: unknown;
  category?: unknown;
  categoryScope?: unknown;
  timeZoneId?: unknown;
  gender?: unknown;
  fromDate?: unknown;
  toDate?: unknown;
  days?: unknown;
  force?: boolean;
};

export type ImportTournamentDispatchResult = {
  body: unknown;
  status?: number;
};

export async function dispatchTournamentImport(
  disciplineSlug: string,
  body: ImportTournamentRequestBody,
): Promise<ImportTournamentDispatchResult> {
  const slug = disciplineSlug.trim().toLowerCase();
  const source = body.source || "liquipedia";
  const pageId = typeof body.pageId === "number" ? body.pageId : undefined;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const pageUrl = resolvePageUrl(source, body.pageUrl, title, slug);

  if (!pageId && title.length < 2) {
    return { body: { error: "Нужен pageId или title выбранной страницы" }, status: 400 };
  }

  let discipline;
  try {
    discipline = await getOrCreateDiscipline(slug);
  } catch (err) {
    return {
      body: { error: err instanceof Error ? err.message : "Неподдерживаемая игровая дисциплина" },
      status: 400,
    };
  }

  if (source === "hltv") {
    try {
      return {
        body: await importHltvTournament({ slug, title, pageUrl, force: body.force }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить HLTV турнир", slug !== "counterstrike" ? 400 : 500);
    }
  }

  if (source === "vlr") {
    try {
      return {
        body: await importVlrTournament({ slug, title, pageUrl, force: body.force }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить VLR турнир", slug !== "valorant" ? 400 : 500);
    }
  }

  if (source === "dltv") {
    try {
      return {
        body: await importDltvTournament({ slug, title, pageUrl, force: body.force }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить DLTV турнир", slug !== "dota2" ? 400 : 500);
    }
  }

  if (source === "fandom") {
    try {
      return {
        body: await importFandomTournament({
          slug,
          disciplineId: discipline.id,
          pageId,
          title,
          pageUrl,
          force: body.force,
        }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить Fandom турнир", slug !== "leagueoflegends" ? 400 : 500, true);
    }
  }

  if (source === "volleyballworld") {
    try {
      return {
        body: await importVolleyballWorldTournament({
          slug,
          disciplineId: discipline.id,
          title,
          pageUrl,
          tournamentNo: stringOrNumber(body.tournamentNo),
          gender: stringValue(body.gender),
          fromDate: stringValue(body.fromDate),
          toDate: stringValue(body.toDate),
          days: stringOrNumber(body.days),
          force: body.force,
        }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить VolleyballWorld турнир", slug !== "beachvolleyball" ? 400 : 500, true);
    }
  }

  if (source === "beachvolleyru") {
    try {
      return {
        body: await importBeachVolleyRuTournament({
          slug,
          disciplineId: discipline.id,
          title,
          pageUrl,
          eventId: stringOrNumber(body.eventId),
          gender: stringValue(body.gender),
          force: body.force,
        }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить турнир beach.volley.ru", slug !== "beachvolleyball" ? 400 : 500, true);
    }
  }

  if (source === "germanbeachtour") {
    try {
      return {
        body: await importGermanBeachTourTournament({
          slug,
          disciplineId: discipline.id,
          title,
          pageUrl,
          tournamentId: stringOrNumber(body.tournamentId),
          gender: stringValue(body.gender),
          force: body.force,
        }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить турнир German Beach Tour", slug !== "beachvolleyball" ? 400 : 500, true);
    }
  }

  if (source === "twelvendrcsvp" || source === "twelvendroevv") {
    try {
      return {
        body: await importTwelveNdrTournament({
          slug,
          disciplineId: discipline.id,
          title,
          pageUrl,
          source,
          calendarMode: stringValue(body.calendarMode),
          tcode: stringOrNumber(body.tcode),
          timezone: stringOrNumber(body.timezone),
          gender: stringValue(body.gender),
          force: body.force,
        }),
      };
    } catch (error) {
      const label = source === "twelvendroevv" ? "12ndr ÖVV" : "12ndr CSVP";
      return sourceError(error, `Не удалось загрузить турнир ${label}`, slug !== "beachvolleyball" ? 400 : 500, true);
    }
  }

  if (source === "cbv") {
    try {
      return {
        body: await importCBVTournament({
          slug,
          disciplineId: discipline.id,
          title,
          pageUrl,
          campeonatoId: stringOrNumber(body.campeonatoId),
          temporadaId: stringOrNumber(body.temporadaId),
          etapaId: stringOrNumber(body.etapaId),
          gender: stringValue(body.gender),
          force: body.force,
        }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить турнир CBV", slug !== "beachvolleyball" ? 400 : 500, true);
    }
  }

  if (source === "federvolley") {
    try {
      return {
        body: await importFedervolleyTournament({
          slug,
          disciplineId: discipline.id,
          title,
          pageUrl,
          federvolleyNodeId: stringOrNumber(body.federvolleyNodeId),
          matchshareLid: stringOrNumber(body.matchshareLid),
          category: stringValue(body.category),
          gender: stringValue(body.gender),
          force: body.force,
        }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить турнир Federvolley", slug !== "beachvolleyball" ? 400 : 500, true);
    }
  }

  if (source === "wtt") {
    try {
      return {
        body: await importWttTournament({
          slug,
          disciplineId: discipline.id,
          title,
          pageUrl,
          eventId: stringOrNumber(body.eventId),
          timeZoneId: stringOrNumber(body.timeZoneId),
          categoryScope: stringValue(body.categoryScope),
          fromDate: stringValue(body.fromDate),
          toDate: stringValue(body.toDate),
          days: stringOrNumber(body.days),
          force: body.force,
        }),
      };
    } catch (error) {
      return sourceError(error, "Не удалось загрузить турнир WTT", slug !== "tabletennis" ? 400 : 500, true);
    }
  }

  return importLiquipediaTournament({
    disciplineId: discipline.id,
    slug,
    pageId,
    title,
    pageUrl,
    force: body.force,
    apiUrl: discipline.baseApiUrl ?? `https://liquipedia.net/${slug}/api.php`,
  });
}

function resolvePageUrl(
  source: TournamentImportSource,
  rawPageUrl: unknown,
  title: string,
  slug: string,
) {
  if (typeof rawPageUrl === "string" && rawPageUrl.trim().length > 0) {
    return rawPageUrl.trim();
  }
  return source === "liquipedia" ? makeLiquipediaPageUrl(title, slug) : "";
}

async function importLiquipediaTournament(input: {
  disciplineId: string;
  slug: string;
  pageId?: number;
  title: string;
  pageUrl: string;
  apiUrl: string;
  force?: boolean;
}): Promise<ImportTournamentDispatchResult> {
  let normalizer;
  try {
    normalizer = getNormalizer(input.slug);
  } catch (err) {
    return {
      body: { error: err instanceof Error ? err.message : "Неподдерживаемая игровая дисциплина" },
      status: 400,
    };
  }

  const tournamentImport = await prisma.tournamentImport.create({
    data: {
      disciplineId: input.disciplineId,
      pageId: input.pageId,
      pageTitle: input.title,
      pageUrl: input.pageUrl,
      status: "PENDING",
    },
  });

  try {
    const importResult = await importTournamentRecursive({
      disciplineId: input.disciplineId,
      disciplineSlug: input.slug,
      apiUrl: input.apiUrl,
      pageId: input.pageId,
      title: input.title,
      pageUrl: input.pageUrl,
      normalizer,
      importRecordId: tournamentImport.id,
      force: input.force,
    });

    const { tournament, normalized } = importResult;

    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: {
        status: normalized.status,
        finishedAt: new Date(),
      },
    });

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: { participants: true, matches: true, lastImport: true },
    });

    return {
      body: {
        tournament: fullTournament ? { ...fullTournament, matches: dedupeTournamentMatches(fullTournament.matches) } : null,
        normalized,
        cacheHit: importResult.cacheHit,
        cacheLayer: importResult.cacheLayer,
        stale: importResult.stale,
        warning: importResult.warning,
        qualityScore: importResult.qualityScore,
        sourceBreakdown: importResult.sourceBreakdown,
        forceCleanupStats: importResult.forceCleanupStats,
      },
    };
  } catch (error) {
    const userFacingError = toLiquipediaUserFacingError(error);
    console.error(error);
    await prisma.tournamentImport.update({
      where: { id: tournamentImport.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: userFacingError.userMessage,
      },
    });

    return {
      body: {
        error: userFacingError.userMessage,
        userMessage: userFacingError.userMessage,
        errorClass: userFacingError.errorClass,
      },
      status: getLiquipediaResponseStatus(userFacingError.errorClass),
    };
  }
}

function sourceError(
  error: unknown,
  fallback: string,
  status: number,
  includeUserMessage = false,
): ImportTournamentDispatchResult {
  const message = error instanceof Error ? error.message : fallback;
  return {
    body: includeUserMessage ? { error: message, userMessage: message } : { error: message },
    status,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}
