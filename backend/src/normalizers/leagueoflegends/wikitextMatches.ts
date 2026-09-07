/** Прочитать шаблоны расписания → извлечь команды, дату и счёт. Шаблон без обеих команд не создаёт матч. */
import type { NormalizedMatch } from "./types";
import { extractTemplatesByNamePrefix, parseTemplate, parseWikiDate, parseInteger, parseTeamOpponentScore } from "@backend/normalizers/wikiText";
import { firstClean, normalizeTeamName, buildTemplateDateText } from "./values";
import { getBestOfLabel } from "@backend/matches/format";

/* ───── Extract matches from wikitext (fallback) ───── */

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

    const rawTeamA = firstClean(
      params.team1, params.opponent1, params.player1,
      params.p1, params.team_a, params.teama
    );
    const rawTeamB = firstClean(
      params.team2, params.opponent2, params.player2,
      params.p2, params.team_b, params.teamb
    );

    if (!rawTeamA && !rawTeamB) continue;

    const teamAName = rawTeamA ? (normalizeTeamName(rawTeamA) ?? rawTeamA) : null;
    const teamBName = rawTeamB ? (normalizeTeamName(rawTeamB) ?? rawTeamB) : null;

    const dateText = buildTemplateDateText(params);
    const dateVal = parseWikiDate(dateText);

    const formatText = firstClean(params.bestof, params.bo, params.format, params.matchtype, params.type);

    matches.push({
      stage: firstClean(params.stage, params.section),
      round: firstClean(params.round, params.match, params.title),
      matchDate: dateVal,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA: parseInteger(params.score1 ?? params.team1score ?? params.p1score ?? params.games1)
        ?? parseTeamOpponentScore(params.team1 ?? params.opponent1 ?? params.player1 ?? params.p1 ?? params.team_a ?? params.teama),
      scoreB: parseInteger(params.score2 ?? params.team2score ?? params.p2score ?? params.games2)
        ?? parseTeamOpponentScore(params.team2 ?? params.opponent2 ?? params.player2 ?? params.p2 ?? params.team_b ?? params.teamb),
      format: getBestOfLabel(formatText) || getBestOfLabel(template),
      status: firstClean(params.status, params.finished, params.walkover),
      court: firstClean(params.court, params.stream, params.twitch),
      rawText: template.slice(0, 2500)
    });

    if (matches.length >= 200) break;
  }

  return matches;
}
