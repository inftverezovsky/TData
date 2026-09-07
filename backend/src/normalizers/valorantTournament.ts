/** Порядок нормализации: метаданные и участники → HTML/wiki-кандидаты → единые имена и TBD → дедупликация и диагностика. */
import type { NormalizedTournament, NormalizedMatch } from "./valorant/types";
import { extractFirstTemplateByPrefix, parseTemplate, cleanWikiValue } from "@backend/normalizers/wikiText";
import { firstClean, parseValorantWikiDate, inferTournamentStatus } from "./valorant/values";
import * as cheerio from "cheerio";
import { extractParticipants } from "./valorant/participants";
import { extractSubPages } from "./valorant/subPages";
import { extractMatchesFromParsedHtml } from "./valorant/htmlMatches";
import { extractMatchesFromWikitext } from "./valorant/wikitextMatches";
import { normalizeMatchCandidate, dedupeMatches } from "./valorant/matchIdentity";
import { applyTbdPairCycling } from "@backend/matches/tbdCycling";
import { buildEsportsParsingDiagnostics } from "@backend/matches/parsingDiagnostics";
import type { ImportStatus } from "@prisma/client";
export type { NormalizedParticipant } from "./valorant/types";
export type { NormalizedMatch } from "./valorant/types";
export type { NormalizedTournament } from "./valorant/types";
export { stringToNumericalId } from "./valorant/matchIdentity";

/* ───── Main entry point ───── */

export function normalizeValorantTournament(input: {
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
  let startDate = parseValorantWikiDate(params.sdate ?? params.startdate ?? params.start_date ?? params.date ?? params.dates);
  let endDate = parseValorantWikiDate(params.edate ?? params.enddate ?? params.end_date ?? params.date2);
  let location = firstClean(params.location, params.venue, params.city, params.country);
  let region = firstClean(params.region, params.server, params.realm);
  let organizer = firstClean(params.organizer, params.organizer2, params.organizers, params.host);
  let prizePool = firstClean(params.prizepoolusd, params.prizepool, params.prize_pool, params.prize, params.prizemoney);
  let formatText = firstClean(params.format, params.format1, params.format2, params.type);

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
      
      if (!startDate) startDate = parseValorantWikiDate(getInfoboxValue("Start Date:"));
      if (!endDate) endDate = parseValorantWikiDate(getInfoboxValue("End Date:"));
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

  /* ── Extract participants ── */
  const participants = extractParticipants(input.wikitext, input.parsedHtml);

  const teamNameMap = new Map<string, string>();
  participants.forEach(p => {
    teamNameMap.set(p.name.toLowerCase(), p.name);
    if (p.rawText) {
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

  /* ── Extract matches ── */
  const htmlMatches = input.parsedHtml
    ? extractMatchesFromParsedHtml(input.parsedHtml, input.pageUrl)
    : [];
  const wikiMatches = extractMatchesFromWikitext(input.wikitext);

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
  const valorantDiagnostics = buildEsportsParsingDiagnostics({
    source: "liquipedia",
    rawCandidates: allCandidates.length,
    candidates: normalizedMatches,
    savedMatches: matches.length,
    duplicateMatches: Math.max(0, normalizedMatches.length - matches.length),
  });

  if (matches.length === 0) {
    const diag: string[] = [];
    if (input.parsedHtml) {
      const $ = cheerio.load(input.parsedHtml);
      diag.push(`Parsed HTML: ${$(".brkts-match").length} matches`);
    }
    warnings.push(`Матчи не извлечены. ${diag.join(". ")}`);
  }

  const tournamentStatus = inferTournamentStatus(startDate, endDate);
  const hasReal = matches.length > 0 || participants.length > 0;
  const status: ImportStatus = matches.length > 0 ? "SUCCESS" : hasReal ? "PARTIAL" : "PARTIAL";

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
    status,
    valorantDiagnostics
  };
}
