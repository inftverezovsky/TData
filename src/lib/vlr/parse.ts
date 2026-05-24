import * as cheerio from "cheerio";
import { getBestOfLabel } from "@/lib/matches/format";

export type VlrMatch = {
  id: string;
  url: string;
  tournament: string;
  stage?: string | null;
  team1: string;
  team2: string;
  utcTimestamp?: string | number | null;
  unix_time?: number | null;
  format?: string | null;
  status?: string | null;
  isLive?: boolean;
  dateLabel?: string | null;
  rawText?: string | null;
};

export type VlrEvent = {
  id: string;
  title: string;
  url: string;
  dates?: string | null;
  status?: "ongoing" | "upcoming" | "unknown";
};

const VLR_ORIGIN = "https://www.vlr.gg";

export function parseVlrMatchesHtml(html: string, baseUrl = VLR_ORIGIN): VlrMatch[] {
  const $ = cheerio.load(html);
  const matches: VlrMatch[] = [];
  let currentDateLabel = "";

  $(".wf-label.mod-large, a.wf-module-item.match-item").each((_, element) => {
    const el = $(element);
    if (el.hasClass("wf-label")) {
      currentDateLabel = cleanText(el.clone().children().remove().end().text());
      return;
    }

    const href = el.attr("href") || "";
    const id = extractVlrMatchId(href);
    if (!id) return;

    const teams = extractScopedTeamNames($, el, [
      ".match-item-vs-team-name .text-of",
      ".match-item-vs-team-name",
      ".match-item-vs-team",
    ]);
    const titleTeams = parseVlrTitleTeams(el.attr("title") || el.attr("aria-label") || "");
    const team1 = teams[0] || titleTeams[0] || "";
    const team2 = teams[1] || titleTeams[1] || "";
    if (!team1 || !team2) return;

    const eventEl = el.find(".match-item-event").first();
    const stage = cleanText(eventEl.find(".match-item-event-series").first().text()) || null;
    const eventClone = eventEl.clone();
    eventClone.find(".match-item-event-series").remove();
    const tournament = cleanText(eventClone.text()) || "VLR";
    const status = cleanText(el.find(".ml-status").first().text()).toLowerCase();
    const timestamp = extractVlrTimestamp($, el);
    const rawText = cleanText(el.text()).slice(0, 1200) || null;

    matches.push({
      id,
      url: absoluteVlrUrl(href, baseUrl),
      tournament,
      stage,
      team1,
      team2,
      utcTimestamp: timestamp.utcTimestamp,
      unix_time: timestamp.unixTime,
      format: extractBestOf(rawText || ""),
      status: status || "upcoming",
      isLive: status === "live",
      dateLabel: currentDateLabel || null,
      rawText,
    });
  });

  return dedupeVlrMatches(matches);
}

export function parseVlrMatchDetailHtml(html: string, fallbackUrl = ""): Partial<VlrMatch> {
  const $ = cheerio.load(html);
  const header = $(".match-header").first();
  const scope = header.length ? header : $("body");
  const eventLink = header.find(".match-header-event").first();
  const eventTitle = cleanText(eventLink.find("> div > div").first().text()) || cleanText(eventLink.clone().find(".match-header-event-series").remove().end().text());
  const series = cleanText(eventLink.find(".match-header-event-series").first().text()) || null;
  const teamNames = extractScopedTeamNames($, scope, [
    ".match-header-link-name .wf-title-med",
    ".match-header-link-name",
    ".match-header-link .wf-title-med",
    ".match-header-link",
  ]);
  const titleTeams = parseVlrTitleTeams(cleanText($("title").first().text()) || cleanText($("h1").first().text()) || fallbackUrl);
  const timestamp = extractVlrTimestamp($, scope);
  const formatText = [
    cleanText(scope.find(".match-header-vs-score").text()),
    cleanText(scope.find(".match-header-vs-note").text()),
    cleanText(scope.find(".match-header-note").text()),
    cleanText(scope.find(".match-header-vs").text()),
  ].filter(Boolean).join(" ");
  const format = extractBestOf(formatText);
  const statusText = cleanText(scope.find(".match-header-vs-note, .match-header-note, .match-header-date").text());
  const href = fallbackUrl || "";
  const rawText = cleanText(scope.text()).slice(0, 1500) || null;

  return {
    id: extractVlrMatchId(href) || undefined,
    url: href ? absoluteVlrUrl(href) : undefined,
    tournament: eventTitle || undefined,
    stage: series || undefined,
    team1: teamNames[0] || titleTeams[0],
    team2: teamNames[1] || titleTeams[1],
    utcTimestamp: timestamp.utcTimestamp,
    unix_time: timestamp.unixTime,
    format,
    status: /live/i.test(statusText) ? "live" : "upcoming",
    isLive: /live/i.test(statusText),
    rawText,
  };
}

export function parseVlrEventsHtml(html: string, baseUrl = VLR_ORIGIN): VlrEvent[] {
  const $ = cheerio.load(html);
  const events: VlrEvent[] = [];

  $("a.event-item[href*='/event/']").each((_, element) => {
    const el = $(element);
    const href = el.attr("href") || "";
    const id = extractVlrEventId(href);
    const title = cleanText(el.find(".event-item-title").first().text());
    if (!id || !title) return;

    const statusRaw = cleanText(el.find(".event-item-desc-item-status").first().text()).toLowerCase();
    const dates = cleanText(el.find(".event-item-desc-item.mod-dates").first().clone().children().remove().end().text()) || null;
    const status = statusRaw === "ongoing" || statusRaw === "upcoming" ? statusRaw : "unknown";
    events.push({ id, title, url: absoluteVlrUrl(href, baseUrl), dates, status });
  });

  return dedupeVlrEvents(events);
}

export function parseVlrEventMatchesHtml(html: string, eventUrl: string): { title: string; matches: VlrMatch[] } {
  const $ = cheerio.load(html);
  const title = cleanText($(".wf-card.mod-event .wf-title").first().text())
    || cleanText($("h1.wf-title").first().text())
    || "VLR";
  const matches: VlrMatch[] = [];

  $(".event-sidebar-matches a.wf-module-item[href^='/']").each((_, element) => {
    const el = $(element);
    const href = el.attr("href") || "";
    const id = extractVlrMatchId(href);
    if (!id) return;

    const teams = extractScopedTeamNames($, el, [
      ".event-sidebar-matches-team .name",
      ".event-sidebar-matches-team",
    ]);
    const titleTeams = parseVlrTitleTeams(el.attr("title") || el.attr("aria-label") || "");
    const team1 = teams[0] || titleTeams[0] || "";
    const team2 = teams[1] || titleTeams[1] || "";
    if (!team1 || !team2) return;

    const stage = cleanText(el.find(".event-sidebar-matches-series").first().text()) || null;
    const scoreText = cleanText(el.find(".score").text());
    const isLive = el.find(".eta.mod-live, .score.mod-live").length > 0 || /live/i.test(cleanText(el.find(".eta").text()));
    const isFinished = /\d/.test(scoreText) && !/–|-/.test(scoreText);
    if (isFinished && !isLive) return;
    const timestamp = extractVlrTimestamp($, el);
    const rawText = cleanText(el.text()).slice(0, 1200) || null;

    matches.push({
      id,
      url: absoluteVlrUrl(href),
      tournament: title,
      stage,
      team1,
      team2,
      utcTimestamp: timestamp.utcTimestamp,
      unix_time: timestamp.unixTime,
      format: extractBestOf(rawText || ""),
      status: isLive ? "live" : "upcoming",
      isLive,
      rawText,
    });
  });

  $(".bracket-item[href^='/']").each((_, element) => {
    const el = $(element);
    const href = el.attr("href") || "";
    const id = extractVlrMatchId(href);
    if (!id) return;

    const titleTeams = parseVlrTitleTeams(el.attr("title") || "");
    const teams = el.find(".bracket-item-team-name span")
      .map((_, teamEl) => cleanTeamName($(teamEl).text()))
      .get()
      .filter(Boolean);
    const team1 = teams[0] || titleTeams[0] || "";
    const team2 = teams[1] || titleTeams[1] || "";
    if (!team1 || !team2) return;

    const scores = el.find(".bracket-item-team-score")
      .map((_, scoreEl) => cleanText($(scoreEl).text()))
      .get()
      .filter(Boolean);
    const isLive = el.hasClass("mod-live") || el.find(".mod-live").length > 0;
    const isFinished = scores.some((score) => /^\d+$/.test(score)) && !isLive;
    if (isFinished) return;

    const timestamp = extractVlrTimestamp($, el);
    const stage = cleanText(el.closest(".bracket-col").find("> .bracket-col-label").first().text()) || null;
    const rawText = cleanText(el.text()).slice(0, 1200) || null;

    matches.push({
      id,
      url: absoluteVlrUrl(href),
      tournament: title,
      stage,
      team1,
      team2,
      utcTimestamp: timestamp.utcTimestamp,
      unix_time: timestamp.unixTime,
      format: extractBestOf(rawText || ""),
      status: isLive ? "live" : "upcoming",
      isLive,
      rawText,
    });
  });

  return { title, matches: dedupeVlrMatches(matches) };
}

export function filterVlrEventsByQuery(events: VlrEvent[], query: string) {
  const tokens = normalizeSearchText(query).split(" ").filter((token) => token.length >= 2);
  if (tokens.length === 0) return events;
  return events.filter((event) => {
    const haystack = normalizeSearchText(`${event.title} ${event.url}`);
    return tokens.every((token) => haystack.includes(token));
  });
}

export function extractVlrMatchId(url: string) {
  const match = String(url || "").match(/(?:^|\/)(\d{3,})(?:\/|$)/);
  return match ? match[1] : "";
}

export function extractVlrEventId(url: string) {
  const match = String(url || "").match(/\/event\/(\d+)(?:\/|$)/);
  return match ? match[1] : "";
}

export function parseVlrUtcTimestamp(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const num = Number(raw);
    return raw.length > 10 ? Math.floor(num / 1000) : num;
  }

  const normalized = raw.replace(" ", "T");
  const parsed = new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed.getTime()) ? Math.floor(parsed.getTime() / 1000) : null;
}

export function cleanTeamName(value: string) {
  return cleanText(value).replace(/\s+\d+$/, "").trim();
}

export function cleanText(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBestOf(value: string) {
  return getBestOfLabel(value);
}

function extractScopedTeamNames($: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>, selectors: string[]) {
  for (const selector of selectors) {
    const teams = $scope.find(selector)
      .map((_, teamEl) => cleanTeamName($(teamEl).attr("title") || $(teamEl).attr("data-team") || $(teamEl).attr("aria-label") || $(teamEl).text()))
      .get()
      .filter(Boolean);
    const collapsed = collapseDuplicateTeamNames(teams);
    if (collapsed.length >= 2) return collapsed;
  }
  return [];
}

function collapseDuplicateTeamNames(teams: string[]) {
  const collapsed: string[] = [];
  for (const team of teams) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous === team && !isTbdLikeTeam(team)) continue;
    collapsed.push(team);
  }
  return collapsed;
}

function isTbdLikeTeam(value: string) {
  return /^(tbd|to be decided|unknown)$/i.test(cleanTeamName(value));
}

function extractVlrTimestamp($: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>) {
  const selector = "[data-utc-ts], [data-unix], [data-timestamp], [data-time], time[datetime], .moment-tz-convert";
  const nodes = $scope.find(selector).add($scope.filter(selector));
  let utcTimestamp: string | null = null;

  nodes.each((_, element) => {
    if (utcTimestamp) return;
    const el = $(element);
    utcTimestamp = el.attr("data-utc-ts")
      || el.attr("data-unix")
      || el.attr("data-timestamp")
      || el.attr("data-time")
      || el.attr("datetime")
      || null;
  });

  return {
    utcTimestamp,
    unixTime: parseVlrUtcTimestamp(utcTimestamp),
  };
}

function absoluteVlrUrl(href: string, baseUrl = VLR_ORIGIN) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function parseVlrTitleTeams(value: string) {
  const parts = cleanText(value).split(/\s+vs\.?\s+/i).map(cleanTeamName).filter(Boolean);
  return parts.length >= 2 ? [parts[0], parts[1]] : [];
}

function dedupeVlrMatches(matches: VlrMatch[]) {
  const seen = new Map<string, VlrMatch>();
  for (const match of matches) {
    const existing = seen.get(match.id);
    if (!existing) {
      seen.set(match.id, match);
      continue;
    }

    seen.set(match.id, {
      ...existing,
      ...match,
      tournament: existing.tournament || match.tournament,
      stage: existing.stage || match.stage || null,
      team1: existing.team1 || match.team1,
      team2: existing.team2 || match.team2,
      utcTimestamp: existing.utcTimestamp || match.utcTimestamp || null,
      unix_time: existing.unix_time ?? match.unix_time ?? null,
      format: existing.format || match.format || null,
      status: existing.isLive || match.isLive ? "live" : (existing.status || match.status || "upcoming"),
      isLive: Boolean(existing.isLive || match.isLive),
      dateLabel: existing.dateLabel || match.dateLabel || null,
    });
  }
  return Array.from(seen.values());
}

function dedupeVlrEvents(events: VlrEvent[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function normalizeSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
