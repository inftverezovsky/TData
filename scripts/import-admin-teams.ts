import { processAdminTeamsImport } from './mapping-utils';
import fs from 'fs';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Please provide path to an admin teams Excel file. Example: npm run import:dota2-admin-teams -- "C:\\\\path\\\\teams.xlsx"');
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found at ${filePath}`);
    process.exit(1);
  }
  
  try {
    const result = await processAdminTeamsImport(filePath, 'dota2');
    console.log('\n--- MAPPING REPORT ---');
    console.log(`Admin Teams Count: ${result.adminTeamsCount}`);
    console.log(`Liquipedia Teams processed: ${result.liquipediaTeamsFound}`);
    console.log(`Auto Mapped (>=90%): ${result.autoMappedCount}`);
    console.log(`Ambiguous (diff < 3%): ${result.ambiguousCount}`);
    console.log(`Unmapped: ${result.unmappedCount}`);
    
    if (result.topMapped.length > 0) {
      console.log('\nTop 20 Auto Mapped:');
      result.topMapped.forEach(m => console.log(`  ${m.liqName} -> ${m.adminName} (${m.score}%)`));
    }
    
    if (result.ambiguousList.length > 0) {
      console.log('\nAmbiguous:');
      result.ambiguousList.forEach(m => console.log(`  ${m.liqName} -> ? [${m.bestAdmin} vs ${m.secondAdmin}]`));
    }
    
  } catch (err: any) {
    console.error('Error during import:', err.message);
  }
}

main();
