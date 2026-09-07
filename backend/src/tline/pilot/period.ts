import { DateTime } from "luxon";

export function parseTLinePeriodBoundary(value: unknown, boundary: "start" | "end") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${boundary === "start" ? "from" : "to"} must be an ISO date or datetime`);
  }
  const raw = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(raw)
    ? DateTime.fromISO(raw, { zone: "Europe/Moscow" })[boundary === "start" ? "startOf" : "endOf"]("day")
    : DateTime.fromISO(raw, { zone: "Europe/Moscow", setZone: true });
  if (!parsed.isValid) throw new Error(`Invalid period boundary: ${raw}`);
  return parsed.toUTC().toJSDate();
}

export function buildTLineSourceTeamSyncPeriod(now: Date, sourceTimezone: string, season?: string | null) {
  const currentMonth = DateTime.fromJSDate(now, { zone: sourceTimezone }).startOf("month");
  if (!currentMonth.isValid) throw new Error("A valid source timezone is required");
  const seasonStartYear = parseTLineSplitSeasonStartYear(season);
  const firstMonth = seasonStartYear === null
    ? currentMonth
    : DateTime.fromObject({ year: seasonStartYear, month: 7, day: 1 }, { zone: sourceTimezone });
  const afterTwelfthMonth = firstMonth.plus({ months: 12 });
  return Object.freeze({
    from: firstMonth.toUTC().toJSDate(),
    to: afterTwelfthMonth.minus({ milliseconds: 1 }).toUTC().toJSDate(),
  });
}

function parseTLineSplitSeasonStartYear(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{4})\/(\d{2}|\d{4})$/u);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = match[2].length === 2
    ? Math.floor(startYear / 100) * 100 + Number(match[2])
    : Number(match[2]);
  return endYear === startYear + 1 ? startYear : null;
}
