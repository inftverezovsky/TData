/** Локальные правила дисциплины для названий, дат и статуса. Контекстные часовые пояса не переносятся на другие дисциплины. */
import type { HtmlSelection } from "../htmlTypes";
import { cleanWikiValue } from "@backend/normalizers/wikiText";
import { hasExplicitTimeText } from "@backend/matches/time";
import { isPlaceholderTeam } from "@backend/teams/teams";

/* ───── Helpers ───── */

export function firstClean(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = cleanWikiValue(value);
    if (cleaned) return cleaned;
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
