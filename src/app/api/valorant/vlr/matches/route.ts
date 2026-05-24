import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { getBestOfLabel } from "@/lib/matches/format";
import { applyDisciplineScheduleLead, formatMoscowDateTime } from "@/lib/matches/scheduleOffset";
import { classifyParserError, emptyValidIfNoItems } from "@/lib/proxy/parserErrors";
import { getTeamAliasKey, getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { normalizeTeamName } from "@/lib/teams/teams";
import { runVlrScraper } from "@/lib/vlr/scraper";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    const data = await runVlrScraper("matches", undefined, { noCache: force });
    const vlrMatches = Array.isArray(data.matches) ? data.matches : [];

    const mappings = await prisma.teamMapping.findMany({ where: { disciplineSlug: "valorant" } });
    const mappingMap = new Map<string, (typeof mappings)[number]>();
    for (const mapping of mappings) {
      for (const key of getTeamMappingLookupKeys(mapping)) {
        mappingMap.set(key.toLowerCase(), mapping);
      }
    }

    const findTeamMapping = (name: string) => {
      if (!name) return null;
      const lower = name.toLowerCase();
      const normalized = normalizeTeamName(name);
      const aliasKey = getTeamAliasKey(name);
      if (mappingMap.has(lower)) return mappingMap.get(lower);
      if (mappingMap.has(normalized)) return mappingMap.get(normalized);
      if (mappingMap.has(aliasKey)) return mappingMap.get(aliasKey);
      for (const mapping of mappings) {
        const dbName = mapping.liquipediaName.toLowerCase();
        if ((lower.includes(dbName) || dbName.includes(lower)) && dbName.length > 3) return mapping;
      }
      return null;
    };

    const matches = vlrMatches.map((match: any) => {
      const teamA = findTeamMapping(match.team1);
      const teamB = findTeamMapping(match.team2);
      const unixTime = Number(match.unix_time || 0);
      const date = unixTime > 0 ? applyDisciplineScheduleLead(new Date(unixTime * 1000), "valorant") : null;

      return {
        id: match.id,
        tournament: match.tournament,
        team1: { name: match.team1, platformId: teamA?.platformId || null },
        team2: { name: match.team2, platformId: teamB?.platformId || null },
        date: date ? formatMoscowDateTime(date) : "Unknown",
        format: getBestOfLabel(match.format),
        isReady: !!teamA?.platformId && !!teamB?.platformId,
        isLive: !!match.isLive,
      };
    });

    return NextResponse.json({
      ok: true,
      matches,
      cacheHit: !!data.cacheHit,
      cacheLayer: data.cacheLayer || null,
      stale: !!data.stale,
      warning: data.warning || null,
      errorClass: data.errorClass || emptyValidIfNoItems([vlrMatches.length]),
    });
  } catch (error: any) {
    const errorClass = classifyParserError({ message: error.message });
    console.error("[VLR Matches API] Error:", error);
    return NextResponse.json({ ok: false, error: error.message, errorClass }, { status: 500 });
  }
}
