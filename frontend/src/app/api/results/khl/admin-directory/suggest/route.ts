import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAdmin } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  buildKhlAdminDirectorySearch,
  buildKhlAdminDirectorySuggestions,
} from "@backend/results/khl/adminDirectory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));
  if (query.length > 100) {
    return NextResponse.json({ error: "Search query must not exceed 100 characters." }, { status: 400 });
  }
  const search = buildKhlAdminDirectorySearch(query);
  if (search.kind === "name" && search.anchors.length === 0) {
    return NextResponse.json({ items: [], minQueryLength: 2, confirmationRequired: true });
  }

  const where: Prisma.AdminTeamWhereInput = search.kind === "id"
    ? { platformId: search.exactId }
    : {
      OR: search.anchors.flatMap((anchor) => ([
        { platformName: { contains: anchor, mode: Prisma.QueryMode.insensitive } },
        { platformNameRu: { contains: anchor, mode: Prisma.QueryMode.insensitive } },
        { platformNameEn: { contains: anchor, mode: Prisma.QueryMode.insensitive } },
        { normalizedName: { contains: anchor } },
        { normalizedNameRu: { contains: anchor } },
        { normalizedNameEn: { contains: anchor } },
      ])),
    };
  const candidates = await prisma.adminTeam.findMany({
    where,
    select: {
      disciplineSlug: true,
      platformId: true,
      platformName: true,
      platformNameRu: true,
      platformNameEn: true,
    },
    orderBy: [{ platformName: "asc" }, { platformId: "asc" }],
    take: search.kind === "id" ? 20 : 400,
  });

  return NextResponse.json({
    items: buildKhlAdminDirectorySuggestions(candidates, query, limit),
    candidatePoolCount: candidates.length,
    minQueryLength: 2,
    confirmationRequired: true,
  });
}

function clampLimit(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.trunc(parsed))) : 8;
}
