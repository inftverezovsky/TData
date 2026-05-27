import { NextResponse } from "next/server";
import { findClosestPlatformTeam } from "@/lib/teams/fuzzyMatch";

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
        const bestMatch = await findClosestPlatformTeam(disciplineSlug, rawName);
        return {
          rawName,
          suggestedPlatformId: bestMatch?.platformId ?? null,
          suggestedPlatformName: bestMatch?.platformName ?? null,
          score: bestMatch?.score ?? 0,
        };
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[Fuzzy Match API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
