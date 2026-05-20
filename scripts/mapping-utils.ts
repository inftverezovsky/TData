import { readSheet } from 'read-excel-file/node';
import { PrismaClient } from '@prisma/client';
import { normalizeTeamName } from '../src/lib/teams/teams';
import levenshtein from 'fast-levenshtein';
import fs from 'fs';

const prisma = new PrismaClient();

function findColumns(headers: string[]) {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  
  const idCandidates = ['platformid', 'id', 'team_id', 'teamid'];
  const nameCandidates = ['teamname', 'name', 'team', 'название', 'team name', 'команда'];
  
  let idCol = -1;
  let nameCol = -1;
  
  for (let i = 0; i < normalizedHeaders.length; i++) {
    const h = normalizedHeaders[i];
    if (idCol === -1 && idCandidates.includes(h)) idCol = i;
    if (nameCol === -1 && nameCandidates.includes(h)) nameCol = i;
  }
  
  return { idCol, nameCol };
}

export async function processAdminTeamsImport(filePath: string, disciplineSlug: string = 'dota2') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  console.log(`Reading file: ${filePath}`);
  const data = await readSheet(filePath);
  if (data.length < 2) {
    throw new Error('File has no data');
  }
  
  const headers = data[0].map((cell) => String(cell ?? ''));
  const { idCol, nameCol } = findColumns(headers);
  
  if (idCol === -1 || nameCol === -1) {
    throw new Error(`Could not determine columns. Found headers: ${headers.join(', ')}. Need ID and Name.`);
  }
  
  console.log(`Found ID column at index ${idCol} ("${headers[idCol]}") and Name column at index ${nameCol} ("${headers[nameCol]}")`);
  
  let importedCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const id = row[idCol] ? String(row[idCol]).trim() : '';
    const name = row[nameCol] ? String(row[nameCol]).trim() : '';
    
    if (!id || !name) continue;
    
    const normalizedName = normalizeTeamName(name);
    
    // Upsert admin team
    const existing = await prisma.adminTeam.findFirst({
      where: { disciplineSlug, platformId: id }
    });
    
    if (existing) {
      await prisma.adminTeam.update({
        where: { id: existing.id },
        data: { platformName: name, normalizedName, sourceFileName: filePath }
      });
    } else {
      await prisma.adminTeam.create({
        data: {
          disciplineSlug,
          platformId: id,
          platformName: name,
          normalizedName,
          sourceFileName: filePath
        }
      });
    }
    importedCount++;
  }
  
  console.log(`Imported/Updated ${importedCount} admin teams from file.`);
  
  // Now run automapping for discipline
  return await runAutoMapping(disciplineSlug);
}

export async function runAutoMapping(disciplineSlug: string) {
  const adminTeams = await prisma.adminTeam.findMany({
    where: { disciplineSlug }
  });
  
  const mappings = await prisma.teamMapping.findMany({
    where: { 
      disciplineSlug,
      status: {
        in: ['unmapped', 'ambiguous']
      },
      isLockedFromAutoMapping: false
    }
  });
  
  let autoMappedCount = 0;
  let ambiguousCount = 0;
  let unmappedCount = 0;
  
  const topMapped: any[] = [];
  const ambiguousList: any[] = [];
  const unmappedList: any[] = [];

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
      if (candidates.length > 1) {
        secondBestScore = candidates[1].score;
      }
    }
    
    if (bestScore >= 90) {
      if (bestScore - secondBestScore < 3 && secondBestScore >= 90) {
        // Ambiguous
        await prisma.teamMapping.update({
          where: { id: mapping.id },
          data: { status: 'ambiguous' }
        });
        ambiguousCount++;
        ambiguousList.push({ liqName: mapping.liquipediaName, score: bestScore, bestAdmin: bestAdminTeam.platformName, secondAdmin: candidates[1].admin.platformName });
      } else {
        // Auto map
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
        if (topMapped.length < 20) {
          topMapped.push({ liqName: mapping.liquipediaName, adminName: bestAdminTeam.platformName, score: bestScore.toFixed(2) });
        }
      }
    } else {
      unmappedCount++;
      unmappedList.push(mapping.liquipediaName);
    }
  }
  
  return {
    adminTeamsCount: adminTeams.length,
    liquipediaTeamsFound: mappings.length,
    autoMappedCount,
    ambiguousCount,
    unmappedCount,
    topMapped,
    ambiguousList,
    unmappedList
  };
}
