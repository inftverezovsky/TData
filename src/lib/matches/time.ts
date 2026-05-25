import { hasUnknownExplicitTimezone, parseWikiDate } from "@/lib/normalizers/wikiText";

export type MatchTimeInput = {
  matchDate?: Date | string | number | null;
  matchDateTime?: string | null;
  rawText?: string | null;
  sourceUrl?: string | null;
};

const CLOCK_TIME_RE = /(?:^|[^\d])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*(?:am|pm))?(?!\d)/i;
const TIMESTAMP_ATTR_RE = /\bdata-(?:timestamp|unix|time)=["']?(\d{9,13})["']?/i;
const WIKI_TEMPLATE_TIME_RE =
  /\{\{\s*(?:date|start date|start date and age|dts)\s*\|\s*(?:19|20)\d{2}\s*\|\s*[01]?\d\s*\|\s*[0-3]?\d\s*\|\s*(?:[01]?\d|2[0-3])\s*\|\s*[0-5]\d/i;

export function hasExplicitTimeText(...values: Array<unknown>) {
  return values.some((value) => {
    const text = getText(value);
    return Boolean(text && (CLOCK_TIME_RE.test(text) || TIMESTAMP_ATTR_RE.test(text) || WIKI_TEMPLATE_TIME_RE.test(text)));
  });
}

export function resolveExactMatchDate(match: MatchTimeInput): Date | null {
  const timestampDate = getTimestampDate(match.matchDateTime, match.rawText);
  if (timestampDate) return timestampDate;

  if (hasUnknownExplicitTimezone(match.matchDateTime)) {
    return null;
  }

  const explicitMatchDateTime = parseExplicitDateText(match.matchDateTime);
  if (explicitMatchDateTime) return explicitMatchDateTime;

  if (hasUnknownExplicitTimezone(match.rawText)) {
    return null;
  }

  const date = parseDateLike(match.matchDate);
  if (date && isTrustedExactDate(match, date)) return date;

  return parseExplicitDateText(match.rawText);
}

export function hasExactMatchTime(match: MatchTimeInput) {
  return Boolean(resolveExactMatchDate(match));
}

export function resolveDisplayMatchDate(match: MatchTimeInput): Date | null {
  const exactDate = resolveExactMatchDate(match);
  if (exactDate) return exactDate;
  if (hasUnknownExplicitTimezone(match.matchDateTime)) return null;

  const storedDate = parseDateLike(match.matchDate);
  if (storedDate) return storedDate;

  const textDate = parseLooseDateText(match.matchDateTime);
  if (textDate) return textDate;

  return null;
}

function isTrustedExactDate(match: MatchTimeInput, date: Date) {
  if (hasExplicitTimeText(match.matchDateTime, match.rawText)) return true;
  if (match.sourceUrl && /(?:^|\/\/)(?:www\.)?(?:hltv\.org|vlr\.gg)\//i.test(match.sourceUrl)) return true;
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
}

function parseExplicitDateText(...values: Array<unknown>) {
  for (const value of values) {
    const text = getText(value);
    if (!text || !hasExplicitTimeText(text)) continue;

    const parsed = parseWikiDate(text);
    if (parsed && Number.isFinite(parsed.getTime())) return parsed;
  }

  return null;
}

function parseLooseDateText(...values: Array<unknown>) {
  for (const value of values) {
    const text = getText(value);
    if (!text) continue;

    const parsed = parseWikiDate(text);
    if (parsed && Number.isFinite(parsed.getTime())) return parsed;
  }

  return null;
}

function getTimestampDate(...values: Array<unknown>) {
  for (const value of values) {
    const text = getText(value);
    const match = text?.match(TIMESTAMP_ATTR_RE);
    if (!match) continue;

    const raw = Number(match[1]);
    if (!Number.isFinite(raw) || raw <= 0) continue;

    const ms = raw > 9_999_999_999 ? raw : raw * 1000;
    const date = new Date(ms);
    if (Number.isFinite(date.getTime())) return date;
  }

  return null;
}

function parseDateLike(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
