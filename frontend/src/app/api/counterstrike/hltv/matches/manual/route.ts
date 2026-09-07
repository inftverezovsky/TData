import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { getTeamAliasKey, getTeamMappingLookupKeys } from "@backend/teams/canonicalize";
import { normalizeTeamName } from "@backend/teams/teams";

export async function POST(req: Request) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;
  const invalidMutation = requireSameOriginJsonMutation(req);
  if (invalidMutation) return invalidMutation;

  try {
    const { matches: rawMatches } = await req.json();

    if (!Array.isArray(rawMatches)) {
      return NextResponse.json({ ok: false, error: "Invalid matches data" }, { status: 400 });
    }

    // Get all team mappings for Counter-Strike to map names to platform IDs
    const mappings = await prisma.teamMapping.findMany({
      where: { disciplineSlug: "counterstrike" }
    });

    const mappingMap = new Map<string, (typeof mappings)[number]>();
    for (const mapping of mappings) {
      for (const key of getTeamMappingLookupKeys(mapping)) {
        mappingMap.set(key.toLowerCase(), mapping);
      }
    }

    const findBestMatch = (name: string) => {
      if (!name) return null;
      const lowerName = name.toLowerCase();
      const normalized = normalizeTeamName(name);
      const aliasKey = getTeamAliasKey(name);
      // 1. Exact match
      if (mappingMap.has(lowerName)) return mappingMap.get(lowerName);
      if (mappingMap.has(normalized)) return mappingMap.get(normalized);
      if (mappingMap.has(aliasKey)) return mappingMap.get(aliasKey);
      
      // 2. Fuzzy match: check if database name is inside OCR name or vice versa
      // This helps with "EB Tricked" matching "Tricked"
      for (const m of mappings) {
        const dbName = m.liquipediaName.toLowerCase();
        if (lowerName.includes(dbName) || dbName.includes(lowerName)) {
          if (dbName.length > 3) return m; // Only match if name is long enough
        }
      }
      return null;
    };

    const matches = rawMatches.map((m: any) => {
      const name1 = (typeof m.team1 === 'object' ? m.team1?.name : m.team1) || "TBD";
      const name2 = (typeof m.team2 === 'object' ? m.team2?.name : m.team2) || "TBD";
      
      const teamA = findBestMatch(name1);
      const teamB = findBestMatch(name2);

      // Format date
      let dateStr = m.date || "Unknown";
      if (m.unix_time) {
        const date = new Date(parseInt(m.unix_time) * 1000);
        dateStr = date.toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: 'Europe/Moscow'
        }).replace(',', '');
      }

      return {
        id: m.id || Math.random().toString(36).substr(2, 9),
        tournament: m.tournament || "Unknown",
        team1: {
          name: name1,
          platformId: teamA?.platformId || null,
        },
        team2: {
          name: name2,
          platformId: teamB?.platformId || null,
        },
        date: dateStr,
        isReady: !!teamA?.platformId && !!teamB?.platformId
      };
    });

    return NextResponse.json({ ok: true, matches });
  } catch (error: any) {
    logApiError("api:counterstrike/hltv/matches/manual/route.ts", error);
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}
