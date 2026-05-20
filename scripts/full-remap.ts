import { prisma } from '../src/lib/db/db';
import { normalizeTeamName, isPlaceholderTeam } from '../src/lib/teams/teams';
import { runAutoMappingForDiscipline } from '../src/lib/teams/mapping';

async function main() {
  const disciplineSlug = 'dota2';
  
  // Collect all unique team names from participants and matches
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournament: { disciplineSlug } },
    select: { name: true }
  });
  
  const matchesA = await prisma.tournamentMatch.findMany({
    where: { tournament: { disciplineSlug } },
    select: { teamAName: true }
  });
  
  const matchesB = await prisma.tournamentMatch.findMany({
    where: { tournament: { disciplineSlug } },
    select: { teamBName: true }
  });
  
  const names = new Set<string>();
  participants.forEach(p => names.add(p.name));
  matchesA.forEach(m => m.teamAName && names.add(m.teamAName));
  matchesB.forEach(m => m.teamBName && names.add(m.teamBName));
  
  const realTeams = Array.from(names).filter(n => !isPlaceholderTeam(n));
  console.log(`Found total unique teams in DB for Dota 2: ${realTeams.length}`);
  
  // Upsert into TeamMapping
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
  
  // Run auto-mapping
  const result = await runAutoMappingForDiscipline(disciplineSlug);
  console.log('--- AUTO-MAPPING RESULTS ---');
  console.log(`Newly mapped: ${result.newlyMappedNames?.length || 0}`);
  console.log(`Ambiguous: ${result.ambiguousCount}`);
  console.log(`Unmapped: ${result.unmappedCount}`);
  
  if (result.newlyMappedNames && result.newlyMappedNames.length > 0) {
    console.log('\nNewly mapped teams:');
    result.newlyMappedNames.forEach((n: string) => console.log(`  - ${n}`));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
