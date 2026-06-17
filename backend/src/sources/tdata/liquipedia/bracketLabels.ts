import type * as cheerio from "cheerio";

const BRACKET_HEADER_SELECTOR = [
  ".brkts-header",
  ".brkts-column-header",
  ".brkts-round-title",
  ".brkts-title",
  ".bracket-column-header",
  ".bracket-header",
  ".bracket-title",
  ".round-title",
].join(", ");

export function findLiquipediaBracketRoundLabel($: cheerio.CheerioAPI, matchEl: unknown): string | null {
  const $match = $(matchEl as any);
  const direct = firstCleanBracketLabel(
    $match.attr("data-round"),
    $match.attr("data-stage"),
    $match.attr("data-title"),
    $match.attr("data-match"),
    getMainText($, $match.find(".brkts-match-title, .brkts-match-header").first())
  );
  if (direct) return direct;

  const roundNumber = getRoundNumberFromMatch($, $match);
  const fromRoundBody = findRoundHeaderFromBody($, $match, roundNumber);
  if (fromRoundBody) return fromRoundBody;

  const fromColumn = findRoundHeaderFromColumn($, $match);
  if (fromColumn) return fromColumn;

  const fromBracket = roundNumber ? findRoundHeaderFromBracket($, $match, roundNumber) : null;
  if (fromBracket) return fromBracket;

  return null;
}

export function cleanLiquipediaBracketLabel(value: string | null | undefined) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8203;|\u200b/g, " ")
    .replace(/\[edit\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLikelyLiquipediaLayoutNoise(value: string | null | undefined) {
  const raw = String(value || "");
  const text = cleanLiquipediaBracketLabel(raw);
  if (!text) return true;

  if (/[<>]/.test(raw)) return true;
  if (/\b(?:class|data-[\w-]+|style|aria-label|href|src)=/i.test(raw)) return true;
  if (/\b(?:brkts|popup|generic-label|timer-object|match-info|mw-parser-output)\b/i.test(raw)) return true;
  if (/^(?:date|time|score|vs|versus|match|bo\d?|best of)$/i.test(text)) return true;
  if (/^(?:r\d+m\d+|m\d+|slot\s*\d+)$/i.test(text) || /^[#\d\s-]+$/.test(text)) return true;
  if (/^#?\d+(?:\s+#?\d+)+\s+/i.test(text) && /\bGame\s*\d+\b/i.test(text)) return true;
  if (
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|June|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(text) &&
    /\b\d{1,2}:\d{2}\b/.test(text) &&
    /\bGame\s*\d+\b/i.test(text)
  ) {
    return true;
  }

  return text.length > 90;
}

function findRoundHeaderFromBody($: cheerio.CheerioAPI, $match: cheerio.Cheerio<any>, roundNumber: number | null) {
  let current = $match.parent();

  for (let depth = 0; current.length > 0 && depth < 14; depth += 1) {
    if (current.hasClass("brkts-round-body")) {
      const labels = getHeaderLabels($, current.prevAll(".brkts-round-header").first());
      const inferred = inferHeaderLabelFromRoundBody($, current, $match, labels, roundNumber);
      if (inferred) return inferred;

      const picked = pickHeaderLabel(labels, roundNumber);
      if (picked) return picked;
    }

    current = current.parent();
  }

  return null;
}

function inferHeaderLabelFromRoundBody(
  $: cheerio.CheerioAPI,
  $body: cheerio.Cheerio<any>,
  $match: cheerio.Cheerio<any>,
  labels: string[],
  roundNumber: number | null
) {
  if ((roundNumber && labels[roundNumber - 1]) || labels.length <= 1) return null;

  const matchNode = $match.get(0);
  if (!matchNode) return null;

  const directCenterContainsMatch = $body.children(".brkts-round-center").toArray().some((centerEl) => {
    return centerEl === matchNode || $.contains(centerEl, matchNode);
  });

  if (!directCenterContainsMatch) return null;

  return labels[labels.length - 1] || null;
}

function findRoundHeaderFromColumn($: cheerio.CheerioAPI, $match: cheerio.Cheerio<any>) {
  const $column = $match.closest([
    ".brkts-column",
    ".brkts-round",
    ".brkts-bracket-column",
    ".bracket-column",
    ".bracket-round",
    "[class*='brkts-column']",
    "[class*='bracket-column']",
  ].join(", "));

  const label = firstCleanBracketLabel(
    $column.attr("data-round"),
    $column.attr("data-title"),
    getMainText($, $column.find(BRACKET_HEADER_SELECTOR).first())
  );
  if (label) return label;

  return firstCleanBracketLabel(
    getMainText($, $match.prevAll(BRACKET_HEADER_SELECTOR).first()),
    getMainText($, $match.parent().prevAll(BRACKET_HEADER_SELECTOR).first())
  );
}

function findRoundHeaderFromBracket($: cheerio.CheerioAPI, $match: cheerio.Cheerio<any>, roundNumber: number) {
  const $bracket = $match.closest(".brkts-bracket, .bracket");
  if (!$bracket.length) return null;

  const labels = getHeaderLabels($, $bracket.find(".brkts-round-header").first());
  return pickHeaderLabel(labels, roundNumber);
}

function getHeaderLabels($: cheerio.CheerioAPI, $header: cheerio.Cheerio<any>) {
  if (!$header.length) return [];

  const headers = $header.children(BRACKET_HEADER_SELECTOR);
  const source = headers.length ? headers : $header.find(BRACKET_HEADER_SELECTOR);
  return source
    .map((_, headerEl) => getMainText($, $(headerEl)))
    .get()
    .map((label) => firstCleanBracketLabel(label))
    .filter((label): label is string => Boolean(label));
}

function pickHeaderLabel(labels: string[], roundNumber: number | null) {
  if (labels.length === 0) return null;
  if (roundNumber && labels[roundNumber - 1]) return labels[roundNumber - 1];
  if (labels.length === 1) return labels[0];
  return null;
}

function getMainText($: cheerio.CheerioAPI, $node: cheerio.Cheerio<any>) {
  if (!$node.length) return null;
  const clone = $node.clone();
  clone.find(".brkts-header-option, .tooltip, .sortkey").remove();
  return clone.text();
}

function firstCleanBracketLabel(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = cleanLiquipediaBracketLabel(value);
    if (cleaned && !isLikelyLiquipediaLayoutNoise(value) && !isLikelyLiquipediaLayoutNoise(cleaned)) {
      return normalizeBracketLabel(cleaned);
    }
  }
  return null;
}

function normalizeBracketLabel(value: string) {
  return value
    .replace(/\bAdvance\s+to\s+Playoffs?\b/i, "To Playoff")
    .replace(/\bto\s+playoffs\b/i, "To Playoff")
    .replace(/\s+/g, " ")
    .trim();
}

function getRoundNumberFromMatch($: cheerio.CheerioAPI, $match: cheerio.Cheerio<any>) {
  const fragments: string[] = [];

  for (const attr of ["data-round", "data-match", "data-title", "id"]) {
    const value = $match.attr(attr);
    if (value) fragments.push(value);
  }

  $match.find("a[href*='Match:'], a[title*='Match:'], a[href*='match'], a[title*='match']").each((_, linkEl) => {
    const $link = $(linkEl);
    for (const attr of ["href", "title", "aria-label"]) {
      const value = $link.attr(attr);
      if (value) fragments.push(value);
    }
  });

  const raw = fragments.join(" ");
  const match =
    raw.match(/(?:^|[_\s-])R0*(\d+)\s*[-_ ]?M/i) ||
    raw.match(/\bRound\s*0*(\d+)\b/i);

  if (!match?.[1]) return null;
  const roundNumber = Number(match[1]);
  return Number.isFinite(roundNumber) && roundNumber > 0 ? roundNumber : null;
}
