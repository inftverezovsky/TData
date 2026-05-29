import { NextResponse } from "next/server";
import { buildAdminTeamSuggestions } from "@/lib/adminTeams/suggest";
import { getCachedAdminTeamsForSuggest } from "@/lib/adminTeams/suggestCache";
import { normalizeFuzzyName } from "@/lib/teams/fuzzyMatch";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const disciplineSlug = String(searchParams.get("disciplineSlug") || "").trim().toLowerCase();
  const query = String(searchParams.get("q") || "").trim();
  const limit = clampLimit(searchParams.get("limit"));

  if (!disciplineSlug) {
    return NextResponse.json({ error: "Missing disciplineSlug" }, { status: 400 });
  }

  if (normalizeFuzzyName(query).length < 2) {
    return NextResponse.json({ items: [], adminTeamsCount: null, minQueryLength: 2 });
  }

  const adminTeams = await getCachedAdminTeamsForSuggest(disciplineSlug);

  return NextResponse.json({
    items: buildAdminTeamSuggestions(adminTeams, query, limit),
    adminTeamsCount: adminTeams.length,
    minQueryLength: 2,
  });
}

function clampLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(20, Math.trunc(parsed)));
}
