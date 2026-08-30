import type {
  TLineChampionshipResult,
  TLineComparison,
  TLineMatchSide,
  TLineRun,
  TLineRunState,
} from "./types";

const runStates = new Set<TLineRunState>([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "CANCELLED",
  "FAILED",
]);

export function normalizeTLineRun(value: unknown): TLineRun | null {
  if (!isRecord(value) || !Array.isArray(value.championships)) return null;
  const state = stringValue(value.state).toUpperCase() as TLineRunState;
  if (!runStates.has(state)) return null;

  const championships = value.championships
    .map(normalizeChampionship)
    .filter((item): item is TLineChampionshipResult => item !== null);

  return {
    id: stringValue(value.id) || "unknown-run",
    state,
    progress: numberValue(value.progress) ?? progressFromChampionships(championships, state),
    startedAt: nullableString(value.startedAt),
    finishedAt: nullableString(value.finishedAt),
    championships,
  };
}

export function summarizeTLineRun(run: TLineRun | null) {
  const championships = run?.championships ?? [];
  const errorChampionships = championships.filter((item) => item.severity === "ERROR" || item.severity === "CRITICAL").length;
  const processedChampionships = championships.filter((item) => !["QUEUED", "RUNNING", "CANCELLED"].includes(item.state ?? "SUCCEEDED")).length;
  return {
    totalChampionships: championships.length,
    processedChampionships,
    errorChampionships,
    unprocessedChampionships: championships.length - processedChampionships,
  };
}

export function filterTLineChampionships(
  championships: readonly TLineChampionshipResult[],
  query: string,
  status = "ALL"
) {
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  return championships.filter((championship) => {
    const hasError = championship.severity === "ERROR" || championship.severity === "CRITICAL";
    if (status === "ERROR" && !hasError) return false;
    if (status === "OK" && hasError) return false;
    if (!needle) return true;
    const searchable = [
      championship.name,
      ...championship.comparisons.flatMap((comparison) => [
        comparison.source?.externalId,
        comparison.source?.teamHome,
        comparison.source?.teamAway,
        comparison.admin?.externalId,
        comparison.admin?.teamHome,
        comparison.admin?.teamAway,
      ]),
    ].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
    return searchable.includes(needle);
  });
}

export function statusPresentation(status: string, manual = false, swapped = false) {
  if (status === "MANUAL_OK") return { label: "okᵐ", tone: "emerald" as const };
  if (status === "MANUAL_ERROR") return { label: "—ᵐ", tone: "red" as const };
  if (status === "IGNORED") return { label: "—ᵐ", tone: "slate" as const };
  if (status === "AUTO_OK" && swapped) return { label: "ok*", tone: "emerald" as const };
  const base = status === "AUTO_OK" || status === "OK"
    ? { label: "ok", tone: "emerald" as const }
    : status === "TIME_WARNING" || status === "SOURCE_TIME_UNDEFINED"
      ? { label: "—", tone: "amber" as const }
      : status === "UNPROCESSED" || status === "PENDING" || status === "PROCESSING" || status === "CANCELLED"
        ? { label: "—", tone: "slate" as const }
        : { label: "—", tone: "red" as const };
  return manual ? { ...base, label: `${base.label}ᵐ` } : base;
}

export function countChampionshipFailures(championship: TLineChampionshipResult) {
  if (championship.comparisons.length === 0) {
    return championship.severity === "ERROR" || championship.severity === "CRITICAL" ? 1 : 0;
  }
  return championship.comparisons.filter(
    (item) => statusPresentation(item.effectiveStatus, item.manual, item.swappedSides).tone !== "emerald",
  ).length;
}

export function emptyChampionshipMessage(championship: TLineChampionshipResult) {
  if (!championship.reasons.includes("NO_MATCHES_IN_PERIOD")) {
    return "В выбранном периоде матчи не найдены.";
  }
  const sourceMessage = "На официальном сайте нет матчей в выбранном периоде.";
  return championship.reasons.includes("ADMIN_LINE_NOT_CONFIGURED")
    ? `${sourceMessage} Сверка с Бетсити недоступна: линия Админа не настроена.`
    : sourceMessage;
}

export function championshipTone(championship: TLineChampionshipResult) {
  const tones = championship.comparisons.length > 0
    ? championship.comparisons.map((item) => statusPresentation(item.effectiveStatus, item.manual, item.swappedSides).tone)
    : [severityTone(championship.severity) ?? statusPresentation(championship.status).tone];
  if (tones.includes("red")) return "red" as const;
  if (tones.includes("amber")) return "amber" as const;
  if (tones.includes("slate")) return "slate" as const;
  return "emerald" as const;
}

export function formatTLineReasons(reasons: readonly string[], status: string, delta: number | null) {
  const codes = reasons.length > 0 ? reasons : [status];
  return [...new Set(codes.map((code) => reasonText(code, delta)))].join(" · ");
}

export function defaultMoscowDateTime(dayOffset: number, now = new Date()) {
  const current = zonedDateParts(now, "Europe/Moscow");
  const target = new Date(Date.UTC(current.year, current.month - 1, current.day + dayOffset));
  const endOfDay = dayOffset > 0;
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T${endOfDay ? "23:59" : "00:00"}`;
}

export function moscowInputToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Укажите корректный период.");
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const requested = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
  };
  const wallClockUtc = Date.UTC(requested.year, requested.month - 1, requested.day, requested.hour, requested.minute);
  const initialOffset = zonedOffsetMilliseconds(new Date(wallClockUtc), "Europe/Moscow");
  let instant = new Date(wallClockUtc - initialOffset);
  const correctedOffset = zonedOffsetMilliseconds(instant, "Europe/Moscow");
  instant = new Date(wallClockUtc - correctedOffset);
  const actual = zonedDateTimeParts(instant, "Europe/Moscow");
  if (Object.entries(requested).some(([key, expected]) => actual[key as keyof typeof actual] !== expected)) {
    throw new Error("Укажите корректный период.");
  }
  return instant.toISOString();
}

function normalizeChampionship(value: unknown): TLineChampionshipResult | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) return null;
  const comparisons = Array.isArray(value.comparisons)
    ? value.comparisons.map(normalizeComparison).filter((item): item is TLineComparison => item !== null)
    : [];
  return {
    id,
    name,
    state: stringValue(value.state || "SUCCEEDED").toUpperCase(),
    status: stringValue(value.status || value.effectiveStatus || "UNPROCESSED").toUpperCase(),
    severity: normalizeChampionshipSeverity(value),
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === "string") : [],
    comparisons,
  };
}

function normalizeChampionshipSeverity(value: Record<string, unknown>) {
  const explicit = stringValue(value.severity || value.effectiveSeverity).toUpperCase();
  if (explicit) return explicit;
  const status = stringValue(value.status || value.effectiveStatus).toUpperCase();
  if (status === "AUTO_OK" || status === "OK" || status === "MANUAL_OK") return "OK";
  if (status === "TIME_WARNING" || status === "SOURCE_TIME_UNDEFINED") return "WARNING";
  if (status === "UNPROCESSED" || status === "PENDING" || status === "PROCESSING" || status === "CANCELLED") return "UNPROCESSED";
  return "ERROR";
}

function normalizeComparison(value: unknown): TLineComparison | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  const automaticStatus = stringValue(value.automaticStatus || "UNPROCESSED").toUpperCase();
  const effectiveStatus = stringValue(value.effectiveStatus || automaticStatus).toUpperCase();
  return {
    id,
    automaticStatus,
    effectiveStatus,
    manual: Boolean(value.manual || value.manualDecision || effectiveStatus === "MANUAL_OK"),
    swappedSides: Boolean(value.swappedSides),
    timeDeltaMinutes: numberValue(value.timeDeltaMinutes),
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === "string") : [],
    source: normalizeMatchSide(value.source),
    admin: normalizeMatchSide(value.admin),
  };
}

function normalizeMatchSide(value: unknown): TLineMatchSide | null {
  if (!isRecord(value)) return null;
  return {
    externalId: nullableString(value.externalId || value.id),
    sourceUrl: safeOfficialUrl(value.sourceUrl),
    startsAt: nullableString(value.startsAt),
    sourceTimeText: nullableString(value.sourceTimeText),
    teamHome: stringValue(value.teamHome || value.homeTeam || value.team1),
    teamAway: stringValue(value.teamAway || value.awayTeam || value.team2),
    status: nullableString(value.status),
  };
}

function progressFromChampionships(championships: TLineChampionshipResult[], state: TLineRunState) {
  if (state === "SUCCEEDED" || state === "PARTIAL" || state === "CANCELLED" || state === "FAILED") return 100;
  if (championships.length === 0) return 0;
  return Math.round(championships.filter((item) => item.status !== "UNPROCESSED").length / championships.length * 100);
}

function isOkChampionship(status: string) {
  return status === "OK" || status === "AUTO_OK" || status === "MANUAL_OK";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function nullableString(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function severityTone(severity: string) {
  if (severity === "OK") return "emerald" as const;
  if (severity === "WARNING") return "amber" as const;
  if (severity === "ERROR" || severity === "CRITICAL") return "red" as const;
  if (severity === "UNPROCESSED") return "slate" as const;
  return null;
}

function reasonText(status: string, delta: number | null) {
  if (status === "TIME_WARNING" || status === "TIME_ERROR" || status === "TIME_CRITICAL") {
    return delta === null ? "Расхождение времени" : `Расхождение времени: ${delta > 0 ? "+" : ""}${Math.round(delta)}м`;
  }
  const messages: Record<string, string> = {
    AUTO_OK: "Данные совпадают",
    MANUAL_OK: "Подтверждено вручную",
    SOURCE_ONLY: "Матч отсутствует в Админе",
    ADMIN_ONLY: "Матч отсутствует на официальном сайте",
    MATCH_AMBIGUOUS: "Неоднозначное сопоставление матча",
    TEAM_UNMAPPED: "Команда не сопоставлена",
    DUPLICATE: "Обнаружен дубликат",
    DUPLICATE_SOURCE: "Дубликат на официальном сайте",
    DUPLICATE_ADMIN: "Дубликат в Админе",
    SOURCE_TIME_UNDEFINED: "Официальный источник не указал время",
    ADMIN_LINE_NOT_CONFIGURED: "Линия Админа не настроена",
    NO_MATCHES_IN_PERIOD: "На официальном сайте нет матчей в выбранном периоде",
    PARSER_FAILED: "Не удалось прочитать официальный источник",
    CANCELLED: "Проверка остановлена",
  };
  return messages[status] ?? "Требуется проверка";
}

function safeOfficialUrl(value: unknown) {
  const candidate = nullableString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || (url.hostname !== "volley.ru" && !url.hostname.endsWith(".volley.ru"))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function zonedDateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function zonedDateTimeParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute") };
}

function zonedOffsetMilliseconds(value: Date, timeZone: string) {
  const parts = zonedDateTimeParts(value, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(value.getTime() / 60_000) * 60_000;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
