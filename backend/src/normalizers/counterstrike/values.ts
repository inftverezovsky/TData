/** Локальные правила дисциплины для названий, дат и статуса. Контекстные часовые пояса не переносятся на другие дисциплины. */
import type { WikiDateParseOptions } from "@backend/normalizers/wikiText";
import { parseWikiDate, cleanWikiValue } from "@backend/normalizers/wikiText";
import { isPlaceholderTeam } from "@backend/teams/teams";

const CHINA_CST_DATE_OPTIONS: WikiDateParseOptions = {
  timezoneOffsets: {
    // On Chinese Counter-Strike Liquipedia pages CST is China Standard Time.
    CST: 480,
  },
};

/* ───── Helpers ───── */

export function getCounterStrikeDateOptions(
  input: { title: string; pageUrl: string },
  params: Record<string, string>,
): WikiDateParseOptions {
  const context = [
    input.title,
    input.pageUrl,
    params.country,
    params.city,
    params.location,
    params.region,
    params.organizer,
  ].filter(Boolean).join(" ");

  if (/\b(?:china|cn|shanghai|perfect[_\s-]?world)\b|完美世界/i.test(context)) {
    return CHINA_CST_DATE_OPTIONS;
  }

  return {};
}

export function parseCounterStrikeWikiDate(value?: string | null, options: WikiDateParseOptions = {}) {
  return parseWikiDate(value, options);
}

export function normalizeCounterStrikeDateText(value?: string | null, options: WikiDateParseOptions = {}) {
  const cleaned = cleanWikiValue(value);
  if (!cleaned) return null;

  if (options.timezoneOffsets?.CST === 480) {
    return cleaned.replace(/\bCST\b/gi, formatTimezoneOffset(480));
  }

  return cleaned;
}

function formatTimezoneOffset(offsetMinutes: number) {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}${minutes}`;
}

export function firstClean(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = cleanWikiValue(value);
    if (cleaned) return cleaned;
  }
  return null;
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

export function buildTemplateDateText(params: Record<string, string>) {
  const datetime = firstClean(params.datetime, params.timestamp, params.starttime, params.start_time);
  if (datetime) return datetime;

  const date = firstClean(params.date, params.day, params.startdate, params.start_date);
  const time = firstClean(params.time, params.hour);
  const timezone = firstClean(params.timezone, params.tz, params.zone);
  const combined = [date, time, timezone].filter(Boolean).join(" ");
  if (combined) return combined;

  return firstClean(params.datetime, params.timestamp, params.time, params.date);
}

export function isLikelyTeamName(name: string) {
  if (isPlaceholderTeam(name)) return false;
  if (name.length < 2 || name.length > 80) return false;
  if (name.includes("=")) return false;
  return true;
}

export function inferTournamentStatus(startDate?: Date | null, endDate?: Date | null) {
  const now = Date.now();
  if (endDate && endDate.getTime() < now) return "finished";
  if (startDate && startDate.getTime() > now) return "upcoming";
  if (startDate && startDate.getTime() <= now && (!endDate || endDate.getTime() >= now)) return "ongoing";
  return "unknown";
}
