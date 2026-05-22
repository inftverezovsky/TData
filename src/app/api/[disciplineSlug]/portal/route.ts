import { NextResponse } from "next/server";
import { fetchDisciplinePortal } from "@/lib/liquipedia/portal";
import { prisma } from "@/lib/db/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ disciplineSlug: string }> }) {
  const { disciplineSlug } = await params;
  const slug = disciplineSlug;
  
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.has("t");
    
    const data = await fetchDisciplinePortal(slug, force);

    if (data.tournaments.length === 0) {
      return NextResponse.json(data);
    }

    const urls = data.tournaments.map(t => t.url);

    // 1. Fetch tournaments from DB to get their internal IDs
    const dbTournaments = await prisma.tournament.findMany({
      where: { 
        sourceUrl: { in: urls },
        disciplineSlug: slug
      },
      select: { id: true, sourceUrl: true }
    }).catch(err => {
      console.error("[Portal API] DB Error 1:", err.message);
      return [];
    });

    const dbMap = new Map(dbTournaments.map((dt: any) => [dt.sourceUrl, dt]));
    const dbIds = dbTournaments.map((t: any) => t.id);

    // 2. Fetch stats and placeholders in PARALLEL
    const [matchStats, withPlaceholders] = await Promise.all([
      dbIds.length > 0 ? prisma.tournamentMatch.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: dbIds } },
        _count: { id: true, syncedAt: true }
      }).catch(err => {
        console.error("[Portal API] MatchStats Error:", err.message);
        return [];
      }) : Promise.resolve([]),

      dbIds.length > 0 ? prisma.tournamentMatch.findMany({
        where: {
          tournamentId: { in: dbIds },
          OR: [
            { hasPlaceholderTeams: true },
            { teamAName: null },
            { teamAName: { contains: "TBD" } },
            { teamAName: { contains: "TBA" } },
            { teamBName: null },
            { teamBName: { contains: "TBD" } },
            { teamBName: { contains: "TBA" } }
          ]
        },
        select: { tournamentId: true },
        distinct: ['tournamentId']
      }).catch(err => {
        console.error("[Portal API] Placeholders Error:", err.message);
        return [];
      }) : Promise.resolve([])
    ]);

    const statsMap = new Map(matchStats.map(s => [s.tournamentId, s]));
    const placeholdersSet = new Set(withPlaceholders.map(p => p.tournamentId));

    // Enrich with DB status
    const enrichedTournaments = data.tournaments.map((t) => {
      const dbTournament = dbMap.get(t.url);
      if (!dbTournament) return { ...t, dbStatus: 'not_loaded' as const };

      const stats = statsMap.get(dbTournament.id);
      const totalMatches = stats?._count.id || 0;
      const syncedMatches = stats?._count.syncedAt || 0;

      if (totalMatches === 0) return { ...t, dbStatus: 'not_loaded' as const, dbId: dbTournament.id };
      if (totalMatches === syncedMatches) return { ...t, dbStatus: 'synced' as const, dbId: dbTournament.id };
      if (placeholdersSet.has(dbTournament.id)) return { ...t, dbStatus: 'announcements' as const, dbId: dbTournament.id };

      return { ...t, dbStatus: 'ready' as const, dbId: dbTournament.id };
    });

    return NextResponse.json({ ...data, tournaments: enrichedTournaments });
  } catch (err: any) {
    console.error(`[Portal API] Error:`, err);
    return NextResponse.json({ error: "Failed to fetch portal data", details: err.message }, { status: 500 });
  }
}
