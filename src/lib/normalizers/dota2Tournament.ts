import type { ImportStatus } from "@prisma/client";
import * as cheerio from "cheerio";
import {
  cleanWikiValue,
  extractBalancedTemplate,
  extractFirstTemplateByPrefix,
  extractSection,
  extractTemplatesByNamePrefix,
  parseInteger,
  parseTeamOpponentScore,
  parseTemplate,
  parseWikiDate,
  type WikiDateParseOptions
} from "@/lib/normalizers/wikiText";
import { createHash } from "crypto";
import { buildDota2Diagnostics, type Dota2ParsingDiagnostics } from "@/lib/matches/parsingDiagnostics";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";
import { getBestOfLabel } from "@/lib/matches/format";
import { hasExplicitTimeText } from "@/lib/matches/time";
import { findLiquipediaBracketRoundLabel } from "@/lib/sources/TCyber/liquipedia/bracketLabels";

const DOTA2_LIQUIPEDIA_DATE_OPTIONS: WikiDateParseOptions = {
  timezoneOffsets: {
    // On Dota 2 Liquipedia Chinese-region pages CST is China Standard Time.
    // Keep this contextual so Counter-Strike/LoL pages can still reject ambiguous CST.
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
  dota2Diagnostics?: Dota2ParsingDiagnostics;
};

/* ───── Main entry point ───── */

export function normalizeDota2Tournament(input: {
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
  let startDate = parseDota2WikiDate(params.sdate ?? params.startdate ?? params.start_date ?? params.date ?? params.dates);
  let endDate = parseDota2WikiDate(params.edate ?? params.enddate ?? params.end_date ?? params.date2);
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
      
      if (!startDate) startDate = parseDota2WikiDate(getInfoboxValue("Start Date:"));
      if (!endDate) endDate = parseDota2WikiDate(getInfoboxValue("End Date:"));
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
  const parsedHtmlMatches = input.parsedHtml
    ? extractMatchesFromParsedHtml(input.parsedHtml, input.pageUrl)
    : [];
  const rawWikiMatches = extractMatchesFromWikitext(input.wikitext);
  const htmlMatches = filterParsedHtmlDateOnlyMatchesCoveredByWikitext(
    parsedHtmlMatches,
    rawWikiMatches,
  );
  const wikiMatches = filterWikitextMatchesCoveredByParsedHtml(
    rawWikiMatches,
    htmlMatches,
  );

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
  const dota2Diagnostics = buildDota2Diagnostics({
    source: "liquipedia",
    rawCandidates: allCandidates.length,
    candidates: normalizedMatches,
    savedMatches: matches.length,
    duplicateMatches: Math.max(0, normalizedMatches.length - matches.length),
  });

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
    status,
    dota2Diagnostics
  };
}

/* ───── Extract matches from parsed HTML ───── */

function extractMatchesFromParsedHtml(html: string, pageUrl: string): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

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

  function findBracketRoundLabel(matchEl: any): string | null {
    const $match = $(matchEl);
    const direct = firstClean(
      $match.attr("data-round"),
      $match.attr("data-match"),
      $match.find(".brkts-match-title").first().text(),
      $match.find(".brkts-match-header").first().text()
    );
    if (direct && !isLikelyLayoutNoise(direct)) return direct;

    const roundContainer = $match.closest([
      ".brkts-column",
      ".brkts-round",
      ".brkts-bracket-column",
      ".bracket-column",
      ".bracket-round",
      "[class*='brkts-column']",
      "[class*='bracket-column']",
    ].join(", "));

    const headerSelectors = [
      ".brkts-column-header",
      ".brkts-round-title",
      ".brkts-header",
      ".brkts-title",
      ".bracket-column-header",
      ".bracket-header",
      ".bracket-title",
      ".round-title",
      "h3",
      "h4",
    ].join(", ");

    const fromContainer = firstClean(
      roundContainer.attr("data-round"),
      roundContainer.attr("data-title"),
      roundContainer.find(headerSelectors).first().text()
    );
    if (fromContainer && !isLikelyLayoutNoise(fromContainer)) return fromContainer;

    const previousHeader = firstClean(
      $match.prevAll(headerSelectors).first().text(),
      $match.parent().prevAll(headerSelectors).first().text(),
      $match.closest(".brkts-bracket").find(headerSelectors).first().text()
    );
    if (previousHeader && !isLikelyLayoutNoise(previousHeader)) return previousHeader;

    return null;
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
    const aria = $opp.attr("aria-label")?.trim();
    if (aria && aria !== "TBD") return aria;
    const parentAria = $opp.closest("[aria-label]").attr("aria-label")?.trim();
    if (parentAria && parentAria !== "TBD") return parentAria;
    const dataName = firstClean($opp.attr("data-name"), $opp.attr("data-highlightingclass"), $opp.attr("title"));
    if (dataName && !isNonTeamTitle(dataName) && !isLikelyLayoutNoise(dataName)) return dataName;
    const linkTitle = $opp.find(".name a").attr("title")?.trim();
    if (linkTitle && !isNonTeamTitle(linkTitle)) return linkTitle;
    const teamLink = $opp.find("a[href*='/dota2/']").attr("title")?.trim();
    if (teamLink && !isNonTeamTitle(teamLink)) return teamLink;
    const templateText = firstClean(
      $opp.find(".team-template-text").first().text(),
      $opp.find(".team-template-team-standard").first().text(),
      $opp.find(".team-template-team-short").first().text(),
      $opp.find(".team-template-team-name").first().text()
    );
    if (templateText && !isLikelyLayoutNoise(templateText)) return templateText;
    const nameText = firstClean($opp.find(".name").text(), $opp.text());
    if (nameText) return nameText;
    
    // If it's a bracket slot but empty, return TBD to ensure it's not skipped
    return "TBD";
  }

  function extractMatchTime($root: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>) {
    const selectors = [
      ".timer-object",
      ".match-info-countdown",
      ".brkts-popup-date",
      ".match-bm-date",
      "time",
      "[datetime]",
      "[data-timestamp]",
      "[data-unix]",
      "[data-time]",
      "[data-date]",
    ].join(", ");
    const nodes = $scope.find(selectors).add($scope.filter(selectors));
    let matchDate: Date | null = null;
    let matchDateTime: string | null = null;
    let finished: string | null = null;

    nodes.each((_, node) => {
      if (matchDate) return;
      const $node = $root(node);
      finished = finished || $node.attr("data-finished") || null;

      const timestamp = firstClean($node.attr("data-timestamp"), $node.attr("data-unix"));
      if (timestamp) {
        const parsed = parseTimestamp(timestamp);
        if (parsed) {
          matchDate = parsed;
          matchDateTime = matchDateTime || $node.text().trim() || timestamp;
          return;
        }
      }

      const rawValues = [
        $node.attr("datetime"),
        $node.attr("title"),
        $node.attr("data-date"),
        $node.attr("data-time"),
        $node.text(),
      ];

      for (const rawValue of rawValues) {
        const value = firstClean(rawValue);
        if (!value) continue;
        matchDateTime = matchDateTime || normalizeDota2DateText(value);

        const timestampDate = /^\d{9,13}$/.test(value) ? parseTimestamp(value) : null;
        if (timestampDate) {
          matchDate = timestampDate;
          return;
        }

        if (!hasExplicitTimeText(value)) continue;
        const parsed = parseDota2WikiDate(value);
        if (parsed) {
          matchDate = parsed;
          return;
        }
      }
    });

    if (!matchDate) {
      const scopedText = firstClean($scope.text());
      if (scopedText && hasExplicitTimeText(scopedText)) {
        const parsed = parseDota2WikiDate(scopedText);
        if (parsed) {
          matchDate = parsed;
          matchDateTime = matchDateTime || normalizeDota2DateText(scopedText)?.slice(0, 160) || scopedText.slice(0, 160);
        }
      }
    }

    return { matchDate, matchDateTime, finished };
  }

  // 1. Extract from matchlist matches (group stage)
  $(".brkts-matchlist-match").each((_, matchEl) => {
    const $match = $(matchEl);
    const oppCells = $match.find(".brkts-matchlist-opponent");
    if (oppCells.length < 2) return;

    const teamAName = getFullTeamName(oppCells.eq(0));
    const teamBName = getFullTeamName(oppCells.eq(1));
    // We allow TBD matches now

    const scoreCells = $match.find(".brkts-matchlist-score");
    const scoreAText = scoreCells.eq(0).text().trim();
    const scoreBText = scoreCells.eq(1).text().trim();

    const timeInfo = extractMatchTime($, $match);
    const finished = timeInfo.finished;

    const $matchlist = $match.closest(".brkts-matchlist");
    const matchlistTitle = $matchlist.find(".brkts-matchlist-title b").text().trim();
    const sectionHeader = $match.prevAll(".brkts-matchlist-header").first().text().trim();
    const stage = matchlistTitle || findSectionForElement(matchEl) || null;
    const round = sectionHeader || null;

    const teamAWon = oppCells.eq(0).hasClass("brkts-matchlist-slot-winner");
    const teamBWon = oppCells.eq(1).hasClass("brkts-matchlist-slot-winner");

    let matchStatus: string | null = null;
    if (finished === "finished") matchStatus = "finished";
    else if (teamAWon || teamBWon) matchStatus = "finished";
    else if (scoreAText && scoreBText) matchStatus = "in_progress";

    const rawText = $.html(matchEl)?.slice(0, 2500) || null;
    const formatText = firstClean(
      $match.find(".brkts-matchlist-format").text(),
      $match.find(".match-info-format").text(),
      $match.find(".match-bm-lbl").text(),
      $match.find(".brkts-popup-header-dev-match-type").text()
    );

    matches.push({
      stage,
      round,
      matchDate: timeInfo.matchDate,
      matchDateTime: timeInfo.matchDateTime,
      teamAName,
      teamBName,
      scoreA: scoreAText ? parseInt(scoreAText, 10) : null,
      scoreB: scoreBText ? parseInt(scoreBText, 10) : null,
      format: getBestOfLabel(formatText) || getBestOfLabel(rawText),
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

  // 3. Extract from bracket matches (playoffs)
  $(".brkts-match").each((_, matchEl) => {
    const $match = $(matchEl);
    const opponents = $match.find(".brkts-opponent-entry");
    if (opponents.length < 2) return;

    const teamAName = getFullTeamName(opponents.eq(0));
    const teamBName = getFullTeamName(opponents.eq(1));
    // We allow TBD matches now

    const scoreAText = opponents.eq(0).find(".brkts-opponent-score-inner").text().trim();
    const scoreBText = opponents.eq(1).find(".brkts-opponent-score-inner").text().trim();
    const scoreA = scoreAText ? parseInt(scoreAText, 10) : null;
    const scoreB = scoreBText ? parseInt(scoreBText, 10) : null;

    const isWinA = opponents.eq(0).find(".brkts-opponent-win").length > 0;
    const isWinB = opponents.eq(1).find(".brkts-opponent-win").length > 0;

    const $popup = $match.find(".brkts-match-info-popup");
    const timeInfo = extractMatchTime($, $match);
    const finished = timeInfo.finished;

    const $bracket = $match.closest(".brkts-bracket");
    let stage = $bracket.attr("data-matchsection") || "";
    if (!stage || stage === "undefined") {
      stage = findSectionForElement(matchEl);
    }

    let round: string | null = findLiquipediaBracketRoundLabel($, matchEl) || findBracketRoundLabel(matchEl);
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
      matchDate: timeInfo.matchDate,
      matchDateTime: timeInfo.matchDateTime,
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

function filterParsedHtmlDateOnlyMatchesCoveredByWikitext(
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

function filterWikitextMatchesCoveredByParsedHtml(
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

/* ───── Normalize & validate a match candidate ───── */

function normalizeMatchCandidate(
  candidate: NormalizedMatch,
  sourceTitle: string,
  indexHint?: string
): NormalizedMatch | null {
  const teamAName = candidate.teamAName?.trim() || null;
  const teamBName = candidate.teamBName?.trim() || null;

  // We now allow matches with two placeholder teams (e.g. TBD vs TBD)
  // because they will be assigned stable numbered placeholders (TBD1, TBD2...)
  // if both are missing, we still continue if there is at least an indexHint
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
      if (scoreMatchCompleteness(match) > scoreMatchCompleteness(existing)) {
        seen.set(id, { ...existing, ...match });
      }
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
        const existingId = existingByPair.matchId ?? "";
        if (existingId && scoreMatchCompleteness(match) > scoreMatchCompleteness(existingByPair)) {
          seen.set(existingId, { ...existingByPair, ...match });
        }
        continue;
      }
    }

    seen.set(id, match);
  }

  return [...seen.values()];
}

function scoreMatchCompleteness(match: NormalizedMatch) {
  return [
    match.matchDate ? 20 : 0,
    match.matchDateTime ? 6 : 0,
    match.teamAName && !isPlaceholderTeam(match.teamAName) ? 8 : 0,
    match.teamBName && !isPlaceholderTeam(match.teamBName) ? 8 : 0,
    getBestOfLabel(match.format) || getBestOfLabel(match.rawText) ? 5 : 0,
    match.sourceUrl ? 3 : 0,
    match.stage ? 2 : 0,
    match.round ? 2 : 0,
  ].reduce((sum, value) => sum + value, 0);
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
  // Try to use a more stable tournament key by removing sub-page suffixes
  const tournamentKey = input.sourceTitle.split('/')[0].trim();
  
  // Normalized date (Day only) for deduplication
  let dateStr = "";
  if (input.matchDate) {
    const d = new Date(input.matchDate);
    if (!isNaN(d.getTime())) {
      dateStr = d.toISOString().split('T')[0];
    }
  }

  // Sort team IDs to handle A/B swaps
  const teams = [input.teamAId || "unknownA", input.teamBId || "unknownB"].sort();

  const data = [
    tournamentKey,
    dateStr,
    input.matchDateTime ?? "",
    teams[0],
    teams[1],
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
  // Convert hex to BigInt, ensuring it's positive and within BigInt range (12 hex chars is max 15 decimal digits)
  return BigInt("0x" + hash);
}

// Keep backward compat
export function generateTeamId(teamName: string, sourceSlug: string = "dota2"): string {
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
        return href.includes("/dota2/") && !href.includes("Special:") && !href.includes("Category:");
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

function parseDota2WikiDate(value?: string | null) {
  return parseWikiDate(value, DOTA2_LIQUIPEDIA_DATE_OPTIONS);
}

function normalizeDota2DateText(value?: string | null) {
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
  if (datetime && hasExplicitTimeText(datetime)) return datetime;

  const date = firstClean(params.date, params.day, params.startdate, params.start_date);
  const time = firstClean(params.time, params.hour);
  const timezone = firstClean(params.timezone, params.tz, params.zone);
  const combined = [date, time, timezone].filter(Boolean).join(" ");
  if (combined) return combined;

  return firstClean(params.datetime, params.timestamp, params.time, params.date);
}

function parseTimestamp(value: string | null | undefined) {
  const raw = Number(String(value || "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const date = new Date(raw > 9_999_999_999 ? raw : raw * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isLikelyTeamName(name: string) {
  if (isPlaceholderTeam(name)) return false;
  if (name.length < 2 || name.length > 80) return false;
  if (name.includes("=")) return false;
  return true;
}

function isLikelyLayoutNoise(name: string) {
  return /^(date|time|score|vs|versus|match|round|bo\d?|best of)$/i.test(name.trim());
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

const QUALIFIER_SUBPAGE_BLOCKLIST = [
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
    if (QUALIFIER_SUBPAGE_BLOCKLIST.includes(suffix)) return;
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
    pushIfRelevant(`/dota2/${title}`);
  };
  
  // Look for tabs, but avoid qualification region pages. Those pages are expensive
  // to parse and do not belong to the selected main event schedule.
  $(".tabs-static a, .nav-tabs a").each((_, el) => {
    pushIfRelevant($(el).attr("href"));
  });

  // Some pages mention event subpages only in wikitext links.
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiLinkRegex.exec(wikitext))) {
    pushTitleIfRelevant(wikiMatch[1]);
  }

  // Templates such as GroupTableLeague/CrossTableLeague often reference the
  // detailed schedule as |tournament=Event/Group_Stage without a normal link.
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
