/** Прочитать HTML-разметку: контекст раздела → команды, дата и счёт → кандидаты матчей без окончательной дедупликации. */
import type { HtmlNode, HtmlSelection } from "../htmlTypes";
import type { NormalizedMatch } from "./types";
import * as cheerio from "cheerio";
import { getTimestampAttr, normalizeValorantDateText, firstClean, parseTimestampDate, parseValorantWikiDate, normalizeTeamName, isDateOnlyScheduleHeading } from "./values";
import { hasExplicitTimeText } from "@backend/matches/time";
import { parseInteger } from "@backend/normalizers/wikiText";
import { getBestOfLabel } from "@backend/matches/format";
import { findLiquipediaBracketRoundLabel } from "@backend/sources/tdata/liquipedia/bracketLabels";

export function extractMatchesFromParsedHtml(html: string, pageUrl: string): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];
  const hasMatchlistMatches = $(".brkts-matchlist-match").length > 0;

  const extractDateFromScope = ($scope: HtmlSelection) => {
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
    let $time: HtmlSelection = $candidates.filter((_: number, el: HtmlNode) => {
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

  function isNonTeamTitle(value: string) {
    return /^(time|date|vs|versus|score|winner)$/i.test(value) || value.includes("(page does not exist)");
  }

  function cleanHtmlTeamValue(value: string | null | undefined) {
    const cleaned = normalizeTeamName(value || "");
    if (!cleaned || isNonTeamTitle(cleaned)) return null;
    return cleaned;
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
    if (hasMatchlistMatches && $match.hasClass("match-info--vertical") && isDateOnlyScheduleHeading(stage) && !tournamentName) {
      return;
    }
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
