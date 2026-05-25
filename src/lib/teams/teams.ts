/**
 * Generates a stable internal ID for a team based on its Liquipedia name.
 */
export function generateInternalTeamId(name: string): string {
  if (!name) return "tbd";
  
  const lowerName = name.toLowerCase().trim();
  if (isPlaceholderTeam(lowerName)) {
    return "tbd";
  }

  const cleaned = name
    .replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2') // remove wiki links [[A|B]] -> B
    .replace(/\{\{[^}]+\}\}/g, '') // remove wiki templates {{Flag|...}}
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/[^a-z0-9-]/g, '') // remove unsafe chars
    .replace(/-+/g, '-') // remove double hyphens
    .replace(/^-+|-+$/g, ''); // trim hyphens

  return `team_${cleaned}`;
}

/**
 * Checks if a team name is a placeholder (seed, winner of, TBD, etc.)
 */
export function isTbdPlaceholderTeam(name: string | null | undefined): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return n === "tbd" || /^tbd\d+$/.test(n);
}

export function isPlaceholderTeam(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  
  if (isTbdPlaceholderTeam(n)) return true;
  if (n.includes("{{") || n.includes("}}")) return true;
  if (/(?:-->|<--|->|<-|→|←|⇒|⇐)/.test(n)) return true;
  if (!/[a-zа-я0-9#]/i.test(n)) return true;
  if (/^(?:-+|—|–|->|-->|<-|<--|→|←|⇒|⇐|n\/a|na|bye)$/i.test(n)) return true;

  // Basic placeholders
  if (["tba", "slot", "seed", "qualified team", "unknown", "placeholder", "teamopponent", "literalopponent"].includes(n)) return true;

  // Real Counter-Strike org. This conflicts with Liquipedia seed labels like A1/B2/G2.
  if (n === "g2") return false;

  // Liquipedia bracket seeds like #1, #8, #10 are not team names.
  if (/^#\s*\d{1,3}$/.test(n)) return true;
  
  // Bracket seeds (A1, B2, C12, etc.) - expanded range
  if (/^[a-h][1-9][0-9]?$/i.test(n)) return true;

  // Dynamic placeholders
  if (n.startsWith("winner of")) return true;
  if (n.startsWith("loser of")) return true;
  if (n.includes("qualified")) return true;
  if (n.includes("seed")) return true;
  if (n.includes("group")) return true;
  if (n.includes("bracket")) return true;
  if (/\b(?:winner|loser|runner[-\s]?up)\b/.test(n)) return true;
  if (/\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth)\s+place\b/.test(n)) return true;
  
  return false;
}

export function normalizeTeamName(name: string): string {
  if (!name) return "";
  let n = name.trim().toLowerCase();
  
  // Remove wiki markup
  n = n.replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2');
  n = n.replace(/\{\{[^}]+\}\}/g, '');
  
  // Replace ё with е
  n = n.replace(/ё/g, 'е');
  
  // Remove dots, commas, parentheses
  n = n.replace(/[.,()]/g, '');
  
  // Normalize hyphens to spaces
  n = n.replace(/[-_]/g, ' ');
  
  // Remove special characters, keeping letters, numbers, and spaces
  n = n.replace(/[^\w\sа-я]/g, '');
  
  // Remove extra spaces
  n = n.replace(/\s+/g, ' ').trim();
  
  return n;
}

export function getTeamNameCandidates(name: string): string[] {
  const normalized = normalizeTeamName(name);
  if (!normalized) return [];
  const candidates = [normalized];
  
  if (normalized.includes(' team')) {
    candidates.push(normalized.replace(/ team/g, '').trim());
  } 
  if (normalized.startsWith('team ')) {
    candidates.push(normalized.replace(/^team /g, '').trim());
  }
  
  // Also push without any 'team'
  const withoutTeam = normalized.replace(/\bteam\b/g, '').replace(/\s+/g, ' ').trim();
  if (withoutTeam && withoutTeam !== normalized) {
    candidates.push(withoutTeam);
  }
  
  return Array.from(new Set(candidates)).filter(Boolean);
}
