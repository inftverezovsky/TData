export type ManualHltvMatch = {
  id: string;
  tournament: string;
  team1: string;
  team2: string;
  date: string;
};

type ParseOptions = {
  now?: Date;
  tournament?: string;
};

type DateParts = {
  day: string;
  month: string;
  year: string;
};

type TeamEntry = {
  name: string;
  time: string;
  dateParts: DateParts | null;
};

type ScheduleMeta = {
  date: string;
  dateParts: DateParts | null;
  time: string;
};

const DEFAULT_TOURNAMENT = "Manual Import";
const VERSUS_REGEX = /\s+(?:vs\.?|v\.?|versus|против)\s+/i;
const MONTH_WORD_PATTERN =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|мо[йя]|мон|ман|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]";

export function parseHltvCopiedText(text: string, options: ParseOptions = {}): ManualHltvMatch[] {
  return parseManualScheduleText(text, options);
}

export function parseManualScheduleText(text: string, options: ParseOptions = {}): ManualHltvMatch[] {
  const lines = normalizeLines(text);
  if (!lines.length) return [];

  const now = options.now ?? new Date();
  const tournament = options.tournament ?? DEFAULT_TOURNAMENT;
  const tableAndInlineMatches = dedupeMatches([
    ...parseTableScheduleLines(lines, now, tournament),
    ...parseInlineScheduleLines(lines, now, tournament),
  ]);
  if (tableAndInlineMatches.length > 0) return tableAndInlineMatches;

  return dedupeMatches(parseBlockScheduleLines(lines, now, tournament));
}

function normalizeLines(text: string) {
  const allLines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeOcrLine(line))
    .filter((line) => line.length > 0);

  const lines: string[] = [];
  for (let i = 0; i < allLines.length; i++) {
    if (i > 0 && allLines[i].toLowerCase() === allLines[i - 1].toLowerCase()) continue;
    lines.push(allLines[i]);
  }

  return lines;
}

function normalizeOcrLine(line: string) {
  return line
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[|¦]/g, "|")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTableScheduleLines(lines: string[], now: Date, tournament: string): ManualHltvMatch[] {
  const result: ManualHltvMatch[] = [];
  const pendingNames: string[] = [];
  let currentDateParts: DateParts | null = null;

  for (const line of lines) {
    const dateOnly = parseDateOnlyLine(line, now);
    if (dateOnly) {
      currentDateParts = dateOnly;
      pendingNames.length = 0;
      continue;
    }

    const meta: ScheduleMeta | null = isTableScheduleMetaLine(line, now) ? parseScheduleMeta(line, now, currentDateParts) : null;
    if (meta) {
      if (pendingNames.length >= 2) {
        const team1 = pendingNames[pendingNames.length - 2];
        const team2 = pendingNames[pendingNames.length - 1];
        result.push(buildMatch(team1, team2, meta.date, tournament));
      }

      if (meta.dateParts) currentDateParts = meta.dateParts;
      pendingNames.length = 0;
      continue;
    }

    const participant = cleanParticipantLine(line, now);
    if (participant) {
      pendingNames.push(participant);
      if (pendingNames.length > 2) {
        pendingNames.splice(0, pendingNames.length - 2);
      }
      continue;
    }

    pendingNames.length = 0;
  }

  return result;
}

function parseInlineScheduleLines(lines: string[], now: Date, tournament: string): ManualHltvMatch[] {
  const result: ManualHltvMatch[] = [];
  let currentDateParts: DateParts | null = null;

  for (const line of lines) {
    const dateOnly = parseDateOnlyLine(line, now);
    if (dateOnly) {
      currentDateParts = dateOnly;
      continue;
    }

    const standaloneMeta = parseScheduleMeta(line, now, currentDateParts);
    if (standaloneMeta?.dateParts) {
      currentDateParts = standaloneMeta.dateParts;
    }

    if (!VERSUS_REGEX.test(line)) continue;

    const meta = parseScheduleMeta(line, now, currentDateParts);
    if (!meta) continue;
    if (meta.dateParts) currentDateParts = meta.dateParts;

    const teamPart = extractInlineTeamPart(line);
    const [team1Raw, team2Raw] = teamPart.split(VERSUS_REGEX);
    const team1 = cleanName(team1Raw || "");
    const team2 = cleanName(team2Raw || "");
    if (!team1 || !team2) continue;

    result.push(buildMatch(team1, team2, meta.date, tournament));
  }

  return result;
}

function parseBlockScheduleLines(lines: string[], now: Date, tournament: string): ManualHltvMatch[] {
  const result: ManualHltvMatch[] = [];
  const teamNames: TeamEntry[] = [];
  let currentTime = "";
  let currentDateParts: DateParts | null = null;

  for (const line of lines) {
    const dateOnly = parseDateOnlyLine(line, now);
    if (dateOnly) {
      currentDateParts = dateOnly;
      continue;
    }

    const timeOnly = parseTimeOnlyLine(line);
    if (timeOnly) {
      currentTime = timeOnly;
      continue;
    }

    const timeTeam = extractTimePrefixedTeam(line);
    if (timeTeam) {
      currentTime = timeTeam.time;
      pushTeamEntry(teamNames, timeTeam.team, currentTime, currentDateParts);
      continue;
    }

    const boTeam = extractBoPrefixedTeam(line);
    if (boTeam) {
      pushTeamEntry(teamNames, boTeam, currentTime, currentDateParts);
      continue;
    }

    const meta = parseScheduleMeta(line, now, currentDateParts);
    if (meta && !VERSUS_REGEX.test(line)) {
      currentTime = meta.time;
      currentDateParts = meta.dateParts ?? currentDateParts;
      continue;
    }

    if (isBoLine(line) || VERSUS_REGEX.test(line)) continue;

    const cleaned = cleanParticipantLine(line, now);
    if (cleaned) {
      pushTeamEntry(teamNames, cleaned, currentTime, currentDateParts);
    }
  }

  for (let i = 0; i < teamNames.length - 1; i += 2) {
    const t1 = teamNames[i];
    const t2 = teamNames[i + 1];
    if (!t1 || !t2) continue;
    const date = formatDateTime(t1.dateParts, t1.time);
    if (!date) continue;
    result.push(buildMatch(t1.name, t2.name, date, tournament === DEFAULT_TOURNAMENT ? "HLTV Import" : tournament));
  }

  return result;
}

function pushTeamEntry(teamNames: TeamEntry[], value: string, time: string, dateParts: DateParts | null) {
  const name = cleanName(value);
  if (name.length > 1) {
    teamNames.push({ name, time, dateParts });
  }
}

function parseScheduleMeta(line: string, now: Date, fallbackDateParts: DateParts | null): ScheduleMeta | null {
  const time = parseTimeFromLine(line);
  if (!time) return null;

  const dateParts = parseDatePartsFromLine(line, now) ?? fallbackDateParts;
  const date = formatDateTime(dateParts, time);
  if (!date) return null;

  return { date, dateParts, time };
}

function isTableScheduleMetaLine(line: string, now: Date) {
  return Boolean(parseDatePartsFromLine(line, now)) || /\b(?:table|tbl|стол)\s*\d+\b/i.test(line);
}

function parseDateOnlyLine(line: string, now: Date) {
  if (parseTimeFromLine(line)) return null;
  return parseDatePartsFromLine(line, now);
}

function parseDatePartsFromLine(line: string, now: Date): DateParts | null {
  const normalized = line.replace(/,/g, " ");

  const iso = normalized.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    return {
      day: iso[3].padStart(2, "0"),
      month: iso[2].padStart(2, "0"),
      year: iso[1],
    };
  }

  const dmy = normalized.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}))?\b/);
  if (dmy) {
    return {
      day: dmy[1].padStart(2, "0"),
      month: dmy[2].padStart(2, "0"),
      year: dmy[3] || String(now.getFullYear()),
    };
  }

  const dayMonth = normalized.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_WORD_PATTERN})\\.?\\s*(20\\d{2})?\\b`, "iu"));
  if (dayMonth) {
    const month = getMonthNumber(dayMonth[2]);
    if (month) {
      return {
        day: dayMonth[1].padStart(2, "0"),
        month,
        year: dayMonth[3] || String(now.getFullYear()),
      };
    }
  }

  const monthDay = normalized.match(new RegExp(`\\b(${MONTH_WORD_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(20\\d{2})?\\b`, "iu"));
  if (monthDay) {
    const month = getMonthNumber(monthDay[1]);
    if (month) {
      return {
        day: monthDay[2].padStart(2, "0"),
        month,
        year: monthDay[3] || String(now.getFullYear()),
      };
    }
  }

  return null;
}

function parseTimeOnlyLine(line: string) {
  const normalized = line.trim();
  const match = normalized.match(/^([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
}

function parseTimeFromLine(line: string) {
  const match = line.match(/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?::([0-5]\d))?\b/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
}

function extractTimePrefixedTeam(line: string) {
  const match = line.match(/^([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?::([0-5]\d))?\s+(.+)$/);
  if (!match) return null;

  return {
    time: `${match[1].padStart(2, "0")}:${match[2]}:${match[3] || "00"}`,
    team: cleanName(match[4].replace(/^\|+/, "")),
  };
}

function extractBoPrefixedTeam(line: string) {
  const match = line.match(/^(?:bo\d|b[o0]\d|во[з3s]|best\s+of\s+\d)\s+(.+)$/i);
  if (!match) return null;
  return cleanName(match[1]);
}

function isBoLine(line: string) {
  return /^(?:bo\d|b[o0]\d|во[з3s]|best\s+of\s+\d)$/i.test(line.trim());
}

function extractInlineTeamPart(line: string) {
  const pipePart = line
    .split("|")
    .map((part) => part.trim())
    .find((part) => VERSUS_REGEX.test(part));

  return stripScheduleTokens(pipePart || line);
}

function stripScheduleTokens(line: string) {
  return line
    .replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]20\d{2})?\b/g, " ")
    .replace(new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_WORD_PATTERN})\\.?\\s*(?:20\\d{2})?\\b`, "giu"), " ")
    .replace(new RegExp(`\\b(?:${MONTH_WORD_PATTERN})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\s*(?:20\\d{2})?\\b`, "giu"), " ")
    .replace(/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?::([0-5]\d))?\b/g, " ")
    .replace(/\b(?:bo\d|b[o0]\d|best\s+of\s+\d)\b/gi, " ")
    .replace(/\b(?:table|tbl|стол)\s*\d+\b/gi, " ")
    .replace(/[|,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanParticipantLine(value: string, now: Date) {
  const cleaned = cleanName(value);
  if (!cleaned) return null;
  if (parseTimeOnlyLine(cleaned)) return null;
  if (parseDatePartsFromLine(cleaned, now)) return null;
  if (parseTimeFromLine(cleaned)) return null;
  if (VERSUS_REGEX.test(cleaned)) return null;
  if (/\b(?:table|tbl|стол)\s*\d+\b/i.test(cleaned)) return null;
  if (/^(?:bo\d|b[o0]\d|best\s+of\s+\d)$/i.test(cleaned)) return null;

  return cleaned;
}

function cleanName(value: string) {
  return value
    .replace(/[®©@«»<>%#§°^~●•✓✔■□◆◇]/g, " ")
    .replace(/^\s*[^\p{L}\p{N}]+\s*/u, "")
    .replace(/\b(?:table|tbl|стол)\s*\d+\b/gi, " ")
    .replace(/\b(?:bo\d|b[o0]\d|best\s+of\s+\d)\b/gi, " ")
    .replace(/\s+(?:Lal|LI|ll|Lall)$/i, "")
    .replace(/\s+\d+(?:[.,]\d+)?%?$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getMonthNumber(monthWord: string) {
  const normalized = monthWord
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/ё/g, "е");

  const monthMap: Array<[RegExp, string]> = [
    [/^jan(?:uary)?$|^январ[ья]$/i, "01"],
    [/^feb(?:ruary)?$|^феврал[ья]$/i, "02"],
    [/^mar(?:ch)?$|^март[а]?$/i, "03"],
    [/^apr(?:il)?$|^апрел[ья]$/i, "04"],
    [/^may$|^ма[йя]$|^мо[йя]$|^мон$|^ман$/i, "05"],
    [/^jun(?:e)?$|^июн[ья]$/i, "06"],
    [/^jul(?:y)?$|^июл[ья]$/i, "07"],
    [/^aug(?:ust)?$|^август[а]?$/i, "08"],
    [/^sep(?:t(?:ember)?)?$|^сентябр[ья]$/i, "09"],
    [/^oct(?:ober)?$|^октябр[ья]$/i, "10"],
    [/^nov(?:ember)?$|^ноябр[ья]$/i, "11"],
    [/^dec(?:ember)?$|^декабр[ья]$/i, "12"],
  ];

  for (const [pattern, value] of monthMap) {
    if (pattern.test(normalized)) return value;
  }

  return null;
}

function formatDateTime(dateParts: DateParts | null, time: string) {
  if (!dateParts || !time) return "";
  const readyTime = time.length === 5 ? `${time}:00` : time;
  return `${dateParts.day}.${dateParts.month}.${dateParts.year} ${readyTime}`;
}

function buildMatch(team1: string, team2: string, date: string, tournament: string): ManualHltvMatch {
  return {
    id: `manual-${stableMatchKey(team1, team2, date).slice(0, 10)}`,
    tournament,
    team1,
    team2,
    date,
  };
}

function dedupeMatches(matches: ManualHltvMatch[]) {
  const seen = new Set<string>();
  const result: ManualHltvMatch[] = [];

  for (const match of matches) {
    const key = stableMatchKey(match.team1.toLowerCase(), match.team2.toLowerCase(), match.date);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }

  return result;
}

function stableMatchKey(team1: string, team2: string, date: string) {
  let hash = 0;
  const value = `${team1}|${team2}|${date}`;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}
