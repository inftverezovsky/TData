import { createHash } from "crypto";
import * as cheerio from "cheerio";
import type { ImportStatus } from "@prisma/client";
import {
  cleanWikiValue,
  extractFirstTemplateByPrefix,
  extractSection,
  parseInteger,
  parseTemplate,
  parseWikiDate,
} from "@/lib/normalizers/wikiText";
import type { NormalizedMatch, NormalizedParticipant, NormalizedTournament } from "@/lib/normalizers/types";
import { getBestOfLabel } from "@/lib/matches/format";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";

export function normalizeFandomLeagueOfLegendsTournament(input: {
  pageId?: number;
  title: string;
  pageUrl: string;
  wikitext: string;
  parsedHtml?: string;
  cargoMatches?: unknown[];
}): NormalizedTournament {
  const warnings: string[] = [];
  const infobox = extractFirstTemplateByPrefix(input.wikitext, "Infobox");
  const parsedInfobox = infobox ? parseTemplate(infobox) : null;
  const params = parsedInfobox?.params ?? {};

  const name = firstClean(params.name, params.tournament, params.event, params.league) ?? input.title;
  const startDate = parseWikiDate(params.sdate ?? params.startdate ?? params.start_date ?? params.date ?? params.dates);
  const endDate = parseWikiDate(params.edate ?? params.enddate ?? params.end_date ?? params.date2);
  const location = firstClean(params.location, params.venue, params.city, params.country);
  const region = firstClean(params.region, params.server, params.realm);
  const organizer = firstClean(params.organizer, params.organizer2, params.organizers, params.host);
  const prizePool = firstClean(params.prizepoolusd, params.prizepool, params.prize_pool, params.prize, params.prizemoney);
  const formatText = firstClean(params.format, params.format1, params.format2, params.type);

  const participants = extractFandomParticipants(input.wikitext, input.parsedHtml);
  const teamNameMap = buildTeamNameMap(participants);
  const matches = [
    ...extractFandomCargoScheduleMatches(input.cargoMatches || [], input.pageUrl),
    ...extractFandomTopScheduleMatches(input.parsedHtml || "", input.pageUrl, input.title),
    ...extractFandomMatchlistMatches(input.parsedHtml || "", input.pageUrl),
    ...extractFandomBracketMatches(input.parsedHtml || "", input.pageUrl),
    ...extractFandomWikitextMatches(input.wikitext, input.pageUrl),
  ]
    .map((match, index) => normalizeFandomMatch(match, input.title, String(index), teamNameMap))
    .filter((match): match is NormalizedMatch => Boolean(match));

  applyTbdPairCycling(matches, input.title);

  if (!parsedInfobox) warnings.push("Fandom infobox не найден. Карточка турнира будет неполной.");
  if (!startDate && !endDate) warnings.push("Даты турнира не извлечены из Fandom infobox.");
  if (matches.length === 0) warnings.push("Fandom не вернул будущих матчей с точным временем.");

  return {
    sourcePageId: input.pageId,
    sourceTitle: input.title,
    sourceUrl: input.pageUrl,
    name,
    startDate,
    endDate,
    location,
    region,
    organizer,
    prizePool,
    formatText,
    tournamentStatus: inferTournamentStatus(startDate, endDate),
    participants,
    matches: dedupeFandomMatches(matches),
    subPages: [],
    warnings,
    status: (matches.length > 0 || participants.length > 0 ? "SUCCESS" : "PARTIAL") as ImportStatus,
  };
}

export function extractFandomParticipants(wikitext: string, html?: string): NormalizedParticipant[] {
  const candidates = new Map<string, NormalizedParticipant>();

  if (html) {
    const $ = cheerio.load(html);
    $("table.tournament-roster").each((_, tableEl) => {
      const $table = $(tableEl);
      const $team = $table.find(".tournament-roster-header a.catlink-teams, th a.catlink-teams").first();
      const name = cleanTeamName($team.attr("title") || $team.text());
      if (!name) return;

      const $img = $table.find("img").first();
      const logoUrl = normalizeFandomImageUrl($img.attr("data-src") || $img.attr("src"));
      addFandomParticipant(candidates, {
        name,
        logoUrl,
        rawText: $.html(tableEl)?.slice(0, 2000) || null,
      });
    });

    $(".team-card a.catlink-teams, .participant-card a.catlink-teams").each((_, el) => {
      const $team = $(el);
      const name = cleanTeamName($team.attr("title") || $team.text());
      if (name) addFandomParticipant(candidates, { name });
    });
  }

  const section = extractSection(wikitext, ["Participants", "Teams", "Participating Teams", "Qualified Teams"]) ?? "";
  const source = section || wikitext.slice(0, Math.min(wikitext.length, 40000));
  const patterns = [
    /\|\s*team\s*=\s*([^|}\n]+)/gi,
    /\{\{\s*(?:Team|TeamLink|TeamShort)\s*\|\s*([^|}\n]+)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const name = cleanTeamName(match[1]);
      if (name) addFandomParticipant(candidates, { name, rawText: match[0] });
    }
  }

  return Array.from(candidates.values()).slice(0, 64);
}

function addFandomParticipant(candidates: Map<string, NormalizedParticipant>, participant: NormalizedParticipant) {
  const name = participant.name.trim();
  const lower = name.toLowerCase();
  const existingExact = candidates.get(lower);
  if (existingExact) {
    candidates.set(lower, { ...existingExact, ...participant, logoUrl: existingExact.logoUrl || participant.logoUrl || null });
    return;
  }

  for (const [existingKey, existing] of candidates) {
    if (isFandomShortAlias(lower, existingKey)) return;
    if (isFandomShortAlias(existingKey, lower)) {
      candidates.delete(existingKey);
      candidates.set(lower, { ...existing, ...participant, name, logoUrl: participant.logoUrl || existing.logoUrl || null });
      return;
    }
  }

  candidates.set(lower, participant);
}

function isFandomShortAlias(shortName: string, longName: string) {
  if (shortName === longName) return false;
  if (shortName.length < 3 || shortName.length >= longName.length) return false;
  return longName === `${shortName} esports` || longName === `team ${shortName}` || longName.startsWith(`${shortName} `);
}

function extractFandomMatchlistMatches(html: string, pageUrl: string): NormalizedMatch[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

  $("tr").each((_, rowEl) => {
    const $row = $(rowEl);
    const $teamA = $row.find(".matchlist-team1, .ml-team1").first();
    const $teamB = $row.find(".matchlist-team2, .ml-team2").first();
    if (!$teamA.length || !$teamB.length) return;

    const teamAName = getFandomTeamName($, $teamA);
    const teamBName = getFandomTeamName($, $teamB);
    if (!teamAName && !teamBName) return;

    const scores = $row.find(".matchlist-score").map((__, scoreEl) => $(scoreEl).text().trim()).get();
    const scoreA = parseInteger(scores[0]);
    const scoreB = parseInteger(scores[1]);
    if (scoreA !== null || scoreB !== null) return;

    const dateText =
      $row.find(".countdowndate").first().text().trim() ||
      $row.find(".TimeInLocal").first().text().trim() ||
      "";
    const matchDate = parseFandomDate(dateText);
    if (!matchDate) return;

    const rawText = $.html(rowEl)?.slice(0, 2500) || null;
    matches.push({
      stage: findNearestHeading($, rowEl, "h2, .mw-headline") || null,
      round: findNearestHeading($, rowEl, "h3, .matchlist-header") || null,
      matchDate,
      matchDateTime: dateText || null,
      teamAName,
      teamBName,
      scoreA: null,
      scoreB: null,
      format: getBestOfLabel(rawText),
      status: "scheduled",
      sourceUrl: pageUrl,
      rawText,
    });
  });

  return matches;
}

export function extractFandomCargoScheduleMatches(rows: unknown[], pageUrl: string): NormalizedMatch[] {
  const matches: NormalizedMatch[] = [];

  for (const item of rows) {
    const row = unwrapCargoRow(item);
    if (!row) continue;

    const teamAName = cleanTeamName(
      firstCargoValue(row, "Team1Final", "Team1", "Player1") ||
      firstCargoValue(row, "team1final", "team1", "player1")
    );
    const teamBName = cleanTeamName(
      firstCargoValue(row, "Team2Final", "Team2", "Player2") ||
      firstCargoValue(row, "team2final", "team2", "player2")
    );
    if (!teamAName && !teamBName) continue;

    const scoreA = parseInteger(firstCargoValue(row, "Team1Score", "Team1Points"));
    const scoreB = parseInteger(firstCargoValue(row, "Team2Score", "Team2Points"));
    if (scoreA !== null || scoreB !== null) continue;

    const hasTime = parseCargoBoolean(firstCargoValue(row, "HasTime", "hasTime"));
    const dateText = firstCargoValue(row, "DateTime_UTC", "DateTime UTC", "UTC", "DateTime");
    const matchDate = parseFandomDate(dateText);
    if (!matchDate || hasTime === false) continue;

    const bestOf = parseInteger(firstCargoValue(row, "BestOf", "bestof"));
    const rawText = JSON.stringify(row).slice(0, 2500);

    matches.push({
      stage: firstClean(
        firstCargoValue(row, "Tab"),
        firstCargoValue(row, "Phase"),
      ),
      round: firstClean(
        firstCargoValue(row, "ShownRound"),
        firstCargoValue(row, "Round"),
        formatMatchDay(firstCargoValue(row, "MatchDay")),
      ),
      matchDate,
      matchDateTime: dateText,
      teamAName,
      teamBName,
      scoreA: null,
      scoreB: null,
      format: bestOf ? `BO${bestOf}` : getBestOfLabel(rawText),
      status: "scheduled",
      sourceUrl: pageUrl,
      rawText,
    });
  }

  return matches;
}

function extractFandomTopScheduleMatches(html: string, pageUrl: string, pageTitle: string): NormalizedMatch[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

  $(".topschedule-box").each((_, boxEl) => {
    const $box = $(boxEl);
    const $header = $box.find(".topschedule-header a").first();
    const headerTitle = cleanWikiValue($header.attr("title") || $header.text()) || "";
    if (!isSameFandomPageTitle(headerTitle, pageTitle)) return;

    const teams = $box.find(".topschedule-vs a")
      .map((__, teamEl) => cleanTeamName($(teamEl).attr("title") || $(teamEl).text()))
      .get()
      .filter(Boolean);
    if (teams.length < 2) return;

    const dateText =
      $box.find(".countdowndate").first().text().trim() ||
      $box.find(".TimeInLocal").first().text().trim() ||
      "";
    const matchDate = parseFandomDate(dateText);
    if (!matchDate) return;

    const rawText = $.html(boxEl)?.slice(0, 2500) || null;
    matches.push({
      stage: "Match Schedule",
      round: null,
      matchDate,
      matchDateTime: dateText,
      teamAName: teams[0],
      teamBName: teams[1],
      scoreA: null,
      scoreB: null,
      format: getBestOfLabel(rawText),
      status: "scheduled",
      sourceUrl: pageUrl,
      rawText,
    });
  });

  return matches;
}

function extractFandomBracketMatches(html: string, pageUrl: string): NormalizedMatch[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];
  const byRound = new Map<string, any[]>();

  $(".bracket-team").each((_, teamEl) => {
    const className = $(teamEl).attr("class") || "";
    const round = className.match(/\bround(\d+)\b/)?.[1] || "unknown";
    const group = byRound.get(round) || [];
    group.push(teamEl);
    byRound.set(round, group);
  });

  for (const [round, teams] of byRound) {
    for (let index = 0; index + 1 < teams.length; index += 2) {
      const $teamA = $(teams[index]);
      const $teamB = $(teams[index + 1]);
      const scoreA = parseInteger($teamA.find(".bracket-team-points").first().text());
      const scoreB = parseInteger($teamB.find(".bracket-team-points").first().text());
      if (scoreA !== null || scoreB !== null) continue;

      const teamAName = getFandomTeamName($, $teamA);
      const teamBName = getFandomTeamName($, $teamB);
      if (!teamAName && !teamBName) continue;

      const rawText = [$.html(teams[index]), $.html(teams[index + 1])].filter(Boolean).join("\n").slice(0, 2500);
      matches.push({
        stage: findNearestHeading($, teams[index], "h2, .mw-headline") || "Bracket",
        round: round === "unknown" ? null : `Round ${round}`,
        matchDate: null,
        matchDateTime: null,
        teamAName,
        teamBName,
        scoreA: null,
        scoreB: null,
        format: getBestOfLabel(rawText),
        status: "scheduled",
        sourceUrl: pageUrl,
        rawText,
      });
    }
  }

  return matches;
}

function extractFandomWikitextMatches(wikitext: string, pageUrl: string): NormalizedMatch[] {
  const matches: NormalizedMatch[] = [];
  const regex = /\{\{\s*(?:MatchSchedule|Matchlist|Match)\b([\s\S]*?)\}\}/gi;
  let found: RegExpExecArray | null;

  while ((found = regex.exec(wikitext)) && matches.length < 200) {
    const parsed = parseTemplate(found[0]);
    const params = parsed.params;
    const teamAName = cleanTeamName(params.team1 ?? params.blue ?? params.opponent1);
    const teamBName = cleanTeamName(params.team2 ?? params.red ?? params.opponent2);
    if (!teamAName && !teamBName) continue;

    const scoreA = parseInteger(params.score1 ?? params.team1score);
    const scoreB = parseInteger(params.score2 ?? params.team2score);
    if (scoreA !== null || scoreB !== null) continue;

    const matchDate = parseFandomDate(firstClean(params.date, params.time, params.datetime) || "");
    if (!matchDate) continue;

    matches.push({
      stage: firstClean(params.stage, params.phase),
      round: firstClean(params.round, params.match),
      matchDate,
      matchDateTime: firstClean(params.date, params.time, params.datetime),
      teamAName,
      teamBName,
      scoreA: null,
      scoreB: null,
      format: getBestOfLabel(firstClean(params.bestof, params.bo, params.format)) || getBestOfLabel(found[0]),
      status: "scheduled",
      sourceUrl: pageUrl,
      rawText: found[0].slice(0, 2500),
    });
  }

  return matches;
}

function normalizeFandomMatch(
  candidate: NormalizedMatch,
  sourceTitle: string,
  indexHint: string,
  teamNameMap: Map<string, string>,
): NormalizedMatch | null {
  const teamAName = canonicalizeTeam(candidate.teamAName, teamNameMap);
  const teamBName = canonicalizeTeam(candidate.teamBName, teamNameMap);
  if (!teamAName && !teamBName) return null;

  const finalTeamAName = !teamAName || isPlaceholderTeam(teamAName) ? "TBD" : teamAName;
  const finalTeamBName = !teamBName || isPlaceholderTeam(teamBName) ? "TBD" : teamBName;
  const teamAId = finalTeamAName === "TBD" ? "tbd" : generateInternalTeamId(finalTeamAName);
  const teamBId = finalTeamBName === "TBD" ? "tbd" : generateInternalTeamId(finalTeamBName);
  const matchId = createStableFandomMatchId({
    sourceTitle,
    matchDate: candidate.matchDate,
    matchDateTime: candidate.matchDateTime,
    teamAId,
    teamBId,
    stage: candidate.stage,
    round: candidate.round,
    extraHint: indexHint,
  });

  return {
    ...candidate,
    matchId,
    lpNumericalId: stringToNumericalId(matchId),
    teamAName: finalTeamAName,
    teamBName: finalTeamBName,
    teamAId,
    teamBId,
  };
}

function getFandomTeamName($: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>) {
  return cleanTeamName(
    $scope.attr("data-teamhighlight") ||
    $scope.find("a.catlink-teams").first().attr("title") ||
    $scope.find(".teamname a").first().attr("title") ||
    $scope.find("a").first().attr("title") ||
    $scope.find(".teamname").first().text() ||
    $scope.text()
  );
}

function findNearestHeading($: cheerio.CheerioAPI, element: any, selector: string) {
  let current = $(element);
  for (let depth = 0; depth < 8; depth++) {
    const heading = current.prevAll(selector).first();
    if (heading.length) return heading.text().replace(/\[edit\]/g, "").trim();
    const parent = current.parent();
    if (!parent.length) break;
    current = parent;
  }
  return "";
}

function buildTeamNameMap(participants: NormalizedParticipant[]) {
  const map = new Map<string, string>();
  for (const participant of participants) {
    map.set(participant.name.toLowerCase(), participant.name);
    const alias = participant.rawText?.match(/title="([^"]+)"/)?.[1];
    if (alias) map.set(alias.toLowerCase(), participant.name);
  }
  return map;
}

function canonicalizeTeam(value: string | null | undefined, teamNameMap: Map<string, string>) {
  const cleaned = cleanTeamName(value);
  if (!cleaned) return null;
  return teamNameMap.get(cleaned.toLowerCase()) || cleaned;
}

function cleanTeamName(raw: unknown) {
  const cleaned = cleanWikiValue(String(raw || ""));
  if (!cleaned) return null;
  const normalized = cleaned
    .replace(/^team:/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 2 || normalized.length > 80) return null;
  if (/^(vs|tbd|bye|date|time)$/i.test(normalized)) return normalized.toUpperCase() === "TBD" ? "TBD" : null;
  if (normalized.includes("=")) return null;
  return normalized;
}

function parseFandomDate(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return null;

  const isoUtc = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(?:UTC|GMT|Z))?$/i);
  if (isoUtc) {
    return new Date(Date.UTC(
      Number(isoUtc[1]),
      Number(isoUtc[2]) - 1,
      Number(isoUtc[3]),
      Number(isoUtc[4]),
      Number(isoUtc[5]),
      Number(isoUtc[6] || "0"),
    ));
  }

  const local = text.match(/^(\d{4}),(\d{1,2}),(\d{1,2}),(\d{1,2}),(\d{2})$/);
  if (local) {
    return new Date(Date.UTC(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      0,
    ));
  }

  const fandom = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{4}|UTC)?$/);
  if (fandom) {
    const month = monthIndex(fandom[2]);
    if (month >= 0) {
      const offset = fandom[7] && fandom[7] !== "UTC" ? parseOffsetMinutes(fandom[7]) : 0;
      const utc = Date.UTC(
        Number(fandom[3]),
        month,
        Number(fandom[1]),
        Number(fandom[4]),
        Number(fandom[5]),
        Number(fandom[6] || "0"),
      );
      return new Date(utc - offset * 60_000);
    }
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthIndex(month: string) {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf(month.slice(0, 3).toLowerCase());
}

function parseOffsetMinutes(offset: string) {
  const match = offset.match(/^([+-])(\d{2})(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function unwrapCargoRow(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const title = record.title;
  if (title && typeof title === "object" && !Array.isArray(title)) return title as Record<string, unknown>;
  return record;
}

function firstCargoValue(row: Record<string, unknown>, ...keys: string[]) {
  const lowerMap = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    lowerMap.set(key.toLowerCase(), value);
  }

  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct);

    const lowered = lowerMap.get(key.toLowerCase());
    if (lowered !== undefined && lowered !== null && String(lowered).trim()) return String(lowered);
  }

  return null;
}

function parseCargoBoolean(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (/^(?:1|true|yes|y)$/i.test(value)) return true;
  if (/^(?:0|false|no|n)$/i.test(value)) return false;
  return null;
}

function formatMatchDay(value: string | null | undefined) {
  const cleaned = cleanWikiValue(value);
  return cleaned ? `Match Day ${cleaned}` : null;
}

function isSameFandomPageTitle(a: string, b: string) {
  return normalizeFandomTitle(a) === normalizeFandomTitle(b);
}

function normalizeFandomTitle(value: string) {
  return cleanWikiValue(value)
    ?.replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() || "";
}

function firstClean(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = cleanWikiValue(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeFandomImageUrl(value: string | null | undefined) {
  if (!value || value.startsWith("data:")) return null;
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function inferTournamentStatus(startDate?: Date | null, endDate?: Date | null) {
  const now = Date.now();
  if (endDate && endDate.getTime() < now) return "finished";
  if (startDate && startDate.getTime() > now) return "upcoming";
  if (startDate && startDate.getTime() <= now && (!endDate || endDate.getTime() >= now)) return "ongoing";
  return "unknown";
}

function createStableFandomMatchId(input: {
  sourceTitle: string;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  teamAId?: string | null;
  teamBId?: string | null;
  stage?: string | null;
  round?: string | null;
  extraHint?: string | null;
}) {
  const data = [
    "fandom",
    input.sourceTitle,
    input.matchDate?.toISOString() ?? "",
    input.matchDateTime ?? "",
    input.teamAId ?? "unknownA",
    input.teamBId ?? "unknownB",
    input.stage ?? "",
    input.round ?? "",
    input.extraHint ?? "",
  ].join("|");
  const hash = createHash("md5").update(data).digest("hex").slice(0, 12);
  return `fandom_${hash}`;
}

function stringToNumericalId(str: string) {
  const hash = createHash("md5").update(str).digest("hex").slice(0, 12);
  return BigInt("0x" + hash);
}

function dedupeFandomMatches(matches: NormalizedMatch[]) {
  const seen = new Map<string, NormalizedMatch>();
  for (const match of matches) {
    const key = [
      match.matchDate?.toISOString() || "",
      [match.teamAName || "", match.teamBName || ""].sort().join("|").toLowerCase(),
      (match.stage || "").toLowerCase(),
      (match.round || "").toLowerCase(),
    ].join("|");
    if (!seen.has(key)) seen.set(key, match);
  }
  return Array.from(seen.values());
}
