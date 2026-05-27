export function extractFirstTemplateByPrefix(wikitext: string, prefix: string) {
  const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(prefix)}`, "i");
  const match = regex.exec(wikitext);
  if (!match) return null;
  return extractBalancedTemplate(wikitext, match.index);
}

export function extractTemplatesByNamePrefix(wikitext: string, prefix: string, limit = 300) {
  const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(prefix)}(?=\\s*(?:\\||\\}\\}))`, "gi");
  const templates: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(wikitext)) && templates.length < limit) {
    const template = extractBalancedTemplate(wikitext, match.index);
    if (template) templates.push(template);
    regex.lastIndex = match.index + 2;
  }

  return templates;
}

export function parseTemplate(template: string) {
  const trimmed = template.trim();
  const inner = trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(2, -2) : trimmed;
  const parts = splitTopLevel(inner, "|");
  const name = parts.shift()?.trim() ?? "";
  const params: Record<string, string> = {};
  const positional: string[] = [];

  for (const part of parts) {
    const eqIndex = findTopLevelChar(part, "=");
    if (eqIndex > 0) {
      const key = part.slice(0, eqIndex).trim().toLowerCase();
      const value = part.slice(eqIndex + 1).trim();
      params[key] = value;
    } else {
      positional.push(part.trim());
    }
  }

  return { name, params, positional };
}

export function extractSection(wikitext: string, names: string[]) {
  const escaped = names.map(escapeRegExp).join("|");
  const regex = new RegExp(`^={2,5}\\s*(?:${escaped})\\s*={2,5}\\s*$`, "gim");
  const match = regex.exec(wikitext);
  if (!match) return null;

  const start = match.index + match[0].length;
  const nextHeadingRegex = /^={2,5}\s*[^=]+\s*={2,5}\s*$/gim;
  nextHeadingRegex.lastIndex = start;
  const next = nextHeadingRegex.exec(wikitext);
  const end = next ? next.index : wikitext.length;

  return wikitext.slice(start, end).trim();
}

export function cleanWikiValue(value?: string | null) {
  if (!value) return null;
  let output = value;

  output = output.replace(/<!--.*?-->/gs, "");
  output = output.replace(/<ref[^>]*>.*?<\/ref>/gis, "");
  output = output.replace(/<ref[^/>]*\/>/gis, "");
  output = output.replace(/<br\s*\/?\s*>/gi, ", ");

  // Replace simple templates with their first useful positional value.
  let previous = "";
  while (previous !== output) {
    previous = output;
    output = output.replace(/\{\{([^{}]+)\}\}/g, (_match, inner: string) => {
      const parts = inner.split("|").map((part) => part.trim()).filter(Boolean);
      const templateName = parts[0] ?? "";
      const slashAbbr = templateName.match(/^abbr\/(.+)$/i);
      if (slashAbbr?.[1]) return slashAbbr[1].trim();
      if (/^abbr$/i.test(templateName) && parts[1]) return parts[1];
      const positional = parts.slice(1).find((part) => !part.includes("="));
      const named = parts.slice(1).find((part) => part.includes("=") && part.split("=")[1]?.trim());
      if (positional) return positional;
      if (named) return named.split("=").slice(1).join("=").trim();
      return "";
    });
  }

  output = output.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  output = output.replace(/\[\[([^\]]+)\]\]/g, "$1");
  output = output.replace(/'''/g, "").replace(/''/g, "");
  output = output.replace(/<[^>]+>/g, "");
  output = output.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'");
  output = output.replace(/\s+/g, " ").trim();

  return output.length > 0 ? output : null;
}

export type WikiDateParseOptions = {
  timezoneOffsets?: Record<string, number>;
};

export function parseWikiDate(value?: string | null, options: WikiDateParseOptions = {}): Date | null {
  const templatedDate = parseKnownDateTemplate(value, options);
  if (templatedDate === INVALID_EXPLICIT_TIMEZONE) return null;
  if (templatedDate) return templatedDate;

  const cleaned = cleanWikiValue(value);
  if (!cleaned) return null;

  // 1. Try ISO-like: 2026-05-10 12:00
  const isoWithTime = cleaned.match(/(20\d{2}|19\d{2})[-/]([01]?\d)[-/]([0-3]?\d)[ T]([0-2]?\d):([0-5]\d)(?::([0-5]\d))?(?:\s*(Z|UTC|GMT|[A-Z]{2,5}|[+-][0-2]\d:?[\d]{2}))?/i);
  if (isoWithTime) {
    const [, year, month, day, hour, min, sec, timezone] = isoWithTime;
    const timezoneDate = buildTimezoneAwareDate(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(min),
      Number(sec || 0),
      timezone,
      options
    );
    if (timezoneDate) return timezoneDate;
    if (hasExplicitTimezone(timezone)) return null;

    const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${min.padStart(2, "0")}:${(sec || "00").padStart(2, "0")}Z`);
    return date;
  }

  // 2. Try English format: May 10, 2026 - 12:00
  const englishWithTime = cleaned.match(/([a-zA-Z]+)\s+([0-3]?\d),?\s+(20\d{2}|19\d{2})\s*-\s*([0-2]?\d):([0-5]\d)(?:\s*(Z|UTC|GMT|[A-Z]{2,5}|[+-][0-2]\d:?[\d]{2}))?/i);
  if (englishWithTime) {
    const [, monthStr, day, year, hour, min, timezone] = englishWithTime;
    const month = parseEnglishMonth(monthStr);
    if (month) {
      const timezoneDate = buildTimezoneAwareDate(
        Number(year),
        month,
        Number(day),
        Number(hour),
        Number(min),
        0,
        timezone,
        options
      );
      if (timezoneDate) return timezoneDate;
      if (hasExplicitTimezone(timezone)) return null;
    }

    const date = new Date(`${monthStr} ${day}, ${year} ${hour}:${min}:00 UTC`);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // 3. Try plain ISO: 2026-05-10
  const iso = cleaned.match(/(20\d{2}|19\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/);
  if (iso) {
    const [, year, month, day] = iso;
    const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`);
    return date;
  }

  const englishDate = cleaned.match(/([a-zA-Z]+)\s+([0-3]?\d),?\s+(20\d{2}|19\d{2})(?!\s*[-–]\s*[0-2]?\d:[0-5]\d)/i);
  if (englishDate) {
    const [, monthStr, day, year] = englishDate;
    const month = parseEnglishMonth(monthStr);
    if (month) {
      return new Date(Date.UTC(Number(year), month - 1, Number(day), 0, 0, 0));
    }
  }

  if (/^(?:19|20)\d{2}$/.test(cleaned)) {
    return null;
  }

  const parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return date;
  }

  return null;
}

export function hasUnknownExplicitTimezone(value?: string | null, options: WikiDateParseOptions = {}) {
  if (!value) return false;
  if (parseKnownDateTemplate(value, options) === INVALID_EXPLICIT_TIMEZONE) return true;

  const cleaned = cleanWikiValue(value);
  if (!cleaned) return false;

  return findExplicitDateTimezoneTokens(cleaned).some((timezone) => {
    const normalized = timezone.trim().toUpperCase();
    if (normalized === "AM" || normalized === "PM") return false;
    return parseTimezoneOffsetMinutes(normalized, options) === null;
  });
}

const INVALID_EXPLICIT_TIMEZONE = Symbol("invalid explicit timezone");

function parseKnownDateTemplate(
  value?: string | null,
  options: WikiDateParseOptions = {}
): Date | null | typeof INVALID_EXPLICIT_TIMEZONE {
  if (!value) return null;

  const templateMatches = String(value).match(/\{\{[^{}]+\}\}/g) ?? [];
  for (const template of templateMatches) {
    const { name, params, positional } = parseTemplate(template);
    const normalizedName = name.trim().toLowerCase();

    if (!/^(date|start date|start date and age|dts)$/i.test(normalizedName)) {
      continue;
    }

    const positionalDate = parseDateTemplatePositionals(positional, params, options);
    if (positionalDate) return positionalDate;
  }

  return null;
}

function parseDateTemplatePositionals(
  positional: string[],
  params: Record<string, string>,
  options: WikiDateParseOptions
): Date | null | typeof INVALID_EXPLICIT_TIMEZONE {
  const clean = (value?: string | null) => cleanWikiValue(value) || "";
  const first = clean(positional[0]);
  const second = clean(positional[1]);
  const third = clean(positional[2]);

  if (/^(?:19|20)\d{2}$/.test(first) && second && third) {
    const year = Number(first);
    const month = Number(second);
    const day = Number(third);
    const hourText = clean(positional[3]) || clean(params.hour);
    let minuteText = clean(positional[4]) || clean(params.minute);
    let secondText = clean(positional[5]) || clean(params.second);
    let timezone = clean(positional[6]) || clean(params.tz) || clean(params.timezone) || null;

    if (minuteText && !/^\d{1,2}$/.test(minuteText) && !timezone) {
      timezone = minuteText;
      minuteText = "";
    }
    if (secondText && !/^\d{1,2}$/.test(secondText) && !timezone) {
      timezone = secondText;
      secondText = "";
    }

    const hour = Number(hourText || 0);
    const minute = Number(minuteText || 0);
    const secondValue = Number(secondText || 0);

    if (isValidDatePart(year, month, day, hour, minute, secondValue)) {
      const timezoneDate = buildTimezoneAwareDate(year, month, day, hour, minute, secondValue, timezone, options);
      if (timezoneDate) return timezoneDate;
      if (hasExplicitTimezone(timezone)) return INVALID_EXPLICIT_TIMEZONE;
      return new Date(Date.UTC(year, month - 1, day, hour, minute, secondValue));
    }
  }

  if (first) {
    const time = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(second) ? second : "";
    const timezone = time ? third : second;
    if (time && hasExplicitTimezone(timezone) && parseTimezoneOffsetMinutes(timezone, options) === null) {
      return INVALID_EXPLICIT_TIMEZONE;
    }
    return parseWikiDate([first, time, timezone].filter(Boolean).join(" "), options);
  }

  return null;
}

function isValidDatePart(year: number, month: number, day: number, hour: number, minute: number, second: number) {
  return (
    Number.isInteger(year) && year >= 1900 && year <= 2099 &&
    Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= 31 &&
    Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
    Number.isInteger(minute) && minute >= 0 && minute <= 59 &&
    Number.isInteger(second) && second >= 0 && second <= 59
  );
}

function buildTimezoneAwareDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone?: string | null,
  options: WikiDateParseOptions = {}
) {
  const offsetMinutes = parseTimezoneOffsetMinutes(timezone, options);
  if (offsetMinutes === null) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  const date = new Date(utcMs);
  return Number.isFinite(date.getTime()) ? date : null;
}

function hasExplicitTimezone(timezone?: string | null) {
  return Boolean(timezone && timezone.trim().length > 0);
}

function findExplicitDateTimezoneTokens(value: string) {
  const tokens: string[] = [];
  const patterns = [
    /(20\d{2}|19\d{2})[-/]([01]?\d)[-/]([0-3]?\d)[ T]([0-2]?\d):([0-5]\d)(?::([0-5]\d))?\s*(Z|UTC|GMT|[A-Z]{2,5}|[+-][0-2]\d:?[\d]{2})\b/gi,
    /([a-zA-Z]+)\s+([0-3]?\d),?\s+(20\d{2}|19\d{2})\s*-\s*([0-2]?\d):([0-5]\d)\s*(Z|UTC|GMT|[A-Z]{2,5}|[+-][0-2]\d:?[\d]{2})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const timezone = match[match.length - 1];
      if (timezone) tokens.push(timezone);
    }
  }

  return tokens;
}

function parseTimezoneOffsetMinutes(timezone?: string | null, options: WikiDateParseOptions = {}) {
  if (!timezone) return null;
  const normalized = timezone.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "Z" || normalized === "UTC" || normalized === "GMT") return 0;

  const override = getTimezoneOffsetOverride(normalized, options);
  if (override !== null) return override;

  const numeric = normalized.match(/^([+-])([0-2]\d):?([0-5]\d)$/);
  if (numeric) {
    const [, sign, hour, minute] = numeric;
    const value = Number(hour) * 60 + Number(minute);
    return sign === "-" ? -value : value;
  }

  const offsets: Record<string, number> = {
    CET: 60,
    CEST: 120,
    EET: 120,
    EEST: 180,
    MSK: 180,
    UTC: 0,
    GMT: 0,
    BST: 60,
    BRT: -180,
    KST: 540,
    JST: 540,
    SGT: 480,
    HKT: 480,
    ICT: 420,
    WIB: 420,
    WITA: 480,
    WIT: 540,
    AEST: 600,
    AEDT: 660,
    NZST: 720,
    NZDT: 780,
    TRT: 180,
    PST: -480,
    PDT: -420,
    MST: -420,
    MDT: -360,
    CDT: -300,
    EST: -300,
    EDT: -240,
  };

  return offsets[normalized] ?? null;
}

function getTimezoneOffsetOverride(normalizedTimezone: string, options: WikiDateParseOptions) {
  const overrides = options.timezoneOffsets;
  if (!overrides) return null;

  for (const [key, value] of Object.entries(overrides)) {
    if (key.trim().toUpperCase() !== normalizedTimezone) continue;
    if (Number.isFinite(value)) return value;
  }

  return null;
}

function parseEnglishMonth(month: string) {
  const normalized = month.trim().toLowerCase().slice(0, 3);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(normalized);
  return index >= 0 ? index + 1 : null;
}

export function parseInteger(value?: string | null) {
  const cleaned = cleanWikiValue(value);
  if (!cleaned) return null;
  const match = cleaned.match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

export function parseTeamOpponentScore(value?: string | null) {
  if (!value) return null;
  const match = String(value).match(/\|\s*(?:score|score\d+)\s*=\s*(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

export function extractBalancedTemplate(wikitext: string, startIndex: number) {
  let depth = 0;

  for (let index = startIndex; index < wikitext.length - 1; index++) {
    const pair = wikitext.slice(index, index + 2);
    if (pair === "{{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (pair === "}}") {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return wikitext.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function splitTopLevel(input: string, delimiter: string) {
  const parts: string[] = [];
  let current = "";
  let curlyDepth = 0;
  let squareDepth = 0;

  for (let index = 0; index < input.length; index++) {
    const pair = input.slice(index, index + 2);

    if (pair === "{{") {
      curlyDepth += 1;
      current += pair;
      index += 1;
      continue;
    }

    if (pair === "}}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      current += pair;
      index += 1;
      continue;
    }

    if (pair === "[[") {
      squareDepth += 1;
      current += pair;
      index += 1;
      continue;
    }

    if (pair === "]]") {
      squareDepth = Math.max(0, squareDepth - 1);
      current += pair;
      index += 1;
      continue;
    }

    const char = input[index];
    if (char === delimiter && curlyDepth === 0 && squareDepth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  parts.push(current);
  return parts;
}

function findTopLevelChar(input: string, charToFind: string) {
  let curlyDepth = 0;
  let squareDepth = 0;

  for (let index = 0; index < input.length; index++) {
    const pair = input.slice(index, index + 2);
    if (pair === "{{") {
      curlyDepth += 1;
      index += 1;
      continue;
    }
    if (pair === "}}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      index += 1;
      continue;
    }
    if (pair === "[[") {
      squareDepth += 1;
      index += 1;
      continue;
    }
    if (pair === "]]") {
      squareDepth = Math.max(0, squareDepth - 1);
      index += 1;
      continue;
    }
    if (input[index] === charToFind && curlyDepth === 0 && squareDepth === 0) {
      return index;
    }
  }

  return -1;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
