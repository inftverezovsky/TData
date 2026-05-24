export type ManualImportTimeShiftResult<T extends { date?: string }> = {
  matches: T[];
  changedCount: number;
  skippedCount: number;
};

export function shiftManualImportMatchDates<T extends { date?: string }>(
  matches: T[],
  minutesOffset: number
): ManualImportTimeShiftResult<T> {
  const safeOffset = Number.isFinite(minutesOffset) ? Math.trunc(minutesOffset) : 0;
  if (safeOffset === 0) {
    return {
      matches: matches.map((match) => ({ ...match })),
      changedCount: 0,
      skippedCount: matches.length,
    };
  }

  let changedCount = 0;
  let skippedCount = 0;
  const shiftedMatches = matches.map((match) => {
    const shiftedDate = shiftManualImportDate(match.date || "", safeOffset);
    if (!shiftedDate) {
      skippedCount += 1;
      return { ...match };
    }

    changedCount += 1;
    return { ...match, date: shiftedDate };
  });

  return {
    matches: shiftedMatches,
    changedCount,
    skippedCount,
  };
}

export function shiftManualImportDate(value: string, minutesOffset: number) {
  const parts = parseManualImportDateParts(value);
  if (!parts) return null;

  const timestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const shifted = new Date(timestamp + Math.trunc(minutesOffset) * 60_000);
  if (Number.isNaN(shifted.getTime())) return null;

  return [
    pad2(shifted.getUTCDate()),
    pad2(shifted.getUTCMonth() + 1),
    shifted.getUTCFullYear(),
  ].join(".") + ` ${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`;
}

function parseManualImportDateParts(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const ru = trimmed.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (ru) {
    return createValidDateParts({
      day: Number(ru[1]),
      month: Number(ru[2]),
      year: Number(ru[3]),
      hour: Number(ru[4]),
      minute: Number(ru[5]),
      second: Number(ru[6] || 0),
    });
  }

  const isoLike = trimmed.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (isoLike) {
    return createValidDateParts({
      year: Number(isoLike[1]),
      month: Number(isoLike[2]),
      day: Number(isoLike[3]),
      hour: Number(isoLike[4]),
      minute: Number(isoLike[5]),
      second: Number(isoLike[6] || 0),
    });
  }

  return null;
}

function createValidDateParts(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}) {
  const timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const date = new Date(timestamp);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second
  ) {
    return null;
  }

  return parts;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
