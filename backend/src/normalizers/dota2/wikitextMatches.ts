/** Прочитать вложенные wiki-шаблоны и слоты сетки. Пустые будущие слоты сохраняются как кандидаты для обработки TBD. */
import type { NormalizedMatch } from "./types";
import { extractTemplatesByNamePrefix, parseTemplate, extractFirstTemplateByPrefix, extractBalancedTemplate, parseInteger, parseTeamOpponentScore } from "@backend/normalizers/wikiText";
import { firstClean, isLikelyLayoutNoise, normalizeTeamName, normalizeDota2DateText, buildTemplateDateText, parseDota2WikiDate } from "./values";
import { getBestOfLabel } from "@backend/matches/format";

/* ───── Extract matches from wikitext (fallback) ───── */

type BracketWikitextMatchEntry = {
  match: NormalizedMatch;
  template: string;
};

export function extractMatchesFromWikitext(wikitext: string): NormalizedMatch[] {
  const bracketEntries = extractBracketMatchEntriesFromWikitext(wikitext);
  const bracketTemplateSet = new Set(bracketEntries.map((entry) => entry.template));
  const templates = [
    ...extractTemplatesByNamePrefix(wikitext, "Match", 400),
    ...extractTemplatesByNamePrefix(wikitext, "BracketMatch", 400)
  ].filter((template) => !bracketTemplateSet.has(template));

  const matches: NormalizedMatch[] = bracketEntries.map((entry) => entry.match);

  for (const template of templates) {
    const match = buildMatchFromWikitextTemplate(template);
    if (!match) continue;
    matches.push(match);

    if (matches.length >= 200) break;
  }

  return matches;
}

function extractBracketMatchEntriesFromWikitext(wikitext: string): BracketWikitextMatchEntry[] {
  const bracketTemplates = extractBracketTemplates(wikitext);
  const entries: BracketWikitextMatchEntry[] = [];

  for (const bracketTemplate of bracketTemplates) {
    const parsed = parseTemplate(bracketTemplate);
    const params = parsed.params;
    const bracketStage = firstClean(params.matchsection, params.section, params.stage);
    const slotLabels = buildBracketSlotLabels(bracketTemplate, params);

    for (const [key, value] of Object.entries(params)) {
      const slotMatch = key.match(/^r(?:\d+|x)m(?:\d+|[a-z]+)$/i);
      if (!slotMatch) continue;

      const matchTemplate = extractFirstTemplateByPrefix(value, "Match");
      if (!matchTemplate) continue;

      const slot = slotMatch[0].toUpperCase();
      const match = buildMatchFromWikitextTemplate(matchTemplate, {
        stage: bracketStage,
        round: slotLabels.get(slot),
        keepEmptyPlaceholders: true,
      });
      if (!match) continue;

      entries.push({ match, template: matchTemplate });
    }
  }

  return entries;
}

function extractBracketTemplates(wikitext: string) {
  const regex = /\{\{\s*Bracket(?:\/[^\s|{}]+)?(?=\s*(?:\||\}\}))/gi;
  const templates: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(wikitext)) && templates.length < 100) {
    const template = extractBalancedTemplate(wikitext, match.index);
    if (template) templates.push(template);
    regex.lastIndex = match.index + 2;
  }

  return templates;
}

function buildBracketSlotLabels(bracketTemplate: string, params: Record<string, string>) {
  const labels = new Map<string, string>();
  let currentLabel: string | null = null;
  const slotRegex = /^[\t ]*(?:<!--\s*([^\r\n]*?)\s*-->\s*)?\|\s*(R(?:\d+|x)M(?:\d+|[A-Za-z]+))(header)?\s*=/gim;
  let match: RegExpExecArray | null;

  while ((match = slotRegex.exec(bracketTemplate))) {
    const slot = match[2].toUpperCase();
    const commentLabel = cleanBracketSlotLabel(match[1]);
    const headerLabel = cleanBracketSlotLabel(params[`${slot.toLowerCase()}header`]);
    const exactLabel = headerLabel || commentLabel;

    if (exactLabel) currentLabel = exactLabel;
    if (!match[3]) {
      const label = exactLabel || currentLabel;
      if (label) labels.set(slot, label);
    }
  }

  return labels;
}

function cleanBracketSlotLabel(value: string | null | undefined) {
  const cleaned = firstClean(value);
  if (!cleaned || isLikelyLayoutNoise(cleaned)) return null;
  return cleaned;
}

function buildMatchFromWikitextTemplate(
  template: string,
  context: {
    stage?: string | null;
    round?: string | null;
    keepEmptyPlaceholders?: boolean;
  } = {}
): NormalizedMatch | null {
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

  if (!rawTeamA && !rawTeamB && !context.keepEmptyPlaceholders) return null;

  const teamAName = rawTeamA ? (normalizeTeamName(rawTeamA) ?? rawTeamA) : "TBD";
  const teamBName = rawTeamB ? (normalizeTeamName(rawTeamB) ?? rawTeamB) : "TBD";
  const dateText = normalizeDota2DateText(buildTemplateDateText(params));
  const dateVal = parseDota2WikiDate(dateText);
  const formatText = firstClean(params.bestof, params.bo, params.format, params.matchtype, params.type);

  return {
    stage: firstClean(params.stage, params.section, context.stage),
    round: firstClean(params.round, params.match, params.title, context.round),
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
  };
}
