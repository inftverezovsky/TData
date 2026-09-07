import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { findClosestPlatformTeam } from "@backend/teams/fuzzyMatch";

export const dynamic = "force-dynamic";

type RequestBody = {
  disciplineSlug?: unknown;
  teamNames?: unknown;
};

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const disciplineSlug = typeof body.disciplineSlug === "string" ? body.disciplineSlug.trim() : "";
    const teamNames = Array.isArray(body.teamNames) ? body.teamNames.filter((t): t is string => typeof t === "string") : [];

    if (!disciplineSlug) {
      return NextResponse.json({ error: "Missing disciplineSlug" }, { status: 400 });
    }

    if (teamNames.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const results = await Promise.all(
      teamNames.map(async (rawName) => {
        const bestMatch = await findClosestPlatformTeam(disciplineSlug, rawName, 0.9, { minScoreGap: 0.1 });
        return {
          rawName,
          suggestedPlatformId: bestMatch?.platformId ?? null,
          suggestedPlatformName: bestMatch?.platformName ?? null,
          matchedName: bestMatch?.matchedName ?? null,
          matchMethod: bestMatch?.matchMethod ?? null,
          score: bestMatch?.score ?? 0,
        };
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    logApiError("api:team-mapping/fuzzy/route.ts", error);
    return NextResponse.json(
      { error: error instanceof Error ? safeErrorMessage(error) : "Internal Server Error" },
      { status: 500 }
    );
  }
}
