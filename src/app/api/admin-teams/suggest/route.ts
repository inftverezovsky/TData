import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { prisma } from "@/lib/db/db";
import { buildAdminTeamSuggestions } from "@/lib/adminTeams/suggest";
import { normalizeFuzzyName } from "@/lib/teams/fuzzyMatch";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

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

  const adminTeams = await prisma.adminTeam.findMany({
    where: { disciplineSlug },
    select: { platformId: true, platformName: true, normalizedName: true },
    orderBy: { platformName: "asc" },
  });

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
