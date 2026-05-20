import type { ImportStatus } from "@prisma/client";
import * as cheerio from "cheerio";
import {
  cleanWikiValue,
  extractFirstTemplateByPrefix,
  extractSection,
  extractTemplatesByNamePrefix,
  parseInteger,
  parseTemplate,
  parseWikiDate
} from "@/lib/normalizers/wikiText";
import { createHash } from "crypto";
import { generateInternalTeamId, isPlaceholderTeam } from "@/lib/teams/teams";
import { applyTbdPairCycling } from "@/lib/matches/tbdCycling";

// applyTbdPairCycling is now imported from @/lib/matches/tbdCycling

/* ───── Deduplication ───── */

export type NormalizedParticipant = {
  name: string;
  seed?: string | null;
  region?: string | null;
  status?: string | null;
  logoUrl?: string | null;
  rawText?: string | null;
};

export type NormalizedMatch = {
  matchId?: string | null;
  lpNumericalId?: bigint | null;
  stage?: string | null;
  round?: string | null;
  matchDate?: Date | null;
  matchDateTime?: string | null;
  teamAId?: string | null;
  teamAName?: string | null;
  teamBId?: string | null;
  teamBName?: string | null;
  scoreA?: number | null;
  scoreB?: number | null;
  format?: string | null;
  status?: string | null;
  court?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
};

export type NormalizedTournament = {
  sourcePageId?: number;
  sourceTitle: string;
  sourceUrl: string;
  name: string;
  startDate?: Date | null;
  endDate?: Date | null;
  location?: string | null;
  region?: string | null;
  organizer?: string | null;
  prizePool?: string | null;
  formatText?: string | null;
  tournamentStatus?: string | null;
  participants: NormalizedParticipant[];
  matches: NormalizedMatch[];
  subPages: string[];
  warnings: string[];
  status: ImportStatus;
};

/* ───── Main entry point ───── */

export function normalizeValorantTournament(input: {
  pageId?: number;
  title: string;
  pageUrl: string;
  wikitext: string;
  parsedHtml?: string;
}): NormalizedTournament {
  const warnings: string[] = [];
  const infobox = extractFirstTemplateByPrefix(input.wikitext, "Infobox");
  const parsedInfobox = infobox ? parseTemplate(infobox) : null;

  const params = parsedInfobox?.params ?? {};
  let name = firstClean(params.name, params.tournament, params.event, params.league) ?? cleanWikiValue(input.title) ?? input.title;
  let startDate = parseWikiDate(params.sdate ?? params.startdate ?? params.start_date ?? params.date ?? params.dates);
  let endDate = parseWikiDate(params.edate ?? params.enddate ?? params.end_date ?? params.date2);
  let location = firstClean(params.location, params.venue, params.city, params.country);
  let region = firstClean(params.region, params.server, params.realm);
  let organizer = firstClean(params.organizer, params.organizer2, params.organizers, params.host);
  let prizePool = firstClean(params.prizepoolusd, params.prizepool, params.prize_pool, params.prize, params.prizemoney);
  let formatText = firstClean(params.format, params.format1, params.format2, params.type);

  let teamCount = parseInt(firstClean(params.team_number, params.participant_number, params.teams) ?? "0", 10);
  if (isNaN(teamCount)) teamCount = 0;

  if (input.parsedHtml) {
    const $ = cheerio.load(input.parsedHtml);
    const infoBoxDiv = $(".fo-ntax-infobox");
    
    if (infoBoxDiv.length > 0) {
      if (!name || name === input.title) {
        const titleText = infoBoxDiv.find(".infobox-header").first().text().trim();
        if (titleText) name = titleText;
      }
      
      const getInfoboxValue = (label: string) => {
        const cell = infoBoxDiv.find(`.infobox-cell-2:contains("${label}")`).next(".infobox-cell-2");
        return cell.length ? cell.text().trim() : null;
      };
      
      if (!startDate) startDate = parseWikiDate(getInfoboxValue("Start Date:"));
      if (!endDate) endDate = parseWikiDate(getInfoboxValue("End Date:"));
      if (!location) location = getInfoboxValue("Location:");
      if (!region) region = getInfoboxValue("Region:");
      if (!prizePool) prizePool = getInfoboxValue("Prize Pool:");
      if (!organizer) organizer = getInfoboxValue("Organizer:");
      
      const teamCountStr = getInfoboxValue("Number of teams:");
      if (teamCountStr) {
        const parsed = parseInt(teamCountStr, 10);
        if (!isNaN(parsed)) teamCount = parsed;
      }
    }
  }

  /* ── Extract participants ── */
  const participants = extractParticipants(input.wikitext, input.parsedHtml);

  const teamNameMap = new Map<string, string>();
  participants.forEach(p => {
    teamNameMap.set(p.name.toLowerCase(), p.name);
    if (p.rawText) {
      const wikiMatch = p.rawText.match(/\|\s*(?:team|link)\s*=\s*([^|}\n]+)/i) || p.rawText.match(/\{\{\s*[^|]+\|\s*([^|}\n]+)/i);
      if (wikiMatch) {
        teamNameMap.set(wikiMatch[1].trim().toLowerCase(), p.name);
      }
    }
  });

  const canonicalize = (name: string | null | undefined) => {
    if (!name) return name;
    const lower = name.toLowerCase();
    return teamNameMap.get(lower) || name;
  };

  /* ── Extract sub-pages ── */
  const subPages = extractSubPages(input.wikitext, input.parsedHtml || "", input.pageUrl);

  /* ── Extract matches ── */
  const htmlMatches = input.parsedHtml
    ? extractMatchesFromParsedHtml(input.parsedHtml, input.pageUrl)
    : [];
  const wikiMatches = extractMatchesFromWikitext(input.wikitext);

  const allCandidates = [...htmlMatches, ...wikiMatches];
  const normalizedMatches = allCandidates
    .map((c, idx) => {
      const normalized = normalizeMatchCandidate(c, input.title, String(idx));
      if (normalized) {
        normalized.teamAName = canonicalize(normalized.teamAName);
        normalized.teamBName = canonicalize(normalized.teamBName);
      }
      return normalized;
    })
    .filter((m): m is NormalizedMatch => m !== null);

  // Apply TBD pair cycling logic (TBD1-16)
  applyTbdPairCycling(normalizedMatches, input.title);

  const matches = dedupeMatches(normalizedMatches);

  if (matches.length === 0) {
    const diag: string[] = [];
    if (input.parsedHtml) {
      const $ = cheerio.load(input.parsedHtml);
      diag.push(`Parsed HTML: ${$(".brkts-match").length} matches`);
    }
    warnings.push(`Матчи не извлечены. ${diag.join(". ")}`);
  }

  const tournamentStatus = inferTournamentStatus(startDate, endDate);
  const hasReal = matches.length > 0 || participants.length > 0;
  const status: ImportStatus = matches.length > 0 ? "SUCCESS" : hasReal ? "PARTIAL" : "PARTIAL";

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
    tournamentStatus,
    participants,
    matches,
    subPages,
    warnings,
    status
  };
}

function extractMatchesFromParsedHtml(html: string, pageUrl: string): NormalizedMatch[] {
  const $ = cheerio.load(html);
  const matches: NormalizedMatch[] = [];

  function getFullTeamName(oppEl: any): string | null {
    const $opp = $(oppEl);
    const aria = $opp.attr("aria-label")?.trim();
    if (aria && aria !== "TBD") return aria;
    const linkTitle = $opp.find(".name a").attr("title")?.trim();
    if (linkTitle && !linkTitle.includes("(page does not exist)")) return linkTitle;
    const teamLink = $opp.find("a[href*='/valorant/']").attr("title")?.trim();
    if (teamLink && !teamLink.includes("(page does not exist)")) return teamLink;
    const nameText = $opp.find(".name").text().trim();
    if (nameText) return nameText;
    return "TBD";
  }

  $(".brkts-matchlist-match, .brkts-match").each((_, matchEl) => {
    const $match = $(matchEl);
    const oppCells = $match.find(".brkts-matchlist-opponent, .brkts-opponent-entry");
    if (oppCells.length < 2) return;

    const teamAName = getFullTeamName(oppCells.eq(0));
    const teamBName = getFullTeamName(oppCells.eq(1));
    // Allow TBD matches

    const scoreCells = $match.find(".brkts-matchlist-score, .brkts-opponent-score-inner");
    const scoreAText = scoreCells.eq(0).text().trim();
    const scoreBText = scoreCells.eq(1).text().trim();

    const timer = $match.find(".timer-object").first();
    const timestamp = timer.attr("data-timestamp");
    let matchDate: Date | null = null;
    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      if (!isNaN(ts)) matchDate = new Date(ts * 1000);
    }

    matches.push({
      matchDate,
      teamAName,
      teamBName,
      scoreA: scoreAText ? parseInt(scoreAText, 10) : null,
      scoreB: scoreBText ? parseInt(scoreBText, 10) : null,
      sourceUrl: pageUrl,
      rawText: $.html(matchEl)?.slice(0, 1000)
    });
  });

  return matches;
}

function extractMatchesFromWikitext(wikitext: string): NormalizedMatch[] {
  const templates = [
    ...extractTemplatesByNamePrefix(wikitext, "Match", 400),
    ...extractTemplatesByNamePrefix(wikitext, "BracketMatch", 400),
    ...extractTemplatesByNamePrefix(wikitext, "MatchSchedule", 400),
    ...extractTemplatesByNamePrefix(wikitext, "Matchlist", 400)
  ];

  const matches: NormalizedMatch[] = [];
  for (const template of templates) {
    const parsed = parseTemplate(template);
    const params = parsed.params;
    const rawTeamA = firstClean(params.team1, params.opponent1, params.p1);
    const rawTeamB = firstClean(params.team2, params.opponent2, params.p2);
    if (!rawTeamA && !rawTeamB) continue;

    matches.push({
      matchDate: parseWikiDate(params.date ?? params.time ?? params.datetime),
      teamAName: rawTeamA,
      teamBName: rawTeamB,
      scoreA: parseInteger(params.score1 ?? params.games1),
      scoreB: parseInteger(params.score2 ?? params.games2),
      rawText: template.slice(0, 1000)
    });
  }
  return matches;
}

function normalizeMatchCandidate(candidate: NormalizedMatch, sourceTitle: string, indexHint: string): NormalizedMatch | null {
  const teamAName = candidate.teamAName?.trim() || null;
  const teamBName = candidate.teamBName?.trim() || null;

  if (!teamAName && !teamBName && !indexHint) return null;

  // Numbered TBD logic
  const matchIdx = parseInt(indexHint || "0", 10);
  const tbdAName = `TBD${(matchIdx * 2) + 1}`;
  const tbdBName = `TBD${(matchIdx * 2) + 2}`;

  const isA_TBD = !teamAName || isPlaceholderTeam(teamAName);
  const isB_TBD = !teamBName || isPlaceholderTeam(teamBName);

  const finalTeamAName = isA_TBD ? "TBD" : teamAName;
  const finalTeamBName = isB_TBD ? "TBD" : teamBName;

  const teamAId = isA_TBD ? `tbd` : generateInternalTeamId(teamAName!);
  const teamBId = isB_TBD ? `tbd` : generateInternalTeamId(teamBName!);

  const matchId = candidate.matchId ?? createStableMatchId({ 
    sourceTitle, 
    matchDate: candidate.matchDate, 
    teamAId, 
    teamBId, 
    extraHint: indexHint 
  });

  const lpNumericalId = stringToNumericalId(matchId);

  return { 
    ...candidate, 
    matchId, 
    lpNumericalId,
    teamAId, 
    teamAName: finalTeamAName, 
    teamBId, 
    teamBName: finalTeamBName 
  };
}

export function stringToNumericalId(str: string): bigint {
  const hash = createHash("md5").update(str).digest("hex").slice(0, 12);
  return BigInt("0x" + hash);
}

function createStableMatchId(input: { 
  sourceTitle: string; 
  matchDate?: Date | null; 
  matchDateTime?: string | null;
  teamAId: string; 
  teamBId: string; 
  stage?: string | null;
  round?: string | null;
  extraHint: string 
}): string {
  const data = [
    input.sourceTitle, 
    input.matchDate?.toISOString() ?? "", 
    input.matchDateTime ?? "",
    input.teamAId, 
    input.teamBId, 
    input.stage ?? "",
    input.round ?? "",
    input.extraHint
  ].join("|");
  return `match_${createHash("md5").update(data).digest("hex").slice(0, 12)}`;
}

function dedupeMatches(matches: NormalizedMatch[]): NormalizedMatch[] {
  const seen = new Map<string, NormalizedMatch>();
  for (const m of matches) {
    if (m.matchId) seen.set(m.matchId, m);
  }
  return Array.from(seen.values());
}

function extractParticipants(wikitext: string, html?: string): NormalizedParticipant[] {
  const participants: NormalizedParticipant[] = [];
  if (html) {
    const $ = cheerio.load(html);
    $(".team-card, .participant-table-player-team").each((_, el) => {
      const name = $(el).find("a[href*='/valorant/']").first().attr("title")?.trim();
      if (name) participants.push({ name });
    });
  }
  return participants;
}

function firstClean(...values: Array<string | null | undefined>) {
  for (const v of values) {
    const c = cleanWikiValue(v);
    if (c) return c;
  }
  return null;
}

function extractSubPages(wikitext: string, html: string, pageUrl: string): string[] {
  const subPages: string[] = [];
  const baseUrl = pageUrl.replace(/\/+$/, "");
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");

  const pushIfRelevant = (href: string | undefined | null) => {
    if (!href || href.startsWith("#") || href.includes("action=edit")) return;

    const fullUrl = href.startsWith("http") ? href : `https://liquipedia.net${href.startsWith("/") ? href : `/${href}`}`;
    let parsed: URL;
    try {
      parsed = new URL(fullUrl);
    } catch {
      return;
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path.startsWith(`${basePath}/`)) return;

    const suffix = decodeURIComponent(path.slice(basePath.length + 1)).replace(/ /g, "_");
    if (!suffix || suffix.includes("/") || suffix.includes("Qualifier")) return;
    if (!EVENT_SUBPAGE_ALLOWLIST.includes(suffix)) return;

    subPages.push(`${parsed.origin}${path}`);
  };

  if (html) {
    const $ = cheerio.load(html);
    $(".tabs-static a, .nav-tabs a").each((_, el) => {
      pushIfRelevant($(el).attr("href"));
    });
  }
  const titlePart = decodeURIComponent(basePath.split("/").slice(2).join("/")).replace(/_/g, " ");
  const subLinkRegex = /\[\[([^|\]]+\/[^|\]]+)(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = subLinkRegex.exec(wikitext))) {
    const subPath = match[1].replace(/_/g, " ");
    if (subPath.startsWith(titlePart) && subPath !== titlePart) {
      pushIfRelevant(`/valorant/${subPath.replace(/ /g, "_")}`);
    }
  }
  return Array.from(new Set(subPages));
}

const EVENT_SUBPAGE_ALLOWLIST = [
  "Group_Stage",
  "Swiss_Stage",
  "Playoffs",
  "Bracket",
  "Main_Event",
  "Regular_Season",
  "Finals"
];

function inferTournamentStatus(startDate?: Date | null, endDate?: Date | null) {
  const now = Date.now();
  if (endDate && endDate.getTime() < now) return "finished";
  if (startDate && startDate.getTime() > now) return "upcoming";
  return "ongoing";
}
