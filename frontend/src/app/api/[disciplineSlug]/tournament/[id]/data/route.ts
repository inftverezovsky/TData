import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  const { disciplineSlug, id } = await params;
  try {
    const tournament = await prisma.tournament.findFirst({
      where: {
        id: id,
        disciplineSlug: disciplineSlug,
      },
      include: {
        matches: {
          orderBy: { matchDate: 'asc' }
        }
      }
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...tournament,
      matches: dedupeTournamentMatches(tournament.matches),
    });
  } catch (error) {
    console.error("SWR Fetch error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
