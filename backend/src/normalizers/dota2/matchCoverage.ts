/** Сопоставить HTML и wikitext до нормализации: сохранить более точные сведения, не потеряв отдельные раунды и будущие слоты. */
import type { NormalizedMatch } from "./types";
import { hasExplicitTimeText } from "@backend/matches/time";
import { parseDota2WikiDate, normalizeDota2DateText } from "./values";
import { getBestOfLabel } from "@backend/matches/format";
import { isPlaceholderTeam } from "@backend/teams/teams";
import { cleanWikiValue } from "@backend/normalizers/wikiText";

export function filterParsedHtmlDateOnlyMatchesCoveredByWikitext(
  htmlMatches: NormalizedMatch[],
  wikiMatches: NormalizedMatch[]
) {
  if (htmlMatches.length === 0 || wikiMatches.length === 0) return htmlMatches;

  const wikiCoverage = new Map<string, number>();
  for (const match of wikiMatches) {
    const key = getDateOnlyRealPlaceholderCoverageKey(match);
    if (!key) continue;
    wikiCoverage.set(key, (wikiCoverage.get(key) || 0) + 1);
  }

  return htmlMatches.filter((match) => {
    const key = getDateOnlyRealPlaceholderCoverageKey(match);
    if (!key) return true;

    const remaining = wikiCoverage.get(key) || 0;
    if (remaining <= 0) return true;

    wikiCoverage.set(key, remaining - 1);
    return false;
  });
}

export function filterWikitextMatchesCoveredByParsedHtml(
  wikiMatches: NormalizedMatch[],
  htmlMatches: NormalizedMatch[]
) {
  if (wikiMatches.length === 0 || htmlMatches.length === 0) return wikiMatches;

  const coverage = new Map<string, number>();
  for (const match of htmlMatches) {
    const key = getParsedCoverageKey(match);
    if (!key) continue;
    coverage.set(key, (coverage.get(key) || 0) + 1);
  }

  return wikiMatches.filter((match) => {
    const key = getParsedCoverageKey(match);
    if (!key) return true;

    const remaining = coverage.get(key) || 0;
    if (remaining <= 0) return true;

    coverage.set(key, remaining - 1);
    return false;
  });
}

function getDateOnlyRealPlaceholderCoverageKey(match: NormalizedMatch) {
  if (hasExplicitTimeText(match.matchDateTime, match.rawText)) return null;

  const dateKey = getDateOnlyCoverageDateKey(match);
  if (!dateKey) return null;

  const teamShape = getCoverageTeamShape(match);
  if (!teamShape.includes("placeholder")) return null;
  if (teamShape === "placeholder|placeholder") return null;

  return [dateKey, teamShape].join("|");
}

function getDateOnlyCoverageDateKey(match: NormalizedMatch) {
  const date = match.matchDate ? new Date(match.matchDate) : parseDota2WikiDate(match.matchDateTime);
  if (!date || !Number.isFinite(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

function getParsedCoverageKey(match: NormalizedMatch) {
  const dateKey = getMatchCoverageDateKey(match);
  if (!dateKey) return null;

  return [
    dateKey,
    normalizeCoverageText(match.stage),
    normalizeCoverageText(match.round),
    getBestOfLabel(match.format) || getBestOfLabel(match.rawText) || "",
    getCoverageTeamShape(match),
  ].join("|");
}

function getMatchCoverageDateKey(match: NormalizedMatch) {
  if (match.matchDate) {
    const date = new Date(match.matchDate);
    if (Number.isFinite(date.getTime())) {
      return `minute:${Math.floor(date.getTime() / 60000)}`;
    }
  }

  const dateText = normalizeDota2DateText(match.matchDateTime);
  if (!dateText) return "";

  return `text:${dateText.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function getCoverageTeamShape(match: NormalizedMatch) {
  const a = normalizeCoverageTeam(match.teamAName);
  const b = normalizeCoverageTeam(match.teamBName);
  if (a === "placeholder" && b === "placeholder") return "placeholder|placeholder";
  return [a, b].sort().join("|");
}

function normalizeCoverageTeam(name: string | null | undefined) {
  if (!name || isPlaceholderTeam(name)) return "placeholder";
  return normalizeCoverageText(name);
}

function normalizeCoverageText(value: string | null | undefined) {
  return cleanWikiValue(value)?.toLowerCase().replace(/\s+/g, " ").trim() || "";
}
