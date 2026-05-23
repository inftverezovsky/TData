const MOSCOW_TIME_ZONE = "Europe/Moscow";
const MINUTE_MS = 60_000;

const DISCIPLINE_SCHEDULE_LEAD_MINUTES: Record<string, number> = {
  counterstrike: 5,
  "counter-strike": 5,
  "counter strike": 5,
  cs: 5,
  cs2: 5,
  csgo: 5,
  leagueoflegends: 10,
  "league-of-legends": 10,
  "league of legends": 10,
  lol: 10,
};

export function getDisciplineScheduleLeadMinutes(disciplineSlug: string | null | undefined) {
  const key = String(disciplineSlug ?? "").trim().toLowerCase();
  return DISCIPLINE_SCHEDULE_LEAD_MINUTES[key] ?? 0;
}

export function applyDisciplineScheduleLead<T extends Date | null | undefined>(
  date: T,
  disciplineSlug: string | null | undefined
): T {
  if (!date) return date;
  const minutes = getDisciplineScheduleLeadMinutes(disciplineSlug);
  if (!minutes) return date;
  return new Date(date.getTime() - minutes * MINUTE_MS) as T;
}

export function formatMoscowDateTime(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(",", "");
}

export function adjustMoscowDateTimeStringForDiscipline(
  value: string,
  disciplineSlug: string | null | undefined
) {
  const date = parseMoscowDateTime(value);
  if (!date) return value;
  return formatMoscowDateTime(applyDisciplineScheduleLead(date, disciplineSlug));
}

function parseMoscowDateTime(value: string) {
  const ready = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (ready) {
    return new Date(Date.UTC(
      Number(ready[3]),
      Number(ready[2]) - 1,
      Number(ready[1]),
      Number(ready[4]) - 3,
      Number(ready[5]),
      Number(ready[6] || "0")
    ));
  }

  const isoLike = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoLike) {
    return new Date(Date.UTC(
      Number(isoLike[1]),
      Number(isoLike[2]) - 1,
      Number(isoLike[3]),
      Number(isoLike[4]) - 3,
      Number(isoLike[5]),
      Number(isoLike[6] || "0")
    ));
  }

  return null;
}
