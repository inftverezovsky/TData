/** Порядок нормализации: метаданные и участники → HTML/wiki-кандидаты → единые имена и TBD → дедупликация и диагностика. */
import type { NormalizedTournament, NormalizedMatch } from "./counterstrike/types";
import { extractFirstTemplateByPrefix, parseTemplate, cleanWikiValue, parseWikiDate, extractTemplatesByNamePrefix } from "@backend/normalizers/wikiText";
import { firstClean, getCounterStrikeDateOptions, inferTournamentStatus } from "./counterstrike/values";
import * as cheerio from "cheerio";
import { extractParticipants } from "./counterstrike/participants";
import { extractSubPages } from "./counterstrike/subPages";
import { extractMatchesFromParsedHtml } from "./counterstrike/htmlMatches";
import { extractMatchesFromWikitext } from "./counterstrike/wikitextMatches";
import { normalizeMatchCandidate, dedupeMatches } from "./counterstrike/matchIdentity";
import { applyTbdPairCycling } from "@backend/matches/tbdCycling";
import type { ImportStatus } from "@prisma/client";
export type { NormalizedParticipant } from "./counterstrike/types";
export type { NormalizedMatch } from "./counterstrike/types";
export type { NormalizedTournament } from "./counterstrike/types";
export { createStableTeamId } from "./counterstrike/matchIdentity";
export { stringToNumericalId } from "./counterstrike/matchIdentity";
export { generateTeamId } from "./counterstrike/matchIdentity";

/* ───── Main entry point ───── */

export function normalizeCounterStrikeTournament(input: {
  pageId?: number;
  title: string;
  pageUrl: string;
  wikitext: string;
  parsedHtml?: string;
}): NormalizedTournament {
  const warnings: string[] = [];
  const infobox = extractFirstTemplateByPrefix(input.wikitext, "Infobox");
  const parsedInfobox = infobox ? parseTemplate(infobox) : null;

  const params = parsedInfobox?.params ?? {};
  let name = firstClean(params.name, params.tournament, params.event, params.league) ?? cleanWikiValue(input.title) ?? input.title;
  let startDate = parseWikiDate(params.sdate ?? params.startdate ?? params.start_date ?? params.date ?? params.dates);
  let endDate = parseWikiDate(params.edate ?? params.enddate ?? params.end_date ?? params.date2);
  let location = firstClean(params.location, params.venue, params.city, params.country);
  let region = firstClean(params.region, params.server, params.realm);
  let organizer = firstClean(params.organizer, params.organizer2, params.organizers, params.host);
  let prizePool = firstClean(params.prizepoolusd, params.prizepool, params.prize_pool, params.prize, params.prizemoney);
  let formatText = firstClean(params.format, params.format1, params.format2, params.type);
  const dateOptions = getCounterStrikeDateOptions(input, params);

  let teamCount = parseInt(firstClean(params.team_number, params.participant_number, params.teams) ?? "0", 10);
  if (isNaN(teamCount)) teamCount = 0;

  if (input.parsedHtml) {
    const $ = cheerio.load(input.parsedHtml);
    const infoBoxDiv = $(".fo-ntax-infobox");
    
    if (infoBoxDiv.length > 0) {
      if (!name || name === input.title) {
        const titleText = infoBoxDiv.find(".infobox-header").first().text().trim();
        if (titleText) name = titleText;
      }
      
      const getInfoboxValue = (label: string) => {
        const cell = infoBoxDiv.find(`.infobox-cell-2:contains("${label}")`).next(".infobox-cell-2");
        return cell.length ? cell.text().trim() : null;
      };
      
      if (!startDate) startDate = parseWikiDate(getInfoboxValue("Start Date:"));
      if (!endDate) endDate = parseWikiDate(getInfoboxValue("End Date:"));
      if (!location) location = getInfoboxValue("Location:");
      if (!region) region = getInfoboxValue("Region:");
      if (!prizePool) prizePool = getInfoboxValue("Prize Pool:");
      if (!organizer) organizer = getInfoboxValue("Organizer:");
      
      const teamCountStr = getInfoboxValue("Number of teams:");
      if (teamCountStr) {
        const parsed = parseInt(teamCountStr, 10);
        if (!isNaN(parsed)) teamCount = parsed;
      }
    }
  }

  if (!parsedInfobox && !input.parsedHtml) {
    warnings.push("Infobox не найден. Карточка турнира будет неполной.");
  }

  /* ── Extract participants ── */
  const participants = extractParticipants(input.wikitext, input.parsedHtml);

  // Create a mapping from any version of the team name (short, acronym, etc.) to the full name
  const teamNameMap = new Map<string, string>();
  participants.forEach(p => {
    teamNameMap.set(p.name.toLowerCase(), p.name);
    if (p.rawText) {
      // If rawText is "vit" or "[[Team:Team Vitality|vit]]", map the short part too
      const wikiMatch = p.rawText.match(/\|\s*(?:team|link)\s*=\s*([^|}\n]+)/i) || p.rawText.match(/\{\{\s*[^|]+\|\s*([^|}\n]+)/i);
      if (wikiMatch) {
        teamNameMap.set(wikiMatch[1].trim().toLowerCase(), p.name);
      }
    }
  });

  const canonicalize = (name: string | null | undefined) => {
    if (!name) return name;
    const lower = name.toLowerCase();
    return teamNameMap.get(lower) || name;
  };

  /* ── Extract sub-pages ── */
  const subPages = extractSubPages(input.wikitext, input.parsedHtml || "", input.pageUrl);

  /* ── Extract matches: staged pipeline ── */
  const htmlMatches = input.parsedHtml
    ? extractMatchesFromParsedHtml(input.parsedHtml, input.pageUrl, dateOptions)
    : [];
  const wikiMatches = extractMatchesFromWikitext(input.wikitext, dateOptions);

  const allCandidates = [...htmlMatches, ...wikiMatches];
  const normalizedMatches = allCandidates
    .map((c, idx) => {
      const normalized = normalizeMatchCandidate(c, input.title, String(idx));
      if (normalized) {
        normalized.teamAName = canonicalize(normalized.teamAName);
        normalized.teamBName = canonicalize(normalized.teamBName);
      }
      return normalized;
    })
    .filter((m): m is NormalizedMatch => m !== null);

  // Apply TBD pair cycling logic (TBD1-16)
  applyTbdPairCycling(normalizedMatches, input.title);

  const matches = dedupeMatches(normalizedMatches);

  /* ── Diagnostics ── */
  if (participants.length === 0) {
    // warnings.push("Участники не извлечены. Нужно доработать normalizer под конкретную разметку страницы.");
  } else if (teamCount === 0) {
    teamCount = participants.length;
  }

  if (matches.length === 0) {
    const diag: string[] = [];
    if (input.parsedHtml) {
      const $ = cheerio.load(input.parsedHtml);
      const brktMatchCount = $(".brkts-match").length;
      const popupCount = $(".brkts-match-info-popup").length;
      diag.push(`Parsed HTML: ${brktMatchCount} brkts-match, ${popupCount} match-info-popup`);
    } else {
      diag.push("Parsed HTML не загружен");
    }
    const wikiMatchTemplates = extractTemplatesByNamePrefix(input.wikitext, "Match", 50);
    const nonEmpty = wikiMatchTemplates.filter((t) => t.length > 15);
    diag.push(`Wikitext: ${wikiMatchTemplates.length} Match templates (${nonEmpty.length} with content)`);
    warnings.push(`Матчи не извлечены. Диагностика: ${diag.join(". ")}.`);
  } else {
    const withDate = matches.filter((m) => m.matchDate).length;
    const withScore = matches.filter((m) => m.scoreA != null).length;
    if (htmlMatches.length > 0) {
      warnings.push(`Извлечено ${matches.length} матчей из parsed HTML (${withDate} с датой, ${withScore} со счётом).`);
    }
  }

  if (!startDate && !endDate) {
    warnings.push("Даты турнира не извлечены из infobox.");
  }

  const tournamentStatus = inferTournamentStatus(startDate, endDate);
  const hasReal = matches.length > 0 || participants.length > 0;
  const hasWarningIssues = warnings.some((w) =>
    w.includes("не извлечены") && !w.includes("Извлечено")
  );
  const status: ImportStatus = !hasWarningIssues ? "SUCCESS" : hasReal ? "PARTIAL" : "PARTIAL";

  return {
    sourcePageId: input.pageId,
    sourceTitle: input.title,
    sourceUrl: input.pageUrl,
    name,
    startDate,
    endDate,
    location,
    region,
    organizer,
    prizePool,
    formatText,
    tournamentStatus,
    participants,
    matches,
    subPages,
    warnings,
    status
  };
}
