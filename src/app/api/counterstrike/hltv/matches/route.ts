import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { runHltvScript } from "@/lib/hltv/scraper";
import { classifyParserError, emptyValidIfNoItems } from "@/lib/proxy/parserErrors";
import { getTeamAliasKey, getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { normalizeTeamName } from "@/lib/teams/teams";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    // 2. Run the Playwright scraper script via the lib
    const data = await runHltvScript('scrape', undefined, { noCache: force });
    const hltvMatches = Array.isArray(data.matches) ? data.matches : [];

    // 2. Get all team mappings for Counter-Strike
    const mappings = await prisma.teamMapping.findMany({
      where: { disciplineSlug: "counterstrike" }
    });

    const mappingMap = new Map<string, (typeof mappings)[number]>();
    for (const mapping of mappings) {
      for (const key of getTeamMappingLookupKeys(mapping)) {
        mappingMap.set(key.toLowerCase(), mapping);
      }
    }

    // 3. Transform and map with fuzzy matching support
    const findTeamMapping = (name: string) => {
      if (!name) return null;
      const lower = name.toLowerCase();
      const normalized = normalizeTeamName(name);
      const aliasKey = getTeamAliasKey(name);
      // Exact match
      if (mappingMap.has(lower)) return mappingMap.get(lower);
      if (mappingMap.has(normalized)) return mappingMap.get(normalized);
      if (mappingMap.has(aliasKey)) return mappingMap.get(aliasKey);
      // Fuzzy match (includes)
      for (const m of mappings) {
        const dbName = m.liquipediaName.toLowerCase();
        if (lower.includes(dbName) || dbName.includes(lower)) {
          if (dbName.length > 3) return m;
        }
      }
      return null;
    };

    const matches = (hltvMatches as any[]).map((m: any) => {
      const teamA = findTeamMapping(m.team1);
      const teamB = findTeamMapping(m.team2);

      // Format date from unix timestamp
      const date = new Date(m.unix_time * 1000);
      const dateStr = date.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Europe/Moscow'
      }).replace(',', '');

      return {
        id: m.id,
        tournament: m.tournament,
        team1: {
          name: m.team1,
          platformId: teamA?.platformId || null,
        },
        team2: {
          name: m.team2,
          platformId: teamB?.platformId || null,
        },
        date: dateStr,
        isReady: !!teamA?.platformId && !!teamB?.platformId,
        isLive: !!m.isLive
      };
    });

    return NextResponse.json({
      ok: true,
      matches,
      cacheHit: !!data.cacheHit,
      cacheLayer: data.cacheLayer || null,
      stale: !!data.stale,
      warning: data.warning || null,
      errorClass: data.errorClass || emptyValidIfNoItems([hltvMatches.length]),
    });
  } catch (error: any) {
    const errorClass = classifyParserError({ message: error.message });
    console.error('[HLTV Scrape Route] Error:', error);
    return NextResponse.json({ 
      ok: false, 
      error: error.message,
      errorClass,
    }, { status: 500 });
  }
}
