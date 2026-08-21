import { NextResponse } from "next/server";

import { requireAdmin } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const stageId = optionalExternalId(url.searchParams.get("stageId"));
  const limit = Math.min(optionalPositiveInteger(url.searchParams.get("limit")) || 50, 100);
  if (url.searchParams.has("stageId") && !stageId) {
    return NextResponse.json({ error: "stageId must be a positive decimal string." }, { status: 400 });
  }

  const matches = await prisma.khlMatch.findMany({
    where: stageId ? { stageId } : undefined,
    orderBy: [{ startsAt: "desc" }, { khlGameId: "desc" }],
    take: limit,
    include: {
      homeTeam: true,
      awayTeam: true,
      activeRevision: {
        select: {
          id: true,
          revisionNumber: true,
          normalizedHash: true,
          state: true,
          validationIssues: true,
          createdAt: true,
        },
      },
      _count: { select: { revisions: true, participants: true } },
    },
  });
  return NextResponse.json({ matches });
}

function optionalPositiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalExternalId(value: string | null) {
  return value && /^[1-9]\d{0,127}$/.test(value) ? value : null;
}
