import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { prisma } from "@backend/db/db";
import { getKnownDisciplineApiUrl, isKnownDisciplineSlug } from "@backend/config/disciplines";
import { createSearchTournamentPostRoute } from "@backend/sources/tdata/liquipedia/searchRoute";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  try {
    const { disciplineSlug } = await params;
    const slug = disciplineSlug.trim().toLowerCase();

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
  } catch (error) {
    logApiError("api:[disciplineSlug]/search-tournament/route.ts", error);
    return apiErrorResponse(error);
  }
}
