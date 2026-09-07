import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  try {
    const { id } = await params;
    const tournament = await prisma.tournament.findUnique({
      where: { id: id },
      include: {
        participants: true,
        matches: true,
        lastImport: {
          select: { finishedAt: true, status: true, errorMessage: true }
        }
      }
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...tournament,
      matches: dedupeTournamentMatches(tournament.matches)
    });
  } catch (error) {
    logApiError("api:[disciplineSlug]/tournament/[id]/route.ts", error);
    return apiErrorResponse(error);
  }
}
