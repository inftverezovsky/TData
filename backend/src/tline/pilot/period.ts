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
