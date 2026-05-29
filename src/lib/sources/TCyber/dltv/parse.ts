import * as cheerio from "cheerio";
import type { DltvEvent, DltvEventPage, DltvEventStatus, DltvMatch, DltvParticipant } from "./types";

const DLTV_ORIGIN = "https://ru.dltv.org";
const DATE_RANGE_RE = /((?:19|20)\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*-\s*((?:19|20)\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
const RUSSIAN_MONTHS: Record<string, number> = {
  "январь": 0,
  "января": 0,
  "февраль": 1,
  "февраля": 1,
  "март": 2,
  "марта": 2,
  "апрель": 3,
  "апреля": 3,
  "май": 4,
  "мая": 4,
  "июнь": 5,
  "июня": 5,
  "июль": 6,
  "июля": 6,
  "август": 7,
  "августа": 7,
  "сентябрь": 8,
  "сентября": 8,
  "октябрь": 9,
  "октября": 9,
  "ноябрь": 10,
  "ноября": 10,
  "декабрь": 11,
  "декабря": 11,
};

export function parseDltvEvents(html: string, baseUrl = DLTV_ORIGIN): DltvEvent[] {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, DltvEvent>();

  $("a.events__card-head[href*='/events/'], a.table__body-row[href*='/events/']").each((_, element) => {
    const href = $(element).attr("href") || "";
    const url = normalizeDltvUrl(href, baseUrl);
    if (!url || /\/events\/finished(?:$|[/?#])/i.test(url)) return;

    const text = cleanText($(element).text());
    const dates = extractDateRange(text);
    const title = cleanEventTitle(
      cleanText($(element).find(".events__card-head__info").text()) || text,
      dates
    );
    const id = extractDltvEventId(url);
    if (!id || !title) return;

    const event: DltvEvent = {
      id,
      title,
      url,
      dates: dates || undefined,
      status: detectEventStatus(text, $(element).closest("section").attr("class") || ""),
    };
    const existing = byUrl.get(url);
    if (!existing || scoreEvent(event) > scoreEvent(existing)) byUrl.set(url, event);
  });

  return Array.from(byUrl.values());
}

export function filterDltvEvents(events: DltvEvent[], query: string) {
  const tokens = normalizeSearchText(query).split(" ").filter((token) => token.length >= 2);
  if (tokens.length === 0) return events;
  return events.filter((event) => {
    const haystack = normalizeSearchText(`${event.title} ${event.id} ${event.url}`);
    return tokens.every((token) => haystack.includes(token));
  });
}

export function filterDltvEventsByWindow(events: DltvEvent[], now = new Date(), futureWindowDays = 60) {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const futureLimit = new Date(todayStart);
  futureLimit.setDate(todayStart.getDate() + futureWindowDays);
  futureLimit.setHours(23, 59, 59, 999);

  return events.filter((event) => {
    const range = parseDltvDateRange(event.dates || "");
    if (!range) return event.status === "live" || event.status === "ongoing";
    if (range.end && range.end < todayStart) return false;
    return range.start <= futureLimit;
  });
}

export function parseDltvEventPage(html: string, pageUrl: string): DltvEventPage {
  const $ = cheerio.load(html);
  const url = normalizeDltvUrl(pageUrl) || pageUrl;
  const id = extractDltvEventId(url);
  const title = cleanText($("h1").first().text()) || cleanTitle($("title").text()) || id.replace(/-/g, " ");
  const overviewText = cleanText($(".event__overview").first().text());
  const dates = extractDateRange(cleanText($(".event__title-dates").first().text()) || overviewText);
  const status = detectEventStatus(overviewText, "");
  const participantsByUrl = new Map<string, DltvParticipant>();

  $("a[href*='/teams/']").each((_, element) => {
    const href = $(element).attr("href") || "";
    const teamUrl = normalizeDltvUrl(href);
    if (!teamUrl) return;
    const name = cleanTeamName(
      cleanText($(element).find(".title").first().text())
      || cleanText($(element).find(".team__stats-name").first().text())
      || cleanText($(element).text())
    );
    if (!name || looksLikeTableRowNoise(name)) return;
    participantsByUrl.set(teamUrl, { name, url: teamUrl });
  });

  const matchUrls = unique(
    $("a[href*='/matches/']")
      .map((_, element) => normalizeDltvUrl($(element).attr("href") || ""))
      .get()
      .filter((value): value is string => Boolean(value && extractDltvMatchId(value)))
  );

  return {
    id,
    title,
    url,
    dates: dates || undefined,
    status,
    location: extractOverviewValue(overviewText, "Страна"),
    prizePool: extractPrizePool(overviewText),
    formatText: overviewText || null,
    participants: Array.from(participantsByUrl.values()).sort((a, b) => a.name.localeCompare(b.name)),
    matchUrls,
  };
}

export function parseDltvMatchPage(html: string, pageUrl: string): DltvMatch {
  const $ = cheerio.load(html);
  const url = normalizeDltvUrl(pageUrl) || pageUrl;
  const id = extractDltvMatchId(url);
  const title = cleanText($("title").text());
  const stage = cleanText($(".match__page > .event__title .event__title-dates").first().text())
    || cleanText($(".match__page > .event__title").first().text())
    || cleanText($("section.event__title").first().text())
    || null;
  const dateInfo = extractDltvMatchDate($);
  const dateText = dateInfo.text;
  const matchDate = dateInfo.date;
  const statusText = cleanText($(".score__finished").first().text());
  const teamNames = collectDltvTeamNames($);
  const fallbackTeams = parseTeamsFromTitle(title);
  const team1 = teamNames[0] || fallbackTeams.team1;
  const team2 = teamNames[1] || fallbackTeams.team2;
  const rawScore = parseScoreFromTitle(title) || parseCentralScore($);
  const status = detectMatchStatus({ statusText, title, matchDate, score: rawScore });
  const score = status === "upcoming" || status === "scheduled" ? null : rawScore;
  const explicitFormat = cleanText($(".score__format").first().text());
  const format = explicitFormat || (score ? `BO${Math.max((score.scoreA || 0) + (score.scoreB || 0), 1)}` : null);

  return {
    id,
    url,
    tournament: parseBreadcrumbTournament($),
    stage,
    team1,
    team2,
    scoreA: score?.scoreA ?? null,
    scoreB: score?.scoreB ?? null,
    matchDate,
    matchDateTime: dateText || null,
    format,
    status,
    rawText: cleanText($(".match__page").first().text()).slice(0, 2000) || title,
  };
}

function collectDltvTeamNames($: cheerio.CheerioAPI) {
  const selectors = [
    ".match__page-title .team__stats-name",
    ".match__page-title [class*='team'][class*='name']",
    ".match__team .team__name",
    ".team__stats .team__stats-name",
    "a[href*='/teams/'] .title",
    "a[href*='/teams/']",
  ];
  const names: string[] = [];
  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const name = cleanTeamName($(element).text() || $(element).attr("title") || $(element).attr("aria-label") || "");
      if (!name || looksLikeTableRowNoise(name)) return;
      if (/^(vs|versus|против|score|date)$/i.test(name)) return;
      if (/^tbd$/i.test(name) || !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) names.push(name);
    });
    if (names.length >= 2) break;
  }
  return names.slice(0, 2);
}

function extractDltvMatchDate($: cheerio.CheerioAPI) {
  const textCandidates = [
    cleanText($(".score__date").first().text()),
    cleanText($("[data-date]").first().attr("data-date") || ""),
    cleanText($("[datetime]").first().attr("datetime") || ""),
    cleanText($("time").first().attr("datetime") || $("time").first().text()),
  ].filter(Boolean);

  for (const text of textCandidates) {
    const parsed = parseDltvDate(text);
    if (parsed) return { text, date: parsed };
  }

  const timestampDate = extractTimestampDate($);
  if (timestampDate) return timestampDate;

  const jsonLdDate = extractJsonLdStartDate($);
  if (jsonLdDate) return jsonLdDate;

  return { text: textCandidates[0] || "", date: null };
}

function extractTimestampDate($: cheerio.CheerioAPI) {
  const attrs = ["data-timestamp", "data-unix", "data-time"];
  for (const attr of attrs) {
    const raw = $(`[${attr}]`).first().attr(attr);
    if (!raw || !/^\d{9,13}$/.test(raw)) continue;
    const num = Number(raw);
    const date = new Date(num > 9_999_999_999 ? num : num * 1000);
    if (Number.isFinite(date.getTime())) return { text: raw, date };
  }
  return null;
}

function extractJsonLdStartDate($: cheerio.CheerioAPI) {
  for (const script of $("script[type='application/ld+json']").toArray()) {
    try {
      const parsed = JSON.parse($(script).html() || "{}");
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        const startDate = findJsonDate(item);
        if (!startDate) continue;
        const parsedDate = parseDltvDate(startDate) || new Date(startDate);
        if (parsedDate instanceof Date && Number.isFinite(parsedDate.getTime())) {
          return { text: startDate, date: parsedDate };
        }
      }
    } catch {}
  }
  return null;
}

function findJsonDate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.startDate === "string") return record.startDate;
  if (typeof record.startTime === "string") return record.startTime;
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = findJsonDate(item);
        if (found) return found;
      }
    } else if (nested && typeof nested === "object") {
      const found = findJsonDate(nested);
      if (found) return found;
    }
  }
  return null;
}

export function extractDltvEventId(pageUrl: string) {
  const path = safeUrl(pageUrl)?.pathname || pageUrl;
  const match = path.match(/\/events\/([^/?#]+)/i);
  return decodeURIComponent(match?.[1] || "").trim();
}

export function extractDltvMatchId(pageUrl: string) {
  const path = safeUrl(pageUrl)?.pathname || pageUrl;
  const match = path.match(/\/matches\/(\d+)(?:\/|$)/i);
  return match?.[1] || "";
}

export function normalizeDltvUrl(href: string, baseUrl = DLTV_ORIGIN) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, baseUrl);
    if (!/(^|\.)dltv\.org$/i.test(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function parseBreadcrumbTournament($: cheerio.CheerioAPI) {
  for (const script of $("script[type='application/ld+json']").toArray()) {
    try {
      const parsed = JSON.parse($(script).html() || "{}");
      const items = Array.isArray(parsed.itemListElement) ? parsed.itemListElement : [];
      const eventItem = items.find((item: any) => typeof item?.item === "string" && /\/events\//.test(item.item));
      if (eventItem?.name) return cleanText(eventItem.name);
    } catch {}
  }
  return undefined;
}

function parseTeamsFromTitle(title: string) {
  const clean = title.replace(/\s+-\s+DLTV.*$/i, "").trim();
  const scored = clean.match(/^(.+?)\s+\d+\s*-\s*\d+\s+(.+?)\s*\(/);
  if (scored) return { team1: cleanTeamName(scored[1]), team2: cleanTeamName(scored[2]) };
  const vs = clean.match(/^(.+?)\s+vs\s+(.+?)(?:\s+\(|$)/i);
  return { team1: cleanTeamName(vs?.[1] || ""), team2: cleanTeamName(vs?.[2] || "") };
}

function parseScoreFromTitle(title: string) {
  const withoutDates = cleanText(title)
    .replace(/\b(?:19|20)\d{2}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
  const match = withoutDates.match(/(?:^|\s)(\d{1,2})\s*-\s*(\d{1,2})(?=\s|$)/);
  return match ? { scoreA: Number(match[1]), scoreB: Number(match[2]) } : null;
}

function parseCentralScore($: cheerio.CheerioAPI) {
  return parseScoreFromTitle(cleanText($(".score__scores").first().text()))
    || parseScoreFromTitle(cleanText($(".score").first().text()))
    || parseScoreFromTitle(cleanText($(".match__page-title").first().text()));
}

function parseDltvDateRange(value: string) {
  const match = cleanText(value).match(DATE_RANGE_RE);
  if (!match) return null;
  const start = parseDltvDate(match[1]);
  const end = parseDltvDate(match[2]) || start;
  return start ? { start, end } : null;
}

function parseDltvDate(value: string) {
  const isoWithTimezone = value.match(/((?:19|20)\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/);
  if (isoWithTimezone) {
    const date = new Date(isoWithTimezone[1]);
    if (Number.isFinite(date.getTime())) return date;
  }

  const match = value.match(/((?:19|20)\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || "0")));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const russian = value.match(/(\d{1,2})\s+([а-яё]+)\s+((?:19|20)\d{2})\s*(?:г\.?|года)?(?:\s*[-–—,]\s*|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (!russian) return null;

  const month = RUSSIAN_MONTHS[russian[2].toLowerCase()];
  if (month === undefined) return null;
  const date = new Date(Date.UTC(Number(russian[3]), month, Number(russian[1]), Number(russian[4]) - 3, Number(russian[5]), Number(russian[6] || "0")));
  return Number.isFinite(date.getTime()) ? date : null;
}

function detectMatchStatus(params: {
  statusText: string;
  title: string;
  matchDate: Date | null;
  score: { scoreA: number; scoreB: number } | null;
}) {
  const combined = cleanText(`${params.statusText} ${params.title}`).toLowerCase();
  if (/предстоящ|upcoming|scheduled|вр\.\s*начала|начал/i.test(combined)) return "upcoming";
  if (/\blive\b|прямой|ид[её]т/i.test(combined)) return "live";
  if (/итог|заверш|finished|result/i.test(combined)) return "finished";
  if (params.score && (params.score.scoreA > 0 || params.score.scoreB > 0) && !isFutureDate(params.matchDate)) return "finished";
  return isFutureDate(params.matchDate) ? "upcoming" : "scheduled";
}

function extractDateRange(value: string) {
  const match = cleanText(value).match(DATE_RANGE_RE);
  return match ? `${match[1]} - ${match[2]}` : "";
}

function cleanEventTitle(value: string, dates?: string) {
  let title = cleanText(value)
    .replace(/^LIVE\s+/i, "")
    .replace(DATE_RANGE_RE, "")
    .replace(/\b(?:призовой фонд|A-Tier|B-Tier|C-Tier|S-Tier|Tier)\b.*$/i, "")
    .replace(/\b(?:Europe|Denmark|France|Kazakhstan|China|Romania|Saudi Arabia|Asia|CIS|Online|South America|North America)\b.*$/i, "")
    .trim();
  if (dates) title = title.replace(dates, "").trim();
  return title;
}

function cleanTitle(value: string) {
  return cleanText(value).replace(/^Турнир\s+/i, "").replace(/\s+\|\s+DLTV$/i, "").trim();
}

function cleanTeamName(value: string) {
  return cleanText(value)
    .replace(/\b(?:Силы Света|Силы света|Силы тьмы|Radiant|Dire)\b/gi, "")
    .replace(/\b(?:win|FB|F10|Users'? choice)\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?%\b/g, "")
    .replace(/\s+\d+\s*-\s*\d+(?:\s+\d+\s*-\s*\d+)?\s*\d*$/g, "")
    .replace(/^\d+\s+/, "")
    .replace(/\s+\d+$/, "")
    .trim();
}

function looksLikeTableRowNoise(value: string) {
  return value.length > 80 || /\b\d+\s*-\s*\d+\b.*\b\d+\s*-\s*\d+\b/.test(value);
}

function extractOverviewValue(text: string, label: string) {
  const labels = ["Даты", "Страна", "Тир турнира", "Тип турнира", "призовой фонд", "Участники", "Команды"];
  const escaped = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nextLabels = escaped.filter((item) => item !== label).join("|");
  const match = text.match(new RegExp(`${label}\\s+(.+?)(?=\\s+(?:${nextLabels})\\s+|$)`, "i"));
  return match ? cleanText(match[1]) : null;
}

function extractPrizePool(text: string) {
  const match = text.match(/призовой фонд\s+(.+?)(?=\s+Участники|\s+Команды|$)/i);
  return match ? cleanText(match[1]) : null;
}

function detectEventStatus(text: string, context: string): DltvEventStatus {
  const combined = `${text} ${context}`.toLowerCase();
  if (/\blive\b|ongoing__events/.test(combined)) return "live";
  if (/upcoming__events|предст|будущ/i.test(combined)) return "upcoming";
  return "ongoing";
}

function scoreEvent(event: DltvEvent) {
  return (event.title ? 10 : 0) + (event.dates ? 4 : 0) + (event.status === "live" ? 2 : 0);
}

function isFutureDate(date: Date | null | undefined) {
  return Boolean(date && date.getTime() > Date.now());
}

function normalizeSearchText(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9а-яё]+/gi, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value: string) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function safeUrl(value: string) {
  try {
    return new URL(value, DLTV_ORIGIN);
  } catch {
    return null;
  }
}
