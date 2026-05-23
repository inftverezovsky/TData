export type ManualHltvMatch = {
  id: string;
  tournament: string;
  team1: string;
  team2: string;
  date: string;
};

export function parseHltvCopiedText(text: string): ManualHltvMatch[] {
  const lines = normalizeLines(text);
  const tableScheduleMatches = parseTableScheduleLines(lines);
  if (tableScheduleMatches.length > 0) return tableScheduleMatches;

  const timeOnlyRegex = /^\d{1,2}:\d{2}$/;
  const timeStartRegex = /^(\d{1,2}:\d{2})\s+(.+)/;
  const dateRegex = /\d{4}-\d{2}-\d{2}/;
  const boRegex = /^(bo\d|во[з3s]|b[o0]\d)$/i;
  const boStartRegex = /^(bo\d|во[з3s]|b[o0]\d)\s+(.+)/i;

  const result: ManualHltvMatch[] = [];
  let currentTime = "Unknown";
  let currentDate = "";
  const teamNames: { name: string; time: string; date: string }[] = [];

  const cleanName = (s: string) => {
    return s
      .replace(/[®©@|«»<>+%#§°^~]/g, "")
      .replace(/^[^a-zA-Zа-яА-Я0-9]+\s*/g, "")
      .replace(/^[a-zA-Zа-яА-Я]\s+/g, "")
      .replace(/\s+(Lal|lal|LI|li|ll|Lall|lall)$/i, "")
      .replace(/\s+[A-Z]$/, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  for (const line of lines) {
    if (dateRegex.test(line)) {
      const dm = line.match(dateRegex);
      if (dm) currentDate = dm[0];
      continue;
    }

    if (timeOnlyRegex.test(line)) {
      currentTime = line;
      continue;
    }

    const timeTeamMatch = line.match(timeStartRegex);
    if (timeTeamMatch) {
      currentTime = timeTeamMatch[1];
      const rest = cleanName(timeTeamMatch[2]);
      if (rest.length > 1) {
        teamNames.push({ name: rest, time: currentTime, date: currentDate });
      }
      continue;
    }

    if (boRegex.test(line)) continue;

    const boTeamMatch = line.match(boStartRegex);
    if (boTeamMatch) {
      const rest = cleanName(boTeamMatch[2]);
      if (rest.length > 1) {
        teamNames.push({ name: rest, time: currentTime, date: currentDate });
      }
      continue;
    }

    const cleaned = cleanName(line);
    if (cleaned.length > 1) {
      teamNames.push({ name: cleaned, time: currentTime, date: currentDate });
    }
  }

  for (let i = 0; i < teamNames.length - 1; i += 2) {
    const t1 = teamNames[i];
    const t2 = teamNames[i + 1];
    let dateStr = t1.time;

    if (t1.date) {
      const [y, mo, d] = t1.date.split("-");
      dateStr = `${d}.${mo}.${y} ${t1.time}:00`;
    }

    result.push({
      id: `hltv-${stableMatchKey(t1.name, t2.name, dateStr).slice(0, 10)}`,
      tournament: "HLTV Import",
      team1: t1.name,
      team2: t2.name,
      date: dateStr,
    });
  }

  return result;
}

function normalizeLines(text: string) {
  const allLines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const lines: string[] = [];

  for (let i = 0; i < allLines.length; i++) {
    if (i > 0 && allLines[i] === allLines[i - 1]) continue;
    lines.push(allLines[i]);
  }

  return lines;
}

function parseTableScheduleLines(lines: string[]): ManualHltvMatch[] {
  const result: ManualHltvMatch[] = [];
  const pendingNames: string[] = [];

  for (const line of lines) {
    const meta = parseTableScheduleMeta(line);
    if (meta) {
      if (pendingNames.length >= 2) {
        const team1 = pendingNames[pendingNames.length - 2];
        const team2 = pendingNames[pendingNames.length - 1];
        result.push({
          id: `manual-${stableMatchKey(team1, team2, meta.date).slice(0, 10)}`,
          tournament: "Manual Import",
          team1,
          team2,
          date: meta.date,
        });
      }

      pendingNames.length = 0;
      continue;
    }

    const participant = cleanParticipantLine(line);
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

function parseTableScheduleMeta(line: string) {
  const normalized = line
    .replace(/[,\u2013\u2014;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const headMatch = normalized.match(/^(\d{1,2})\s+([А-Яа-яЁё]+)(?:\s+(\d{4}))?/);
  if (!headMatch) return null;

  const day = headMatch[1].padStart(2, "0");
  const month = getRussianMonthNumber(headMatch[2]);
  if (!month) return null;

  let rest = normalized.slice(headMatch[0].length).trim();
  let year = headMatch[3] || String(new Date().getFullYear());

  const yearMatch = rest.match(/^(\d{4})\b/);
  if (yearMatch) {
    year = yearMatch[1];
    rest = rest.slice(yearMatch[0].length).trim();
  }

  const timeMatch = rest.match(/(\d{1,2})[:.\s]?(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) return null;

  return {
    date: `${day}.${month}.${year} ${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}:${timeMatch[3] || "00"}`,
    table: null,
  };
}

function getRussianMonthNumber(monthWord: string) {
  const normalized = monthWord.toLowerCase().replace(/ё/g, "е");
  const monthMap: Array<[RegExp, string]> = [
    [/^январ[ья]$/i, "01"],
    [/^феврал[ья]$/i, "02"],
    [/^март[а]?$/i, "03"],
    [/^апрел[ья]$/i, "04"],
    [/^ма[йя]$|^мо[йя]$|^мон$|^ман$/i, "05"],
    [/^июн[ья]$/i, "06"],
    [/^июл[ья]$/i, "07"],
    [/^август[а]?$/i, "08"],
    [/^сентябр[ья]$/i, "09"],
    [/^октябр[ья]$/i, "10"],
    [/^ноябр[ья]$/i, "11"],
    [/^декабр[ья]$/i, "12"],
  ];

  for (const [pattern, value] of monthMap) {
    if (pattern.test(normalized)) return value;
  }

  return null;
}

function cleanParticipantLine(value: string) {
  const cleaned = cleanName(value);
  if (!cleaned) return null;
  if (/^\d{1,2}:\d{2}$/.test(cleaned)) return null;
  if (cleaned.includes("|") || cleaned.includes(",") || cleaned.includes(":")) return null;
  if (/\bСтол\b/i.test(cleaned)) return null;
  if (/\b(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\b/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function cleanName(s: string) {
  return s
    .replace(/[®©@|«»<>+%#§°^~]/g, "")
    .replace(/^[^a-zA-Zа-яА-Я0-9]+\s*/g, "")
    .replace(/^[a-zA-Zа-яА-Я]\s+/g, "")
    .replace(/\s+(Lal|lal|LI|li|ll|Lall|lall)$/i, "")
    .replace(/\s+[A-Z]$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableMatchKey(team1: string, team2: string, date: string) {
  let hash = 0;
  const value = `${team1}|${team2}|${date}`;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}
