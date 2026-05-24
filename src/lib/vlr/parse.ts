import * as cheerio from "cheerio";

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

    const teams = el.find(".match-item-vs-team-name .text-of")
      .map((_, teamEl) => cleanTeamName($(teamEl).text()))
      .get()
      .filter(Boolean);
    if (teams.length < 2) return;

    const eventEl = el.find(".match-item-event").first();
    const stage = cleanText(eventEl.find(".match-item-event-series").first().text()) || null;
    const eventClone = eventEl.clone();
    eventClone.find(".match-item-event-series").remove();
    const tournament = cleanText(eventClone.text()) || "VLR";
    const status = cleanText(el.find(".ml-status").first().text()).toLowerCase();

    matches.push({
      id,
      url: absoluteVlrUrl(href, baseUrl),
      tournament,
      stage,
      team1: teams[0],
      team2: teams[1],
      status: status || "upcoming",
      isLive: status === "live",
      dateLabel: currentDateLabel || null,
    });
  });

  return dedupeVlrMatches(matches);
}

export function parseVlrMatchDetailHtml(html: string, fallbackUrl = ""): Partial<VlrMatch> {
  const $ = cheerio.load(html);
  const header = $(".match-header").first();
  const eventLink = header.find(".match-header-event").first();
  const eventTitle = cleanText(eventLink.find("> div > div").first().text()) || cleanText(eventLink.clone().find(".match-header-event-series").remove().end().text());
  const series = cleanText(eventLink.find(".match-header-event-series").first().text()) || null;
  const teamNames = header.find(".match-header-link-name .wf-title-med")
    .map((_, el) => cleanTeamName($(el).text()))
    .get()
    .filter(Boolean);
  const utcTimestamp = header.find("[data-utc-ts]").first().attr("data-utc-ts") || null;
  const format = extractBestOf(cleanText(header.find(".match-header-vs-score").text()));
  const statusText = cleanText(header.find(".match-header-vs-note").first().text());
  const href = fallbackUrl || "";

  return {
    id: extractVlrMatchId(href) || undefined,
    url: href ? absoluteVlrUrl(href) : undefined,
    tournament: eventTitle || undefined,
    stage: series || undefined,
    team1: teamNames[0],
    team2: teamNames[1],
    utcTimestamp,
    unix_time: parseVlrUtcTimestamp(utcTimestamp),
    format,
    status: /live/i.test(statusText) ? "live" : "upcoming",
    isLive: /live/i.test(statusText),
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

    const teams = el.find(".event-sidebar-matches-team .name")
      .map((_, teamEl) => cleanTeamName($(teamEl).text()))
      .get()
      .filter(Boolean);
    if (teams.length < 2) return;

    const stage = cleanText(el.find(".event-sidebar-matches-series").first().text()) || null;
    const scoreText = cleanText(el.find(".score").text());
    const isLive = el.find(".eta.mod-live, .score.mod-live").length > 0 || /live/i.test(cleanText(el.find(".eta").text()));
    const isFinished = /\d/.test(scoreText) && !/–|-/.test(scoreText);
    if (isFinished && !isLive) return;

    matches.push({
      id,
      url: absoluteVlrUrl(href),
      tournament: title,
      stage,
      team1: teams[0],
      team2: teams[1],
      status: isLive ? "live" : "upcoming",
      isLive,
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

    const statusEl = el.find(".bracket-item-status[data-utc-ts], [data-utc-ts]").first();
    const utcTimestamp = statusEl.attr("data-utc-ts") || null;
    const stage = cleanText(el.closest(".bracket-col").find("> .bracket-col-label").first().text()) || null;

    matches.push({
      id,
      url: absoluteVlrUrl(href),
      tournament: title,
      stage,
      team1,
      team2,
      utcTimestamp,
      unix_time: parseVlrUtcTimestamp(utcTimestamp),
      status: isLive ? "live" : "upcoming",
      isLive,
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

  const parsed = new Date(`${raw.replace(" ", "T")}Z`);
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
  const match = value.match(/\bBo\s*([1357])\b/i);
  return match ? `BO${match[1]}` : null;
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
