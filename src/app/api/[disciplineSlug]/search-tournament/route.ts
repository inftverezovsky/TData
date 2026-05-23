import { prisma } from "@/lib/db/db";
import { getKnownDisciplineApiUrl, isKnownDisciplineSlug } from "@/lib/config/disciplines";
import { createSearchTournamentPostRoute } from "@/lib/liquipedia/searchRoute";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const slug = disciplineSlug.trim().toLowerCase();
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  if (!isKnownDisciplineSlug(slug)) {
    return NextResponse.json({ error: "Unsupported discipline" }, { status: 404 });
  }

  const routeHandler = createSearchTournamentPostRoute({
    disciplineSlug: slug,
    getDiscipline: async () => {
      const discipline = await prisma.discipline.findUnique({
        where: { slug },
        select: { id: true, baseApiUrl: true },
      });
      if (!discipline) {
        throw new Error("Discipline is not configured. Run database seed first.");
      }
      return discipline;
    },
    defaultApiUrl: getKnownDisciplineApiUrl(slug),
  });

  return routeHandler(request);
}
