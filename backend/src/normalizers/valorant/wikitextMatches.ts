/** Прочитать шаблоны расписания → извлечь команды, дату и счёт. Шаблон без обеих команд не создаёт матч. */
import type { NormalizedMatch } from "./types";
import { extractTemplatesByNamePrefix, parseTemplate, parseInteger, parseTeamOpponentScore } from "@backend/normalizers/wikiText";
import { firstClean, normalizeTeamName, normalizeValorantDateText, buildTemplateDateText, parseValorantWikiDate } from "./values";
import { getBestOfLabel } from "@backend/matches/format";

export function extractMatchesFromWikitext(wikitext: string): NormalizedMatch[] {
  const templates = [
    ...extractTemplatesByNamePrefix(wikitext, "Match", 400),
    ...extractTemplatesByNamePrefix(wikitext, "BracketMatch", 400),
    ...extractTemplatesByNamePrefix(wikitext, "MatchSchedule", 400),
    ...extractTemplatesByNamePrefix(wikitext, "Matchlist", 400)
  ];

  const matches: NormalizedMatch[] = [];
  for (const template of templates) {
    const parsed = parseTemplate(template);
    const params = parsed.params;
    const rawTeamA = firstClean(params.team1, params.opponent1, params.p1);
    const rawTeamB = firstClean(params.team2, params.opponent2, params.p2);
    if (!rawTeamA && !rawTeamB) continue;

    const teamAName = rawTeamA ? (normalizeTeamName(rawTeamA) ?? rawTeamA) : null;
    const teamBName = rawTeamB ? (normalizeTeamName(rawTeamB) ?? rawTeamB) : null;
    const dateText = normalizeValorantDateText(buildTemplateDateText(params));
    const formatText = firstClean(params.bestof, params.bo, params.format, params.matchtype, params.type);

    matches.push({
      stage: firstClean(params.stage, params.section),
      round: firstClean(params.round, params.match, params.title),
      matchDate: parseValorantWikiDate(dateText),
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA: parseInteger(params.score1 ?? params.games1)
        ?? parseTeamOpponentScore(params.team1 ?? params.opponent1 ?? params.p1),
      scoreB: parseInteger(params.score2 ?? params.games2)
        ?? parseTeamOpponentScore(params.team2 ?? params.opponent2 ?? params.p2),
      format: getBestOfLabel(formatText) || getBestOfLabel(template),
      status: firstClean(params.status, params.finished, params.walkover),
      rawText: template.slice(0, 2500)
    });
  }
  return matches;
}
