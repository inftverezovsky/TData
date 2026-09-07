/** Локальные правила дисциплины для названий, дат и статуса. Контекстные часовые пояса не переносятся на другие дисциплины. */
import type { HtmlSelection } from "../htmlTypes";
import type { WikiDateParseOptions } from "@backend/normalizers/wikiText";
import { parseWikiDate, cleanWikiValue } from "@backend/normalizers/wikiText";
import { hasExplicitTimeText } from "@backend/matches/time";

const VALORANT_LIQUIPEDIA_DATE_OPTIONS: WikiDateParseOptions = {
  timezoneOffsets: {
    // On Chinese Valorant Liquipedia pages CST is China Standard Time.
    CST: 480,
  },
};

export function parseValorantWikiDate(value?: string | null) {
  return parseWikiDate(value, VALORANT_LIQUIPEDIA_DATE_OPTIONS);
}

export function normalizeValorantDateText(value?: string | null) {
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

export function firstClean(...values: Array<string | null | undefined>) {
  for (const v of values) {
    const c = cleanWikiValue(v);
    if (c) return c;
  }
  return null;
}

export function buildTemplateDateText(params: Record<string, string | undefined>) {
  const direct = firstClean(
    params.datetime,
    params.timestamp,
    params.starttime,
    params.start_time,
    params.date,
    params.time,
  );
  if (direct && hasExplicitTimeText(direct)) return direct;

  const date = firstClean(params.date, params.day, params.startdate, params.start_date);
  const time = firstClean(params.time, params.hour);
  const minute = firstClean(params.minute, params.min);
  const timezone = firstClean(params.timezone, params.tz, params.zone);
  if (date && time) {
    const clock = minute && /^\d{1,2}$/.test(time) ? `${time}:${minute.padStart(2, "0")}` : time;
    return [date, clock, timezone].filter(Boolean).join(" ");
  }

  return direct || null;
}

export function normalizeTeamName(raw: string) {
  const cleaned = cleanWikiValue(raw);
  if (!cleaned) return null;
  return cleaned
    .replace(/^team:/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTimestampAttr($el: HtmlSelection) {
  return $el.attr("data-timestamp") || $el.attr("data-unix") || null;
}

export function parseTimestampDate(value: string | null | undefined) {
  if (!value) return null;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 9_999_999_999 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isDateOnlyScheduleHeading(value: string | null | undefined) {
  return /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*(?:19|20)\d{2})?$/i.test(
    String(value || "").trim()
  );
}

export function inferTournamentStatus(startDate?: Date | null, endDate?: Date | null) {
  const now = Date.now();
  if (endDate && endDate.getTime() < now) return "finished";
  if (startDate && startDate.getTime() > now) return "upcoming";
  return "ongoing";
}
