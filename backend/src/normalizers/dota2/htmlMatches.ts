/** Прочитать HTML-разметку: контекст раздела → команды, дата и счёт → кандидаты матчей без окончательной дедупликации. */
import type { HtmlNode, HtmlSelection, HtmlElements } from "../htmlTypes";
import type { NormalizedMatch } from "./types";
import * as cheerio from "cheerio";
import { firstClean, isLikelyLayoutNoise, parseTimestamp, normalizeDota2DateText, parseDota2WikiDate } from "./values";
import { hasExplicitTimeText } from "@backend/matches/time";
import { getBestOfLabel } from "@backend/matches/format";
import { isPlaceholderTeam } from "@backend/teams/teams";
import { findLiquipediaBracketRoundLabel } from "@backend/sources/tdata/liquipedia/bracketLabels";

/* ───── Extract matches from parsed HTML ───── */

export function extractMatchesFromParsedHtml(html: string, pageUrl: string): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

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

  function findBracketRoundLabel(matchEl: HtmlNode): string | null {
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

  function getFullTeamName(oppEl: HtmlSelection): string | null {
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

  function extractMatchTime($root: cheerio.CheerioAPI, $scope: HtmlSelection) {
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
