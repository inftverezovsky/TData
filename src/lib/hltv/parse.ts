export function parseHltvDate(dateStr: string, today = new Date(), fallbackYearOverride?: number | null) {
  if (!dateStr) return null;
  const d = dateStr.replace(/\s+/g, " ").trim();
  if (/^(date|date tbd|tbd)$/i.test(d)) return null;
  if (/^(live|ongoing)$/i.test(d)) return { start: today, end: today };

  const years = Array.from(d.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((match) => Number(match[1]));
  const fallbackYear = years[years.length - 1] || fallbackYearOverride || today.getFullYear();

  const parsePart = (part: string, fallbackMonth = "") => {
    const clean = part.replace(/,/g, "").replace(/(\d{1,2})(st|nd|rd|th)/gi, "$1").trim();
    const match = clean.match(/^(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+)?(\d{1,2})(?:\s+(19\d{2}|20\d{2}))?$/i);
    if (!match) return null;

    const month = match[1] || fallbackMonth;
    const day = Number(match[2]);
    const year = Number(match[3] || fallbackYear);
    if (!month || !day || !year) return null;

    const date = new Date(`${month} ${day}, ${year}`);
    return Number.isNaN(date.getTime())
      ? null
      : {
          date,
          month,
          hasExplicitMonth: Boolean(match[1]),
          hasExplicitYear: Boolean(match[3]),
        };
  };

  if (d.includes(" - ")) {
    const [startPart, endPart] = d.split(" - ").map((part) => part.trim());
    const startSeed = parsePart(startPart);
    const end = parsePart(endPart, startSeed?.month || "");
    const start = startSeed ?? parsePart(startPart, end?.month || "");
    if (start && end) {
      if (start.date > end.date && !start.hasExplicitYear) {
        start.date.setFullYear(start.date.getFullYear() - 1);
      }
      return { start: start.date, end: end.date };
    }
  }

  const singleMatch = d.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+(?:19\d{2}|20\d{2}))?)/i);
  if (singleMatch) {
    const parsed = parsePart(singleMatch[1]);
    if (parsed) return { start: parsed.date, end: parsed.date };
  }

  const fallbackDate = new Date(d);
  if (!Number.isNaN(fallbackDate.getTime())) return { start: fallbackDate, end: fallbackDate };

  return null;
}

export function formatHltvDate(dates: string, today = new Date()) {
  const parsed = parseHltvDate(dates, today);
  if (!parsed) return dates;

  const formatDate = (date: Date) => {
    if (!date || Number.isNaN(date.getTime())) return "????-??-??";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  if (parsed.start.getTime() === parsed.end.getTime()) return formatDate(parsed.start);
  return `${formatDate(parsed.start)} — ${formatDate(parsed.end)}`;
}

export function cleanHltvTeamName(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+\d{1,2}$/, "")
    .trim();
}

export function shouldKeepHltvEvent(input: {
  title: string;
  href: string;
  dates?: string | null;
  status?: string | null;
  query?: string;
  today?: Date;
  futureWindowDays?: number;
}) {
  const today = input.today || new Date();
  if (!isRelevantToQuery(input.title, input.href, input.query || "")) return false;
  if (String(input.status || "").toLowerCase() === "finished") return false;
  if (isPastEventDate(input.dates || "", today)) return false;

  const year = extractYear(`${input.title} ${input.href}`);
  const parsed = parseHltvDate(input.dates || "", today, year);
  if (!queryHasExplicitYear(input.query || "") && parsed?.start) {
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const futureLimit = new Date(todayStart);
    futureLimit.setDate(todayStart.getDate() + (input.futureWindowDays ?? 60));
    futureLimit.setHours(23, 59, 59, 999);
    if (parsed.start > futureLimit) return false;
  }

  if (year && year < today.getFullYear()) return false;

  const status = String(input.status || "").toLowerCase();
  const knownCurrentStatus = status === "ongoing" || status === "upcoming";
  if (!parsed && !knownCurrentStatus && !year) return false;

  return true;
}

function queryHasExplicitYear(query: string) {
  return /\b(?:19\d{2}|20\d{2})\b/.test(query);
}

function isRelevantToQuery(title: string, href: string, query: string) {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalize(query).split(" ").filter((token) => token.length >= 2);
  if (tokens.length === 0) return true;
  const haystack = normalize(`${title} ${href}`);
  return tokens.every((token) => haystack.includes(token));
}

function isPastEventDate(dates: string, today: Date) {
  const parsed = parseHltvDate(dates, today);
  if (!parsed?.end) return false;

  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  return parsed.end < todayStart;
}

function extractYear(value: string) {
  const match = value.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}
