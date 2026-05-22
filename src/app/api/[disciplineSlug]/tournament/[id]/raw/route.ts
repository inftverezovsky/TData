import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { requireAdmin } from "@/lib/auth/adminAuth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  const { disciplineSlug, id } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const tournament = await prisma.tournament.findFirst({
    where: {
      id,
      disciplineSlug,
    },
    select: {
      lastImport: {
        select: {
          rawSnapshots: {
            orderBy: { fetchedAt: "desc" },
            take: 1,
            select: {
              rawWikitext: true,
            },
          },
        },
      },
    },
  });

  if (!tournament) {
    return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  }

  return NextResponse.json({
    rawWikitext: tournament.lastImport?.rawSnapshots[0]?.rawWikitext ?? null,
  });
}
