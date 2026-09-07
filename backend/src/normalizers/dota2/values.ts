/** Локальные правила дисциплины для названий, дат и статуса. Контекстные часовые пояса не переносятся на другие дисциплины. */
import type { WikiDateParseOptions } from "@backend/normalizers/wikiText";
import { parseWikiDate, cleanWikiValue } from "@backend/normalizers/wikiText";
import { hasExplicitTimeText } from "@backend/matches/time";
import { isPlaceholderTeam } from "@backend/teams/teams";

const DOTA2_LIQUIPEDIA_DATE_OPTIONS: WikiDateParseOptions = {
  timezoneOffsets: {
    // On Dota 2 Liquipedia Chinese-region pages CST is China Standard Time.
    // Keep this contextual so Counter-Strike/LoL pages can still reject ambiguous CST.
    CST: 480,
  },
};

/* ───── Helpers ───── */

export function parseDota2WikiDate(value?: string | null) {
  return parseWikiDate(value, DOTA2_LIQUIPEDIA_DATE_OPTIONS);
}

export function normalizeDota2DateText(value?: string | null) {
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
  if (datetime && hasExplicitTimeText(datetime)) return datetime;

  const date = firstClean(params.date, params.day, params.startdate, params.start_date);
  const time = firstClean(params.time, params.hour);
  const timezone = firstClean(params.timezone, params.tz, params.zone);
  const combined = [date, time, timezone].filter(Boolean).join(" ");
  if (combined) return combined;

  return firstClean(params.datetime, params.timestamp, params.time, params.date);
}

export function parseTimestamp(value: string | null | undefined) {
  const raw = Number(String(value || "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const date = new Date(raw > 9_999_999_999 ? raw : raw * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isLikelyTeamName(name: string) {
  if (isPlaceholderTeam(name)) return false;
  if (name.length < 2 || name.length > 80) return false;
  if (name.includes("=")) return false;
  return true;
}

export function isLikelyLayoutNoise(name: string) {
  return /^(date|time|score|vs|versus|match|round|bo\d?|best of)$/i.test(name.trim());
}

export function inferTournamentStatus(startDate?: Date | null, endDate?: Date | null) {
  const now = Date.now();
  if (endDate && endDate.getTime() < now) return "finished";
  if (startDate && startDate.getTime() > now) return "upcoming";
  if (startDate && startDate.getTime() <= now && (!endDate || endDate.getTime() >= now)) return "ongoing";
  return "unknown";
}
