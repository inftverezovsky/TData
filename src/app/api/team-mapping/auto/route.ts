import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { normalizeTeamName } from "@/lib/teams/teams";
import { runAutoMappingForDiscipline } from "@/lib/teams/mapping";
import { queueIdentitySync } from "@/lib/sync/identitySync";
import { scorePlatformTeamCandidate } from "@/lib/teams/fuzzyMatch";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const { disciplineSlug, liquipediaName } = body as { disciplineSlug: string; liquipediaName?: string };
  
  if (!disciplineSlug) {
    return NextResponse.json({ error: "disciplineSlug обязателен" }, { status: 400 });
  }

  if (liquipediaName) {
    // Single team mapping (manual trigger)
    const mapping = await prisma.teamMapping.findUnique({
      where: {
        disciplineSlug_liquipediaName: {
          disciplineSlug,
          liquipediaName
        }
      }
    });

    if (!mapping) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const adminTeams = await prisma.adminTeam.findMany({
      where: { disciplineSlug }
    });

    const liqName = mapping.liquipediaNormalizedName || normalizeTeamName(mapping.liquipediaName);
    
    let bestScore = 0;
    let secondBestScore = 0;
    let bestAdminTeam: any = null;
    let candidates: any[] = [];
    
    for (const admin of adminTeams) {
      const score = Math.max(
        scorePlatformTeamCandidate(mapping.liquipediaName, admin),
        scorePlatformTeamCandidate(liqName, admin)
      ) * 100;
      candidates.push({ admin, score });
    }
    
    candidates.sort((a, b) => b.score - a.score);
    
    if (candidates.length > 0) {
      bestScore = candidates[0].score;
      bestAdminTeam = candidates[0].admin;
      if (candidates.length > 1) {
        secondBestScore = candidates[1].score;
      }
    }

    let dataToUpdate: any = {
      confidenceScore: bestScore,
      matchMethod: 'token_fuzzy',
      isLockedFromAutoMapping: false
    };

    if (bestScore >= 90) {
      if (bestScore - secondBestScore < 3 && secondBestScore >= 90) {
        dataToUpdate.status = 'ambiguous';
      } else {
        dataToUpdate.status = 'auto_mapped';
        dataToUpdate.platformId = bestAdminTeam.platformId;
        dataToUpdate.canonicalName = bestAdminTeam.platformName;
        
        // Update existing participants
        await prisma.tournamentParticipant.updateMany({
          where: { name: mapping.liquipediaName, tournament: { disciplineSlug } },
          data: { platformId: bestAdminTeam.platformId }
        });
      }
    } else {
      dataToUpdate.status = 'unmapped';
      dataToUpdate.platformId = null;
      dataToUpdate.canonicalName = null;
    }

    const updated = await prisma.teamMapping.update({
      where: { id: mapping.id },
      data: dataToUpdate
    });

    const identitySync = queueIdentitySync(`team-mapping:auto:${disciplineSlug}`);
    return NextResponse.json({ success: true, mapping: updated, identitySync });

  } else {
    // Run for all unmapped
    const result = await runAutoMappingForDiscipline(disciplineSlug);
    const identitySync = queueIdentitySync(`team-mapping:auto:${disciplineSlug}`);
    return NextResponse.json({ success: true, result, identitySync });
  }
}
