import type { ImportStatus } from "@prisma/client";
import * as cheerio from "cheerio";
import {
  cleanWikiValue,
  extractFirstTemplateByPrefix,
  extractSection,
  extractTemplatesByNamePrefix,
  parseInteger,
  parseTemplate,
  parseWikiDate,
  type WikiDateParseOptions
} from "@/lib/normalizers/wikiText";
import { createHash } from "crypto";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";
import { getBestOfLabel } from "@/lib/matches/format";
import { hasExplicitTimeText } from "@/lib/matches/time";
import { findLiquipediaBracketRoundLabel } from "@/lib/liquipedia/bracketLabels";
import {
  buildEsportsParsingDiagnostics,
  type ValorantParsingDiagnostics,
} from "@/lib/matches/parsingDiagnostics";

const VALORANT_LIQUIPEDIA_DATE_OPTIONS: WikiDateParseOptions = {
  timezoneOffsets: {
    // On Chinese Valorant Liquipedia pages CST is China Standard Time.
    CST: 480,
  },
};

/* ───── Types ───── */

export type NormalizedParticipant = {
  name: string;
  seed?: string | null;
  region?: string | null;
  status?: string | null;
  logoUrl?: string | null;
  rawText?: string | null;
};

export type NormalizedMatch = {
  matchId?: string | null;
  lpNumericalId?: bigint | null;
  stage?: string | null;
  round?: string | null;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  teamAId?: string | null;
  teamAName?: string | null;
  teamBId?: string | null;
  teamBName?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  format?: string | null;
  status?: string | null;
  court?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
};

export type NormalizedTournament = {
  sourcePageId?: number;
  sourceTitle: string;
  sourceUrl: string;
  name: string;
  startDate?: Date | null;
  endDate?: Date | null;
  location?: string | null;
  region?: string | null;
  organizer?: string | null;
  prizePool?: string | null;
  formatText?: string | null;
  tournamentStatus?: string | null;
  participants: NormalizedParticipant[];
  matches: NormalizedMatch[];
  subPages: string[];
  warnings: string[];
  status: ImportStatus;
  valorantDiagnostics?: ValorantParsingDiagnostics;
};

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

function extractMatchesFromParsedHtml(html: string, pageUrl: string): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

  const extractDateFromScope = ($scope: any) => {
    const selector = [
      ".timer-object",
      ".match-info-countdown",
      ".brkts-popup-date",
      ".match-bm-date",
      ".brkts-matchlist-date",
      "time",
      "[datetime]",
      "[data-timestamp]",
      "[data-unix]",
      "[data-time]",
      "[data-date]",
    ].join(", ");
    const $candidates = $scope.find(selector);
    let $time = $candidates.filter((_: number, el: any) => {
      const $el = $(el);
      return Boolean(getTimestampAttr($el) || $el.attr("datetime") || $el.attr("data-time") || $el.attr("data-date") || $el.text().trim());
    }).first();
    if (!$time.length && ($scope.attr("datetime") || getTimestampAttr($scope) || $scope.attr("data-time") || $scope.attr("data-date"))) {
      $time = $scope;
    }

    const timestamp = getTimestampAttr($time);
    const dateText = normalizeValorantDateText(firstClean(
      $time.attr("datetime"),
      $time.attr("data-date"),
      $time.attr("data-time"),
      $time.text(),
    ));
    const rawContext = [
      $time.attr("datetime"),
      $time.attr("data-date"),
      $time.attr("data-time"),
      $time.text(),
      $scope.find(".brkts-match-info-popup, .match-info-header, .match-info-top-row").first().text(),
    ].filter(Boolean).join(" ");
    const normalizedRawContext = normalizeValorantDateText(rawContext) || rawContext;
    const matchDate =
      parseTimestampDate(timestamp) ||
      (hasExplicitTimeText(normalizedRawContext) ? parseValorantWikiDate(normalizedRawContext) : null) ||
      (dateText && hasExplicitTimeText(dateText) ? parseValorantWikiDate(dateText) : null);

    return {
      dateText: dateText || null,
      finished: $time.attr("data-finished") || $scope.attr("data-finished"),
      matchDate,
    };
  };

  function findSectionForElement(el: any): string {
    const $el = $(el);
    let current = $el.closest("div, section, table").prev();
    let attempts = 0;
    while (current.length > 0 && attempts < 30) {
      const tag = current.prop("tagName")?.toLowerCase() ?? "";
      if (/^h[2-4]$/.test(tag)) {
        return current.text().replace(/\[edit\]/g, "").trim();
      }
      current = current.prev();
      attempts++;
    }
    return "";
  }

  function isNonTeamTitle(value: string) {
    return /^(time|date|vs|versus|score|winner)$/i.test(value) || value.includes("(page does not exist)");
  }

  function cleanHtmlTeamValue(value: string | null | undefined) {
    const cleaned = normalizeTeamName(value || "");
    if (!cleaned || isNonTeamTitle(cleaned)) return null;
    return cleaned;
  }

  function getFullTeamName(oppEl: any): string | null {
    const $opp = $(oppEl);
    const directValue = cleanHtmlTeamValue(
      $opp.attr("data-name") ||
      $opp.attr("data-team") ||
      $opp.attr("data-highlightingclass") ||
      $opp.attr("aria-label") ||
      $opp.closest("[aria-label]").attr("aria-label")
    );
    if (directValue) return directValue;
    const templateText = cleanHtmlTeamValue($opp.find(".team-template-text, .team-template-team-standard, .team-template-team-short, .team-template-team-name").first().text());
    if (templateText) return templateText;
    const linkTitle = cleanHtmlTeamValue($opp.find(".name a").attr("title"));
    if (linkTitle) return linkTitle;
    const teamTitle = cleanHtmlTeamValue($opp.find("a[href*='/valorant/']").attr("title"));
    if (teamTitle) return teamTitle;
    const teamText = cleanHtmlTeamValue($opp.find("a[href*='/valorant/']").first().text());
    if (teamText) return teamText;
    const nameText = cleanHtmlTeamValue($opp.find(".name").text());
    if (nameText) return nameText;
    return "TBD";
  }

  $(".brkts-matchlist-match").each((_, matchEl) => {
    const $match = $(matchEl);
    const oppCells = $match.find(".brkts-matchlist-opponent");
    if (oppCells.length < 2) return;

    const teamAName = getFullTeamName(oppCells.eq(0));
    const teamBName = getFullTeamName(oppCells.eq(1));

    const scoreCells = $match.find(".brkts-matchlist-score");
    const scoreAText = scoreCells.eq(0).text().trim();
    const scoreBText = scoreCells.eq(1).text().trim();
    const { finished, dateText, matchDate } = extractDateFromScope($match);
    const $matchlist = $match.closest(".brkts-matchlist");
    const stage = $matchlist.find(".brkts-matchlist-title b").first().text().trim() || findSectionForElement(matchEl) || null;
    const round = $match.prevAll(".brkts-matchlist-header").first().text().trim() || null;
    const rawText = $.html(matchEl)?.slice(0, 2500) || null;
    const scoreA = parseInteger(scoreAText);
    const scoreB = parseInteger(scoreBText);

    matches.push({
      stage,
      round,
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA,
      scoreB,
      format: getBestOfLabel($match.find(".brkts-matchlist-format, .match-bm-lbl, [data-bestof], [data-matchtype]").text()) || getBestOfLabel(rawText),
      status: finished === "finished" || scoreA != null || scoreB != null ? "finished" : "scheduled",
      sourceUrl: pageUrl,
      rawText
    });
  });

  $(".match-info").each((_, matchEl) => {
    const $match = $(matchEl);
    if ($match.closest(".brkts-matchlist-match").length > 0) return;

    const opponents = $match.find(".match-info-opponent-row, .match-info-header-opponent").filter((_, el) => {
      return $(el).find(".name a, a[href*='/valorant/'], .team-template-text, .teamname").length > 0 || /TBD/i.test($(el).text());
    });
    if (opponents.length < 2) return;

    const teamAName = getFullTeamName(opponents.eq(0));
    const teamBName = getFullTeamName(opponents.eq(1));
    const { finished, dateText, matchDate } = extractDateFromScope($match);
    const scoreTexts = opponents.map((_, el) => {
      const $opp = $(el);
      return $opp.find(".match-info-opponent-score, .match-info-header-scoreholder-score").first().text().trim();
    }).get();
    const scoreA = parseInteger(scoreTexts[0]);
    const scoreB = parseInteger(scoreTexts[1]);
    const stage = $match.find(".match-info-stage").first().text().trim() || null;
    const tournamentName = $match.find(".match-info-tournament-name a").first().text().trim() || null;
    const formatText = $match.find(".match-bm-lbl, .brkts-popup-header-dev-match-type, [data-bestof], [data-matchtype]").first().text().trim() || null;
    const rawText = $.html(matchEl)?.slice(0, 2500) || null;

    matches.push({
      stage: tournamentName || stage,
      round: stage,
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA,
      scoreB,
      format: getBestOfLabel(formatText) || getBestOfLabel(rawText),
      status: finished === "finished" || scoreA != null || scoreB != null ? "finished" : "scheduled",
      sourceUrl: pageUrl,
      rawText
    });
  });

  $(".brkts-match").each((_, matchEl) => {
    const $match = $(matchEl);
    const opponents = $match.find(".brkts-opponent-entry");
    if (opponents.length < 2) return;

    const teamAName = getFullTeamName(opponents.eq(0));
    const teamBName = getFullTeamName(opponents.eq(1));
    const scoreAText = opponents.eq(0).find(".brkts-opponent-score-inner").text().trim();
    const scoreBText = opponents.eq(1).find(".brkts-opponent-score-inner").text().trim();
    const scoreA = parseInteger(scoreAText);
    const scoreB = parseInteger(scoreBText);
    const $popup = $match.find(".brkts-match-info-popup");
    const { finished, dateText, matchDate } = extractDateFromScope($popup.length ? $popup : $match);
    const $bracket = $match.closest(".brkts-bracket");
    const stage = $bracket.attr("data-matchsection") || findSectionForElement(matchEl) || null;
    const rawHtml = $.html(matchEl)?.slice(0, 500) || "";
    const round = findLiquipediaBracketRoundLabel($, matchEl) || rawHtml.match(/<!--\s*(.+?)\s*-->/)?.[1] || null;
    const formatText = [
      $popup.find(".match-bm-lbl, .brkts-popup-header-dev-match-type, [data-bestof], [data-matchtype]").text().trim(),
      $match.attr("data-bestof"),
      $match.attr("data-matchtype"),
    ].filter(Boolean).join(" ") || null;
    const rawText = $.html(matchEl)?.slice(0, 2500) || null;

    matches.push({
      stage,
      round,
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA,
      scoreB,
      format: getBestOfLabel(formatText) || getBestOfLabel(rawText),
      status: finished === "finished" || scoreA != null || scoreB != null ? "finished" : "scheduled",
      sourceUrl: pageUrl,
      rawText
    });
  });

  return matches;
}

function extractMatchesFromWikitext(wikitext: string): NormalizedMatch[] {
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
      scoreA: parseInteger(params.score1 ?? params.games1),
      scoreB: parseInteger(params.score2 ?? params.games2),
      format: getBestOfLabel(formatText) || getBestOfLabel(template),
      status: firstClean(params.status, params.finished, params.walkover),
      rawText: template.slice(0, 2500)
    });
  }
  return matches;
}

function normalizeMatchCandidate(candidate: NormalizedMatch, sourceTitle: string, indexHint: string): NormalizedMatch | null {
  const teamAName = candidate.teamAName?.trim() || null;
  const teamBName = candidate.teamBName?.trim() || null;

  if (!teamAName && !teamBName && !indexHint) return null;

  // Numbered TBD logic
  const matchIdx = parseInt(indexHint || "0", 10);
  const tbdAName = `TBD${(matchIdx * 2) + 1}`;
  const tbdBName = `TBD${(matchIdx * 2) + 2}`;

  const isA_TBD = !teamAName || isPlaceholderTeam(teamAName);
  const isB_TBD = !teamBName || isPlaceholderTeam(teamBName);

  const finalTeamAName = isA_TBD ? "TBD" : teamAName;
  const finalTeamBName = isB_TBD ? "TBD" : teamBName;

  const teamAId = isA_TBD ? `tbd` : generateInternalTeamId(teamAName!);
  const teamBId = isB_TBD ? `tbd` : generateInternalTeamId(teamBName!);

  const matchId = candidate.matchId ?? createStableMatchId({ 
    sourceTitle, 
    matchDate: candidate.matchDate, 
    matchDateTime: candidate.matchDateTime,
    teamAId, 
    teamBId, 
    stage: candidate.stage,
    round: candidate.round,
    extraHint: indexHint 
  });

  const lpNumericalId = stringToNumericalId(matchId);

  return { 
    ...candidate, 
    matchId, 
    lpNumericalId,
    teamAId, 
    teamAName: finalTeamAName, 
    teamBId, 
    teamBName: finalTeamBName 
  };
}

export function stringToNumericalId(str: string): bigint {
  const hash = createHash("md5").update(str).digest("hex").slice(0, 12);
  return BigInt("0x" + hash);
}

function createStableMatchId(input: { 
  sourceTitle: string; 
  matchDate?: Date | null; 
  matchDateTime?: string | null;
  teamAId: string; 
  teamBId: string; 
  stage?: string | null;
  round?: string | null;
  extraHint: string 
}): string {
  const data = [
    input.sourceTitle, 
    input.matchDate?.toISOString() ?? "", 
    input.matchDateTime ?? "",
    input.teamAId, 
    input.teamBId, 
    input.stage ?? "",
    input.round ?? "",
    input.extraHint
  ].join("|");
  return `match_${createHash("md5").update(data).digest("hex").slice(0, 12)}`;
}

/* ───── Deduplication ───── */

function dedupeMatches(matches: NormalizedMatch[]): NormalizedMatch[] {
  const seen = new Map<string, NormalizedMatch>();
  for (const m of matches) {
    if (!m.matchId) continue;
    const existingById = seen.get(m.matchId);
    if (existingById) {
      if (scoreMatchCompleteness(m) > scoreMatchCompleteness(existingById)) seen.set(m.matchId, { ...existingById, ...m });
      continue;
    }

    const pairKey = matchDedupeKey(m);
    const existingByPair = [...seen.entries()].find(([, existing]) => matchDedupeKey(existing) === pairKey);
    if (existingByPair) {
      if (scoreMatchCompleteness(m) > scoreMatchCompleteness(existingByPair[1])) seen.set(existingByPair[0], m);
      continue;
    }

    seen.set(m.matchId, m);
  }
  return Array.from(seen.values());
}

function extractParticipants(wikitext: string, html?: string): NormalizedParticipant[] {
  const participants: NormalizedParticipant[] = [];
  if (html) {
    const $ = cheerio.load(html);
    $(".team-card, .participant-table-player-team").each((_, el) => {
      const name = $(el).find("a[href*='/valorant/']").first().attr("title")?.trim();
      if (name) participants.push({ name });
    });
  }
  return participants;
}

function parseValorantWikiDate(value?: string | null) {
  return parseWikiDate(value, VALORANT_LIQUIPEDIA_DATE_OPTIONS);
}

function normalizeValorantDateText(value?: string | null) {
  const cleaned = cleanWikiValue(value);
  if (!cleaned) return null;

  return cleaned.replace(/\bCST\b/gi, formatTimezoneOffset(480));
}

function formatTimezoneOffset(offsetMinutes: number) {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}${minutes}`;
}

function firstClean(...values: Array<string | null | undefined>) {
  for (const v of values) {
    const c = cleanWikiValue(v);
    if (c) return c;
  }
  return null;
}

function buildTemplateDateText(params: Record<string, string | undefined>) {
  const direct = firstClean(
    params.datetime,
    params.timestamp,
    params.starttime,
    params.start_time,
    params.date,
    params.time,
  );
  if (direct && hasExplicitTimeText(direct)) return direct;

  const date = firstClean(params.date, params.day, params.startdate, params.start_date);
  const time = firstClean(params.time, params.hour);
  const minute = firstClean(params.minute, params.min);
  const timezone = firstClean(params.timezone, params.tz, params.zone);
  if (date && time) {
    const clock = minute && /^\d{1,2}$/.test(time) ? `${time}:${minute.padStart(2, "0")}` : time;
    return [date, clock, timezone].filter(Boolean).join(" ");
  }

  return direct || null;
}

function normalizeTeamName(raw: string) {
  const cleaned = cleanWikiValue(raw);
  if (!cleaned) return null;
  return cleaned
    .replace(/^team:/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTimestampAttr($el: any) {
  return $el.attr("data-timestamp") || $el.attr("data-unix") || null;
}

function parseTimestampDate(value: string | null | undefined) {
  if (!value) return null;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 9_999_999_999 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date : null;
}

function scoreMatchCompleteness(match: NormalizedMatch) {
  let score = 0;
  if (match.matchDate) score += 20;
  if (hasExplicitTimeText(match.matchDateTime, match.rawText)) score += 10;
  if (match.teamAName && !isPlaceholderTeam(match.teamAName)) score += 8;
  if (match.teamBName && !isPlaceholderTeam(match.teamBName)) score += 8;
  if (getBestOfLabel(match.format) || getBestOfLabel(match.rawText)) score += 5;
  if (match.stage) score += 2;
  if (match.round) score += 2;
  if (match.sourceUrl) score += 1;
  return score;
}

function matchDedupeKey(match: NormalizedMatch) {
  const teams = [
    (match.teamAName || "").toLowerCase().trim(),
    (match.teamBName || "").toLowerCase().trim()
  ].sort();
  return [
    teams[0],
    teams[1],
    match.matchDate?.getTime() ?? "",
    (match.matchDateTime || "").toLowerCase().trim(),
    (match.stage || "").toLowerCase().trim(),
    (match.round || "").toLowerCase().trim(),
    (match.format || "").toLowerCase().trim()
  ].join("|");
}

function extractSubPages(wikitext: string, html: string, pageUrl: string): string[] {
  const subPages: string[] = [];
  const baseUrl = pageUrl.replace(/\/+$/, "");
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  const rawBase = decodeURIComponent(basePath.split("/").slice(2).join("/")).replace(/ /g, "_");

  const pushIfRelevant = (href: string | undefined | null) => {
    if (!href || href.startsWith("#") || href.includes("action=edit")) return;

    const fullUrl = href.startsWith("http") ? href : `https://liquipedia.net${href.startsWith("/") ? href : `/${href}`}`;
    let parsed: URL;
    try {
      parsed = new URL(fullUrl);
    } catch {
      return;
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path.startsWith(`${basePath}/`)) return;

    const suffix = decodeURIComponent(path.slice(basePath.length + 1)).replace(/ /g, "_");
    if (!suffix || suffix.includes("/") || suffix.includes("Qualifier")) return;
    if (!EVENT_SUBPAGE_ALLOWLIST.includes(suffix)) return;

    subPages.push(`${parsed.origin}${path}`);
  };

  if (html) {
    const $ = cheerio.load(html);
    $(".tabs-static a, .nav-tabs a").each((_, el) => {
      pushIfRelevant($(el).attr("href"));
    });
  }
  const titlePart = rawBase.replace(/_/g, " ");
  const pushTitleIfRelevant = (rawTitle: string | undefined | null) => {
    if (!rawTitle) return;
    const title = rawTitle
      .trim()
      .replace(/\{\{\s*#var:home\s*\}\}/gi, rawBase)
      .replace(/\{\{\s*FULLPAGENAME\s*\}\}/gi, rawBase)
      .replace(/^:+/, "")
      .replace(/ /g, "_")
      .split("#")[0]
      .replace(/\/+$/, "");
    if (!title || !title.startsWith(`${rawBase}/`)) return;
    pushIfRelevant(`/valorant/${title}`);
  };

  const subLinkRegex = /\[\[([^|\]]+\/[^|\]]+)(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = subLinkRegex.exec(wikitext))) {
    const subPath = match[1].replace(/_/g, " ");
    if (subPath.startsWith(titlePart) && subPath !== titlePart) {
      pushIfRelevant(`/valorant/${subPath.replace(/ /g, "_")}`);
    }
    pushTitleIfRelevant(match[1]);
  }

  const templatePageRefRegex = /\|\s*(?:tournament|page)\s*=\s*([^|}\n<]+)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = templatePageRefRegex.exec(wikitext))) {
    pushTitleIfRelevant(refMatch[1]);
  }
  return Array.from(new Set(subPages));
}

const EVENT_SUBPAGE_ALLOWLIST = [
  "Group_Stage",
  "Swiss_Stage",
  "Playoffs",
  "Bracket",
  "Main_Event",
  "Regular_Season",
  "Finals"
];

function inferTournamentStatus(startDate?: Date | null, endDate?: Date | null) {
  const now = Date.now();
  if (endDate && endDate.getTime() < now) return "finished";
  if (startDate && startDate.getTime() > now) return "upcoming";
  return "ongoing";
}
