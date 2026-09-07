/** Прочитать HTML-разметку: контекст раздела → команды, дата и счёт → кандидаты матчей без окончательной дедупликации. */
import type { HtmlNode, HtmlSelection, HtmlElements } from "../htmlTypes";
import type { NormalizedMatch } from "./types";
import * as cheerio from "cheerio";
import { getTimestampAttr, firstClean, parseTimestampDate, normalizeTeamName } from "./values";
import { hasExplicitTimeText } from "@backend/matches/time";
import { parseWikiDate } from "@backend/normalizers/wikiText";
import { getBestOfLabel } from "@backend/matches/format";
import { isPlaceholderTeam } from "@backend/teams/teams";
import { findLiquipediaBracketRoundLabel } from "@backend/sources/tdata/liquipedia/bracketLabels";

/* ───── Extract matches from parsed HTML ───── */

export function extractMatchesFromParsedHtml(html: string, pageUrl: string): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

  const extractDateFromScope = ($scope: HtmlSelection) => {
    const timeSelector = [
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
    const $candidates = $scope.find(timeSelector);
    let $time: HtmlSelection = $candidates.filter((_: number, el: HtmlNode) => {
      const $el = $(el);
      return Boolean(getTimestampAttr($el) || $el.attr("datetime") || $el.attr("data-time") || $el.attr("data-date") || $el.text().trim());
    }).first();
    if (!$time.length && ($scope.attr("datetime") || getTimestampAttr($scope) || $scope.attr("data-time") || $scope.attr("data-date"))) {
      $time = $scope;
    }

    const timestamp = getTimestampAttr($time);
    const explicitText = firstClean(
      $time.attr("datetime"),
      $time.attr("data-date"),
      $time.attr("data-time"),
      $time.text(),
    );
    const rawContext = [
      $time.attr("datetime"),
      $time.attr("data-date"),
      $time.attr("data-time"),
      $time.text(),
      $scope.find(".brkts-match-info-popup, .match-info-header, .match-info-top-row").first().text(),
    ].filter(Boolean).join(" ");
    const dateText = explicitText || null;
    const matchDate =
      parseTimestampDate(timestamp) ||
      (hasExplicitTimeText(rawContext) ? parseWikiDate(rawContext) : null) ||
      (dateText && hasExplicitTimeText(dateText) ? parseWikiDate(dateText) : null);

    return {
      dateText,
      finished: $time.attr("data-finished") || $scope.attr("data-finished"),
      matchDate,
    };
  };

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

  function isNonTeamTitle(value: string) {
    return /^(time|date|vs|versus|score|winner)$/i.test(value) || value.includes("(page does not exist)");
  }

  function cleanHtmlTeamValue(value: string | null | undefined) {
    const cleaned = normalizeTeamName(value || "");
    if (!cleaned || isNonTeamTitle(cleaned)) return null;
    return cleaned;
  }

  function getOpponentNameFromElement($opp: HtmlSelection): string {
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
    const nameLink = $opp.find(".name a").first();
    const linkTitle = cleanHtmlTeamValue(nameLink.attr("title"));
    if (linkTitle) return linkTitle;
    const linkText = cleanHtmlTeamValue(nameLink.text());
    if (linkText) return linkText;
    const teamLink = $opp.find("a[href*='/leagueoflegends/']").first();
    const teamTitle = cleanHtmlTeamValue(teamLink.attr("title"));
    if (teamTitle) return teamTitle;
    const teamText = cleanHtmlTeamValue(teamLink.text());
    if (teamText) return teamText;
    const literalText = cleanHtmlTeamValue($opp.find(".brkts-opponent-block-literal").first().text());
    if (literalText) return literalText;
    const nameText = cleanHtmlTeamValue($opp.find(".name").text());
    if (nameText) return nameText;
    return "TBD";
  }

  function getFullTeamName(oppEl: HtmlSelection): string | null {
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
    const teamLink = cleanHtmlTeamValue($opp.find("a[href*='/leagueoflegends/']").attr("title"));
    if (teamLink) return teamLink;
    const teamText = cleanHtmlTeamValue($opp.find("a[href*='/leagueoflegends/']").first().text());
    if (teamText) return teamText;
    const nameText = cleanHtmlTeamValue($opp.find(".name").text());
    if (nameText) return nameText;
    return "TBD";
  }

  // 1. Extract from matchlist matches
  $(".brkts-matchlist-match").each((_, matchEl) => {
    const $match = $(matchEl);
    const oppCells = $match.find(".brkts-matchlist-opponent");
    if (oppCells.length < 2) return;

    const teamAName = getFullTeamName(oppCells.eq(0));
    const teamBName = getFullTeamName(oppCells.eq(1));
    // Allow TBD matches

    const scoreCells = $match.find(".brkts-matchlist-score");
    const scoreAText = scoreCells.eq(0).text().trim();
    const scoreBText = scoreCells.eq(1).text().trim();

    const { finished, dateText, matchDate } = extractDateFromScope($match);

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

    matches.push({
      stage,
      round,
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA: scoreAText ? parseInt(scoreAText, 10) : null,
      scoreB: scoreBText ? parseInt(scoreBText, 10) : null,
      format: getBestOfLabel($match.find(".brkts-matchlist-format, .match-bm-lbl, [data-bestof], [data-matchtype]").text()) || getBestOfLabel(rawText),
      status: matchStatus,
      court: null,
      sourceUrl: pageUrl,
      rawText
    });

    if (matches.length >= 500) return false;
  });

  // 1b. Extract from vertical match cards used on LoL season pages.
  $(".match-info").each((_, matchEl) => {
    const $match = $(matchEl);
    if ($match.closest(".brkts-matchlist-match").length > 0) return;

    const opponents = $match.find(".match-info-opponent-row, .match-info-header-opponent").filter((_, el) => {
      return $(el).find(".name a, a[href*='/leagueoflegends/']").length > 0;
    });
    if (opponents.length < 2) return;

    const teamAName = getOpponentNameFromElement(opponents.eq(0));
    const teamBName = getOpponentNameFromElement(opponents.eq(1));
    const { finished, dateText, matchDate } = extractDateFromScope($match);

    const scoreTexts = opponents.map((_, el) => {
      const $opp = $(el);
      const directScore = $opp.find(".match-info-opponent-score").first().text().trim();
      if (directScore) return directScore;
      const scoreholder = $opp.find(".match-info-header-scoreholder-score").first().text().trim();
      if (scoreholder) return scoreholder;
      return "";
    }).get();

    const scoreA = parseInt(scoreTexts[0] || "", 10);
    const scoreB = parseInt(scoreTexts[1] || "", 10);
    const hasScoreA = Number.isFinite(scoreA);
    const hasScoreB = Number.isFinite(scoreB);

    const stage = $match.find(".match-info-stage").first().text().trim() || null;
    const tournamentName = $match.find(".match-info-tournament-name a").first().text().trim() || null;
    const formatText = $match.find(".match-info-tournament, .match-info-header").find(".match-bm-lbl, .brkts-popup-header-dev-match-type").first().text().trim() || null;
    const rawText = $.html(matchEl)?.slice(0, 2500) || null;

    let matchStatus: string | null = null;
    if (finished === "finished") matchStatus = "finished";
    else if (hasScoreA || hasScoreB) matchStatus = "in_progress";
    else if (stage && /playoff|final|bracket/i.test(stage)) matchStatus = "scheduled";

    matches.push({
      stage: tournamentName || stage,
      round: stage,
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA: hasScoreA ? scoreA : null,
      scoreB: hasScoreB ? scoreB : null,
      format: getBestOfLabel(formatText) || getBestOfLabel(rawText),
      status: matchStatus,
      court: null,
      sourceUrl: pageUrl,
      rawText
    });
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

  // 3. Extract from bracket matches
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
    const { finished, dateText, matchDate } = extractDateFromScope($popup.length ? $popup : $match);

    const $bracket = $match.closest(".brkts-bracket");
    let stage = $bracket.attr("data-matchsection") || "";
    if (!stage || stage === "undefined") {
      stage = findSectionForElement(matchEl);
    }

    let round: string | null = findLiquipediaBracketRoundLabel($, matchEl);
    const rawHtml = $.html(matchEl)?.slice(0, 500) || "";
    const commentMatch = rawHtml.match(/<!--\s*(.+?)\s*-->/);
    if (!round && commentMatch) round = commentMatch[1];

    const formatText = [
      $popup.find(".match-bm-lbl, .brkts-popup-header-dev-match-type, [data-bestof], [data-matchtype]").text().trim(),
      $match.attr("data-bestof"),
      $match.attr("data-matchtype"),
    ].filter(Boolean).join(" ") || null;
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
