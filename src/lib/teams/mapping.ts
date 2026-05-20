import { prisma } from "@/lib/db/db";
import { normalizeTeamName, isPlaceholderTeam } from "@/lib/teams/teams";
import levenshtein from "fast-levenshtein";

export async function ensureTeamMappingsForTournament(tournamentId: string, disciplineSlug: string = "dota2") {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      participants: true,
      matches: true
    }
  });

  if (!tournament) return;

  const teamNames = new Set<string>();
  tournament.participants.forEach(p => {
    if (p.name) teamNames.add(p.name);
  });
  tournament.matches.forEach(m => {
    if (m.teamAName) teamNames.add(m.teamAName);
    if (m.teamBName) teamNames.add(m.teamBName);
  });

  const realTeams = Array.from(teamNames).filter(name => !isPlaceholderTeam(name));

  for (const name of realTeams) {
    await prisma.teamMapping.upsert({
      where: {
        disciplineSlug_liquipediaName: {
          disciplineSlug,
          liquipediaName: name
        }
      },
      update: {},
      create: {
        disciplineSlug,
        liquipediaName: name,
        liquipediaNormalizedName: normalizeTeamName(name)
      }
    });
  }

  return await runAutoMappingForDiscipline(disciplineSlug);
}

export async function runAutoMappingForDiscipline(disciplineSlug: string) {
  const adminTeams = await prisma.adminTeam.findMany({
    where: { disciplineSlug }
  });

  if (adminTeams.length === 0) return { autoMappedCount: 0, ambiguousCount: 0, unmappedCount: 0 };

  const mappings = await prisma.teamMapping.findMany({
    where: {
      disciplineSlug,
      status: { in: ['unmapped', 'ambiguous'] },
      isLockedFromAutoMapping: false
    }
  });

  let autoMappedCount = 0;
  let ambiguousCount = 0;
  let unmappedCount = 0;
  const newlyMappedNames: string[] = [];

  for (const mapping of mappings) {
    const liqName = mapping.liquipediaNormalizedName || normalizeTeamName(mapping.liquipediaName);
    if (!liqName) continue;

    let bestScore = 0;
    let secondBestScore = 0;
    let bestAdminTeam: any = null;
    let candidates: any[] = [];

    for (const admin of adminTeams) {
      const distance = levenshtein.get(liqName, admin.normalizedName);
      const maxLength = Math.max(liqName.length, admin.normalizedName.length);
      const score = maxLength === 0 ? 100 : (1 - distance / maxLength) * 100;
      candidates.push({ admin, score });
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      bestScore = candidates[0].score;
      bestAdminTeam = candidates[0].admin;
      if (candidates.length > 1) secondBestScore = candidates[1].score;
    }

    if (bestScore >= 90) {
      if (bestScore - secondBestScore < 3 && secondBestScore >= 90) {
        await prisma.teamMapping.update({
          where: { id: mapping.id },
          data: { status: 'ambiguous', confidenceScore: bestScore, matchMethod: 'levenshtein' }
        });
        ambiguousCount++;
      } else {
        await prisma.teamMapping.update({
          where: { id: mapping.id },
          data: {
            platformId: bestAdminTeam.platformId,
            canonicalName: bestAdminTeam.platformName,
            confidenceScore: bestScore,
            matchMethod: 'levenshtein',
            status: 'auto_mapped'
          }
        });
        autoMappedCount++;
        newlyMappedNames.push(mapping.liquipediaName);
        
        // Also update existing participants in the database for this team name
        await prisma.tournamentParticipant.updateMany({
          where: { name: mapping.liquipediaName, tournament: { disciplineSlug } },
          data: { platformId: bestAdminTeam.platformId }
        });
      }
    } else {
      unmappedCount++;
    }
  }

  return { autoMappedCount, ambiguousCount, unmappedCount, newlyMappedNames };
}
