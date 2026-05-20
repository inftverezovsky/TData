import { isPlaceholderTeam } from "@/lib/teams/teams";
import { createHash } from "crypto";

export interface TbdMatchLike {
  matchId?: string | null;
  lpNumericalId?: bigint | null;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  teamAId?: string | null;
  teamBId?: string | null;
  teamAName?: string | null;
  teamBName?: string | null;
  stage?: string | null;
  round?: string | null;
  hasPlaceholderTeams?: boolean | null;
}

export function createStableMatchId(input: {
  sourceTitle: string;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  teamAId?: string | null;
  teamBId?: string | null;
  stage?: string | null;
  round?: string | null;
  extraHint?: string | null;
}): string {
  const data = [
    input.sourceTitle,
    input.matchDate?.toISOString() ?? "",
    input.matchDateTime ?? "",
    input.teamAId ?? "unknownA",
    input.teamBId ?? "unknownB",
    input.stage ?? "",
    input.round ?? "",
    input.extraHint ?? ""
  ].join("|");
  const hash = createHash("md5").update(data).digest("hex").slice(0, 12);
  return `match_${hash}`;
}

export function stringToNumericalId(str: string): bigint {
  const hash = createHash("md5").update(str).digest("hex").slice(0, 12);
  return BigInt("0x" + hash);
}

export function applyTbdPairCycling(matches: TbdMatchLike[], sourceTitle: string) {
  const tbdMatches = matches.filter(m => 
    (!m.teamAName || isPlaceholderTeam(m.teamAName)) && 
    (!m.teamBName || isPlaceholderTeam(m.teamBName))
  );

  if (tbdMatches.length === 0) return;

  tbdMatches.sort((a, b) => {
    const tsA = a.matchDate?.getTime() || 0;
    const tsB = b.matchDate?.getTime() || 0;
    if (tsA !== tsB) return tsA - tsB;
    return (a.stage || "").localeCompare(b.stage || "") || (a.round || "").localeCompare(b.round || "");
  });

  tbdMatches.forEach((m, idx) => {
    const cycle = Math.floor(idx / 8);
    const subIdx = idx % 8;
    
    let tbdANum: number, tbdBNum: number;
    
    if (cycle % 2 === 0) {
      tbdANum = (subIdx * 2) + 1;
      tbdBNum = (subIdx * 2) + 2;
    } else {
      const group = Math.floor(subIdx / 2);
      const offset = subIdx % 2;
      tbdANum = (group * 4) + offset + 1;
      tbdBNum = (group * 4) + offset + 3;
    }

    const tbdA = `TBD${tbdANum}`;
    const tbdB = `TBD${tbdBNum}`;
    
    m.teamAName = tbdA;
    m.teamBName = tbdB;
    m.teamAId = `tbd_${tbdA.toLowerCase()}`;
    m.teamBId = `tbd_${tbdB.toLowerCase()}`;
    m.hasPlaceholderTeams = true;

    // Only update matchId and lpNumericalId if they are not from HLTV (HLTV IDs are prefixed with hltv-)
    if (sourceTitle && (!m.matchId || !m.matchId.startsWith('hltv-'))) {
      m.matchId = createStableMatchId({
        sourceTitle,
        matchDate: m.matchDate,
        matchDateTime: m.matchDateTime,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        stage: m.stage,
        round: m.round,
        extraHint: String(idx)
      });
      m.lpNumericalId = stringToNumericalId(m.matchId);
    }
  });
}
