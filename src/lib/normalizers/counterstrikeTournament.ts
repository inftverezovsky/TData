import type { ImportStatus } from "@prisma/client";
import * as cheerio from "cheerio";
import {
  cleanWikiValue,
  extractBalancedTemplate,
  extractFirstTemplateByPrefix,
  extractSection,
  extractTemplatesByNamePrefix,
  parseInteger,
  parseTemplate,
  parseWikiDate
} from "@/lib/normalizers/wikiText";
import { createHash } from "crypto";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";
import { getBestOfLabel } from "@/lib/matches/format";
import { findLiquipediaBracketRoundLabel, isLikelyLiquipediaLayoutNoise } from "@/lib/liquipedia/bracketLabels";

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
};

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

/* ───── Extract matches from parsed HTML ───── */

function extractMatchesFromParsedHtml(html: string, pageUrl: string): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

  // Find current section context by traversing headings
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

  function findPreviousHeadingForElement(el: any, selector: string): string {
    let current = $(el);

    for (let depth = 0; depth < 10; depth++) {
      const heading = current.prevAll(selector).first();
      if (heading.length > 0) {
        return heading.text().replace(/\[edit\]/g, "").trim();
      }

      const parent = current.parent();
      if (parent.length === 0) break;
      current = parent;
    }

    return "";
  }

  function parseScoreText(text: string): [number, number] | null {
    const match = text.replace(/\s+/g, " ").trim().match(/(\d+)\s*[-:]\s*(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2])];
  }

  // Shared helper: extract full team name from an opponent element.
  // Priority: aria-label > link title > .name text
  function isNonTeamTitle(value: string) {
    return /^(time|date)$/i.test(value) || value.includes("(page does not exist)");
  }

  function getFullTeamName(oppEl: any): string | null {
    const $opp = $(oppEl);
    // 1. aria-label on the element itself
    const aria = $opp.attr("aria-label")?.trim();
    if (aria && aria !== "TBD") return aria;
    // 2. aria-label on parent cell (matchlist structure)
    const parentAria = $opp.closest("[aria-label]").attr("aria-label")?.trim();
    if (parentAria && parentAria !== "TBD") return parentAria;
    // 3. title attribute on any <a> link inside .name
    const linkTitle = $opp.find(".name a").attr("title")?.trim();
    if (linkTitle && !isNonTeamTitle(linkTitle)) return linkTitle;
    // 4. title attribute on any team link
    const teamLink = $opp.find("a[href*='/counterstrike/']").attr("title")?.trim();
    if (teamLink && !isNonTeamTitle(teamLink)) return teamLink;
    // 5. Fallback to .name text
    const nameText = $opp.find(".name").text().trim();
    if (nameText) return nameText;
    return "TBD";
  }

  // 1. Extract from matchlist matches (group stage — this is the primary format on Liquipedia CS)
  // Actual structure: .brkts-matchlist-match contains pairs of .brkts-matchlist-opponent cells
  $(".brkts-matchlist-match").each((_, matchEl) => {
    const $match = $(matchEl);
    // Each match has opponent cells with aria-label containing the full team name
    const oppCells = $match.find(".brkts-matchlist-opponent");
    if (oppCells.length < 2) return;

    const teamAName = getFullTeamName(oppCells.eq(0));
    const teamBName = getFullTeamName(oppCells.eq(1));
    // Allow TBD matches

    // Scores are in .brkts-matchlist-score cells
    const scoreCells = $match.find(".brkts-matchlist-score");
    const scoreAText = scoreCells.eq(0).text().trim();
    const scoreBText = scoreCells.eq(1).text().trim();

    // Timer / date
    const timer = $match.find(".timer-object").first();
    const timestamp = timer.attr("data-timestamp");
    const dateText = timer.text().trim() || null;
    const finished = timer.attr("data-finished");

    let matchDate: Date | null = null;
    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      if (!isNaN(ts)) matchDate = new Date(ts * 1000);
    }

    // Stage from the matchlist title
    const $matchlist = $match.closest(".brkts-matchlist");
    const matchlistTitle = $matchlist.find(".brkts-matchlist-title b").text().trim();
    const sectionHeader = $match.prevAll(".brkts-matchlist-header").first().text().trim();
    const stage = matchlistTitle || findSectionForElement(matchEl) || null;
    const round = sectionHeader || null;

    // Determine winner
    const teamAWon = oppCells.eq(0).hasClass("brkts-matchlist-slot-winner");
    const teamBWon = oppCells.eq(1).hasClass("brkts-matchlist-slot-winner");

    let matchStatus: string | null = null;
    if (finished === "finished") matchStatus = "finished";
    else if (teamAWon || teamBWon) matchStatus = "finished";
    else if (scoreAText && scoreBText) matchStatus = "in_progress";

    const rawText = $.html(matchEl)?.slice(0, 2500) || null;

    matches.push({
      stage,
      round,
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA: scoreAText ? parseInt(scoreAText, 10) : null,
      scoreB: scoreBText ? parseInt(scoreBText, 10) : null,
      format: getBestOfLabel(rawText),
      status: matchStatus,
      court: null,
      sourceUrl: pageUrl,
      rawText
    });

    if (matches.length >= 500) return false;
  });

  // 2. Extract completed round-robin results from Liquipedia crosstables.
  // Scoreless cells are schedule matrix hints, not exact matches.
  $("table.crosstable").each((_, tableEl) => {
    const $table = $(tableEl);
    const groupName = findPreviousHeadingForElement(tableEl, ".mw-heading3, h3");
    const stageName = findPreviousHeadingForElement(tableEl, ".mw-heading2, h2") || "Group Stage";
    const rows = $table.find("tr.crosstable-tr").map((__, rowEl) => {
      const $row = $(rowEl);
      const cells = $row.children("td");
      if (cells.length < 2) return null;

      const teamName = getFullTeamName($row.children("th").first());
      if (!teamName || isPlaceholderTeam(teamName)) return null;

      return {
        teamName,
        cells,
        raw: $.html(rowEl)?.slice(0, 2500) || null
      };
    }).get().filter((row): row is { teamName: string; cells: any; raw: string | null } => !!row);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (let colIndex = rowIndex + 1; colIndex < rows.length; colIndex++) {
        const cell = rows[rowIndex].cells.eq(colIndex);
        if (!cell.length || cell.hasClass("crosstable-bgc-cross")) continue;

        const score = parseScoreText(cell.text());
        if (!score) continue;

        matches.push({
          stage: stageName,
          round: groupName || null,
          matchDate: null,
          matchDateTime: null,
          teamAName: rows[rowIndex].teamName,
          teamBName: rows[colIndex].teamName,
          scoreA: score[0],
          scoreB: score[1],
          format: "Round robin",
          status: "finished",
          court: null,
          sourceUrl: pageUrl,
          rawText: [rows[rowIndex].raw, $.html(cell)?.slice(0, 1000), rows[colIndex].raw].filter(Boolean).join("\n")
        });
      }
    }
  });

  // 3. Extract from bracket matches (playoffs — .brkts-match with .brkts-opponent-entry)
  $(".brkts-match").each((_, matchEl) => {
    const $match = $(matchEl);
    const opponents = $match.find(".brkts-opponent-entry");
    if (opponents.length < 2) return;

    const teamAName = getFullTeamName(opponents.eq(0));
    const teamBName = getFullTeamName(opponents.eq(1));
    // Allow TBD matches

    const scoreAText = opponents.eq(0).find(".brkts-opponent-score-inner").text().trim();
    const scoreBText = opponents.eq(1).find(".brkts-opponent-score-inner").text().trim();
    const scoreA = scoreAText ? parseInt(scoreAText, 10) : null;
    const scoreB = scoreBText ? parseInt(scoreBText, 10) : null;

    const isWinA = opponents.eq(0).find(".brkts-opponent-win").length > 0;
    const isWinB = opponents.eq(1).find(".brkts-opponent-win").length > 0;

    const $popup = $match.find(".brkts-match-info-popup");
    const timer = $popup.find(".timer-object").first();
    const timestamp = timer.attr("data-timestamp");
    const dateText = timer.text().trim() || null;
    const finished = timer.attr("data-finished");

    let matchDate: Date | null = null;
    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      if (!isNaN(ts)) matchDate = new Date(ts * 1000);
    }

    const $bracket = $match.closest(".brkts-bracket");
    let stage = $bracket.attr("data-matchsection") || "";
    if (!stage || stage === "undefined") {
      stage = findSectionForElement(matchEl);
    }

    let round: string | null = findLiquipediaBracketRoundLabel($, matchEl);
    const rawHtml = $.html(matchEl)?.slice(0, 500) || "";
    const commentMatch = rawHtml.match(/<!--\s*(.+?)\s*-->/);
    if (!round && commentMatch) round = commentMatch[1];

    const formatText = $popup.find(".match-bm-lbl, .brkts-popup-header-dev-match-type").text().trim() || null;
    const rawText = $.html(matchEl)?.slice(0, 2500) || null;

    let matchStatus: string | null = null;
    if (finished === "finished") matchStatus = "finished";
    else if (isWinA || isWinB) matchStatus = "finished";
    else if (scoreA != null || scoreB != null) matchStatus = "in_progress";

    matches.push({
      stage: stage || null,
      round,
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA: !isNaN(scoreA as number) ? scoreA : null,
      scoreB: !isNaN(scoreB as number) ? scoreB : null,
      format: getBestOfLabel(formatText) || getBestOfLabel(rawText),
      status: matchStatus,
      court: null,
      sourceUrl: pageUrl,
      rawText
    });
  });

  return matches;
}

/* ───── Extract matches from wikitext (fallback) ───── */

type BracketWikitextMatchEntry = {
  match: NormalizedMatch;
  template: string;
};

function extractMatchesFromWikitext(wikitext: string): NormalizedMatch[] {
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
      const slotMatch = key.match(/^r\d+m\d+$/i);
      if (!slotMatch) continue;

      const matchTemplate = extractFirstTemplateByPrefix(value, "Match");
      if (!matchTemplate) continue;

      const slot = slotMatch[0].toUpperCase();
      const match = buildMatchFromWikitextTemplate(matchTemplate, {
        stage: bracketStage,
        round: slotLabels.get(slot),
        keepEmptyPlaceholders: true,
        sourceSlot: slot,
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
  const slotRegex = /^[\t ]*(?:<!--\s*([^\r\n]*?)\s*-->\s*)?\|\s*(R\d+M\d+)(header)?\s*=/gim;
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
  if (!cleaned || isLikelyLiquipediaLayoutNoise(cleaned)) return null;
  return cleaned;
}

function buildMatchFromWikitextTemplate(
  template: string,
  context: {
    stage?: string | null;
    round?: string | null;
    keepEmptyPlaceholders?: boolean;
    sourceSlot?: string | null;
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
  const dateText = buildTemplateDateText(params);
  const dateVal = parseWikiDate(dateText);
  const formatText = firstClean(params.bestof, params.bo, params.format, params.matchtype, params.type);
  const rawText = [context.sourceSlot ? `slot=${context.sourceSlot}` : null, template.slice(0, 2500)]
    .filter(Boolean)
    .join("\n");

  return {
    stage: firstClean(params.stage, params.section, context.stage),
    round: firstClean(params.round, params.match, params.title, context.round),
    matchDate: dateVal,
    matchDateTime: dateText,
    teamAName,
    teamBName,
    scoreA: parseInteger(params.score1 ?? params.team1score ?? params.p1score ?? params.games1),
    scoreB: parseInteger(params.score2 ?? params.team2score ?? params.p2score ?? params.games2),
    format: getBestOfLabel(formatText) || getBestOfLabel(template),
    status: firstClean(params.status, params.finished, params.walkover),
    court: firstClean(params.court, params.stream, params.twitch),
    rawText
  };
}

/* ───── Normalize & validate a match candidate ───── */

function normalizeMatchCandidate(
  candidate: NormalizedMatch,
  sourceTitle: string,
  indexHint?: string
): NormalizedMatch | null {
  const teamAName = candidate.teamAName?.trim() || null;
  const teamBName = candidate.teamBName?.trim() || null;

  // Must have at least one real team
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
    teamBName: finalTeamBName,
    court: candidate.court || null
  };
}

/* ───── Deduplication ───── */

function dedupeMatches(matches: NormalizedMatch[]): NormalizedMatch[] {
  const seen = new Map<string, NormalizedMatch>();

  for (const match of matches) {
    const id = match.matchId ?? "";
    if (!id) continue;

    if (seen.has(id)) {
      // Merge: prefer entry with more data
      const existing = seen.get(id)!;
      if (!existing.matchDate && match.matchDate) seen.set(id, { ...existing, ...match });
      continue;
    }

    // Also check by normalized identity, not just pair+day. Same teams can play
    // more than once in different rounds/stages.
    const pairKey = matchDedupeKey(match);

    const existingByPair = [...seen.values()].find((m) => {
      return matchDedupeKey(m) === pairKey;
    });

    if (existingByPair) {
      // For TBD matches, we allow multiple identical pairs (TBD vs TBD) because they are distinct slots
      const isTbdMatch = !match.teamAName || isPlaceholderTeam(match.teamAName) || !match.teamBName || isPlaceholderTeam(match.teamBName);
      if (!isTbdMatch) {
        continue;
      }
    }

    seen.set(id, match);
  }

  return [...seen.values()];
}

/* ───── Stable ID helpers ───── */

export function createStableTeamId(name: string): string {
  return generateInternalTeamId(name);
}

function createStableMatchId(input: {
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

export function stringToNumericalId(str: string): bigint {
  const hash = createHash("md5").update(str).digest("hex").slice(0, 12);
  return BigInt("0x" + hash);
}

// Keep backward compat
export function generateTeamId(teamName: string, sourceSlug: string = "counterstrike"): string {
  return createStableTeamId(teamName);
}

/* ───── Participants ───── */

function extractParticipants(wikitext: string, html?: string): NormalizedParticipant[] {
  const candidates = new Map<string, NormalizedParticipant>();

  // 1. Try to extract from HTML first (more reliable for full names)
  if (html) {
    const $ = cheerio.load(html);
    $(".team-card, .participant-table-player-team, .participant-card").each((_, el) => {
      const $el = $(el);
      // Look for the main team link
      const $link = $el.find("a").filter((_, a) => {
        const href = $(a).attr("href") || "";
        return href.includes("/counterstrike/") && !href.includes("Special:") && !href.includes("Category:");
      }).first();

      const fullName = $link.attr("title")?.trim() || $link.text().trim();
      const logoUrl = $el.find("img").first().attr("src") 
                   ? `https://liquipedia.net${$el.find("img").first().attr("src")}` 
                   : null;

      if (fullName && isLikelyTeamName(fullName)) {
        candidates.set(fullName.toLowerCase(), { name: fullName, logoUrl });
      }
    });
  }

  // 2. Fallback/Supplement with Wikitext
  const section =
    extractSection(wikitext, ["Participants", "Teams", "Participating Teams", "Invited Teams", "Qualified Teams"]) ??
    "";

  const source = section || wikitext.slice(0, Math.min(wikitext.length, 40000));
  const patterns = [
    /\{\{\s*(?:Team|TeamCard|TeamShort|TeamLink|Opponent|TeamOpponent)\s*\|\s*([^|}\n]+)/gi,
    /\|\s*(?:team|team\d+|opponent|opponent\d+)\s*=\s*([^|}\n]+)/gi,
    /\[\[Team:([^|\]]+)(?:\|([^\]]+))?\]\]/gi
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const rawName = match[1]; 
      const name = normalizeTeamName(rawName);
      if (name && isLikelyTeamName(name) && !isPlaceholderTeam(name)) {
        if (!candidates.has(name.toLowerCase())) {
          candidates.set(name.toLowerCase(), { name, rawText: match[0] });
        }
      }
    }
  }

  return Array.from(candidates.values()).slice(0, 64);
}

/* ───── Helpers ───── */

function firstClean(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = cleanWikiValue(value);
    if (cleaned) return cleaned;
  }
  return null;
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

function buildTemplateDateText(params: Record<string, string>) {
  const datetime = firstClean(params.datetime, params.timestamp, params.starttime, params.start_time);
  if (datetime) return datetime;

  const date = firstClean(params.date, params.day, params.startdate, params.start_date);
  const time = firstClean(params.time, params.hour);
  const timezone = firstClean(params.timezone, params.tz, params.zone);
  const combined = [date, time, timezone].filter(Boolean).join(" ");
  if (combined) return combined;

  return firstClean(params.datetime, params.timestamp, params.time, params.date);
}

function isLikelyTeamName(name: string) {
  if (isPlaceholderTeam(name)) return false;
  if (name.length < 2 || name.length > 80) return false;
  if (name.includes("=")) return false;
  return true;
}

const EVENT_SUBPAGE_ALLOWLIST = [
  "Group_Stage",
  "Groups",
  "Swiss_Stage",
  "Playoffs",
  "Bracket",
  "Main_Event",
  "Regular_Season",
  "Finals",
  "Knockout_Stage",
  "Play-In",
  "Play-In_Stage"
];

const EVENT_SUBPAGE_BLOCKLIST = [
  "Teams",
  "Participants",
  "Results",
  "Statistics",
  "North_America",
  "South_America",
  "Western_Europe",
  "Eastern_Europe",
  "Southeast_Asia",
  "China",
  "Europe",
  "Americas",
  "Asia",
  "Oceania",
  "MENA"
];

function extractSubPages(wikitext: string, html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
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
    if (EVENT_SUBPAGE_BLOCKLIST.includes(suffix)) return;
    if (!EVENT_SUBPAGE_ALLOWLIST.includes(suffix)) return;

    subPages.push(`${parsed.origin}${path}`);
  };

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
    pushIfRelevant(`/counterstrike/${title}`);
  };
  
  // Look for Tabs (standard Liquipedia structure for multi-page tournaments)
  $(".tabs-static a, .nav-tabs a").each((_, el) => {
    pushIfRelevant($(el).attr("href"));
  });

  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiLinkRegex.exec(wikitext))) {
    pushTitleIfRelevant(wikiMatch[1]);
  }

  const templatePageRefRegex = /\|\s*(?:tournament|page)\s*=\s*([^|}\n<]+)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = templatePageRefRegex.exec(wikitext))) {
    pushTitleIfRelevant(refMatch[1]);
  }

  return Array.from(new Set(subPages));
}

function inferTournamentStatus(startDate?: Date | null, endDate?: Date | null) {
  const now = Date.now();
  if (endDate && endDate.getTime() < now) return "finished";
  if (startDate && startDate.getTime() > now) return "upcoming";
  if (startDate && startDate.getTime() <= now && (!endDate || endDate.getTime() >= now)) return "ongoing";
  return "unknown";
}
