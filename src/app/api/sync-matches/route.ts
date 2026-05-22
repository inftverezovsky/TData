import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { buildTeamMappingLookup, findTeamMapping } from "@/lib/teams/mappingLookup";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { validateOutboundUrl } from "@/lib/http/outboundPolicy";

const SYNC_TIMEOUT_MS = 15000;
const MAX_ERROR_BYTES = 4096;

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const { matchIds, disciplineSlug } = await request.json();

    if (!matchIds || !Array.isArray(matchIds)) {
      return NextResponse.json({ error: "matchIds array is required" }, { status: 400 });
    }
    if (typeof disciplineSlug !== "string" || disciplineSlug.length === 0) {
      return NextResponse.json({ error: "disciplineSlug is required" }, { status: 400 });
    }

    const requestedIds = matchIds
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter(Boolean);

    if (requestedIds.length === 0) {
      return NextResponse.json({ error: "matchIds array is empty" }, { status: 400 });
    }

    // 1. Fetch matches with their tournament data
    const fetchedMatches = await prisma.tournamentMatch.findMany({
      where: {
        OR: [
          { id: { in: requestedIds } },
          { matchId: { in: requestedIds } },
        ],
        tournament: { disciplineSlug },
      },
      include: { tournament: true },
    });
    const matches = dedupeTournamentMatches(fetchedMatches);

    // 2. Fetch all unique team names from these matches to get their platform IDs
    const teamNames = new Set<string>();
    matches.forEach(m => {
      if (m.teamAName) teamNames.add(m.teamAName);
      if (m.teamBName) teamNames.add(m.teamBName);
    });

    const mappings = await prisma.teamMapping.findMany({ where: { disciplineSlug } });

    // Build a lookup map that handles canonical names and aliases while
    // preferring saved/manual IDs over old unmapped duplicates.
    const mappingMap = buildTeamMappingLookup(mappings);

    // 3. Get target URL from settings
    const targetUrlSetting = await prisma.globalSettings.findUnique({ where: { key: "external_platform_url" } });
    const targetApiKeySetting = await prisma.globalSettings.findUnique({ where: { key: "external_platform_api_key" } });

    if (!targetUrlSetting?.value) {
      return NextResponse.json({ error: "External Platform URL not configured in settings" }, { status: 400 });
    }

    if (!(await isAllowedExternalUrl(targetUrlSetting.value))) {
      return NextResponse.json({ error: "External Platform URL is not allowed" }, { status: 400 });
    }

    const skippedMatches: Array<{ matchId: string | null; reason: string; teams: string }> = [];

    // 4. Prepare data for the external platform
    const payload = matches.flatMap(m => {
      const teamAName = m.teamAName || "";
      const teamBName = m.teamBName || "";

      const teamA = findTeamMapping(mappingMap, m.teamAName);
      const teamB = findTeamMapping(mappingMap, m.teamBName);

      if (!teamA?.platformId || !teamB?.platformId) {
        skippedMatches.push({
          matchId: m.matchId,
          reason: "Missing mapped platform IDs",
          teams: `${teamAName || "?"} vs ${teamBName || "?"}`,
        });
        return [];
      }

      return [{
        externalId: m.id,
        liquipediaMatchId: m.matchId,
        tournament: {
          name: m.tournament.name,
          platformId: m.tournament.platformId,
        },
        discipline: disciplineSlug,
        matchDate: m.matchDate,
        teamA: {
          name: m.teamAName,
          platformId: teamA?.platformId || null,
          alias: teamA?.alias || null,
        },
        teamB: {
          name: m.teamBName,
          platformId: teamB?.platformId || null,
          alias: teamB?.alias || null,
        },
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        status: m.status,
        format: m.format,
        stage: m.stage,
        round: m.round,
      }];
    });

    if (payload.length === 0) {
      return NextResponse.json({
        error: "No sync-ready matches found",
        skippedMatches,
      }, { status: 400 });
    }

    // 5. Send to external platform
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
    const response = await fetch(targetUrlSetting.value, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${targetApiKeySetting?.value || ""}`,
      },
      body: JSON.stringify({ matches: payload }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, MAX_ERROR_BYTES);
      throw new Error(`External platform returned error: ${errorText}`);
    }

    // 6. Mark matches as synced
    await prisma.tournamentMatch.updateMany({
      where: { id: { in: payload.map((match) => match.externalId) } },
      data: { syncedAt: new Date() },
    });

    return NextResponse.json({ success: true, count: payload.length, skippedMatches });
  } catch (error: any) {
    console.error("Sync Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function isAllowedExternalUrl(rawUrl: string) {
  try {
    await validateOutboundUrl(rawUrl, {
      policyName: "External Platform",
      allowedHostsEnv: [process.env.EXTERNAL_PLATFORM_ALLOWED_HOSTS],
      allowInsecureHttpEnv: process.env.EXTERNAL_PLATFORM_ALLOW_INSECURE_HTTP,
      allowPrivateHostsEnv: process.env.EXTERNAL_PLATFORM_ALLOW_PRIVATE_HOSTS,
      allowAnyPublicHostEnv: process.env.EXTERNAL_PLATFORM_ALLOW_ANY_PUBLIC_HOST,
      requireAllowedHostsInProduction: false,
    });
    return true;
  } catch {
    return false;
  }
}
