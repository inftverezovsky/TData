/** Прочитать HTML-разметку: контекст раздела → команды, дата и счёт → кандидаты матчей без окончательной дедупликации. */
import type { HtmlNode, HtmlSelection, HtmlElements } from "../htmlTypes";
import type { WikiDateParseOptions } from "@backend/normalizers/wikiText";
import type { NormalizedMatch } from "./types";
import * as cheerio from "cheerio";
import { normalizeCounterStrikeDateText, parseCounterStrikeWikiDate } from "./values";
import { hasExplicitTimeText } from "@backend/matches/time";
import { getBestOfLabel } from "@backend/matches/format";
import { isPlaceholderTeam } from "@backend/teams/teams";
import { findLiquipediaBracketRoundLabel } from "@backend/sources/tdata/liquipedia/bracketLabels";

/* ───── Extract matches from parsed HTML ───── */

export function extractMatchesFromParsedHtml(html: string, pageUrl: string, dateOptions: WikiDateParseOptions = {}): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

  // Find current section context by traversing headings
  function findSectionForElement(el: HtmlNode): string {
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

  function findPreviousHeadingForElement(el: HtmlNode, selector: string): string {
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

  function getFullTeamName(oppEl: HtmlSelection): string | null {
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
    const dateText = normalizeCounterStrikeDateText(timer.text().trim(), dateOptions);
    const finished = timer.attr("data-finished");

    let matchDate: Date | null = null;
    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      if (!isNaN(ts)) matchDate = new Date(ts * 1000);
    }
    if (!matchDate && dateText && hasExplicitTimeText(dateText)) {
      matchDate = parseCounterStrikeWikiDate(dateText, dateOptions);
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
    }).get().filter((row): row is { teamName: string; cells: HtmlElements; raw: string | null } => !!row);

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
    const dateText = normalizeCounterStrikeDateText(timer.text().trim(), dateOptions);
    const finished = timer.attr("data-finished");

    let matchDate: Date | null = null;
    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      if (!isNaN(ts)) matchDate = new Date(ts * 1000);
    }
    if (!matchDate && dateText && hasExplicitTimeText(dateText)) {
      matchDate = parseCounterStrikeWikiDate(dateText, dateOptions);
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
