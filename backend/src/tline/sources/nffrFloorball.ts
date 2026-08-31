import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DateTime } from "luxon";

import type { OfficialSourceMatch, TLineMatchStatus, TLineSourceTeam, TLineTimePrecision } from "../domain/types";
import type {
  OfficialChampionshipSnapshot,
  OfficialSourceAdapter,
  TLineChampionshipConfig,
} from "./contracts";

export const NFFR_FLOORBALL_PROVIDER = "nffr-floorball";
const NFFR_HOSTNAME = "xn--m1agla.xn--p1ai";
const NFFR_ORIGIN = `https://${NFFR_HOSTNAME}`;
const NFFR_TIMEOUT_MS = 15_000;
const NFFR_MAX_HTML_BYTES = 5 * 1024 * 1024;

type HtmlFetcher = (
  url: string,
  options: { readonly signal?: AbortSignal; readonly forceFresh: true },
) => Promise<string>;

export function createNffrFloorballAdapter(
  options: { readonly fetchHtml?: HtmlFetcher } = {},
): OfficialSourceAdapter {
  const fetchHtml = options.fetchHtml ?? fetchNffrFloorballHtml;
  const fetchAndParse = async (championship: TLineChampionshipConfig, signal?: AbortSignal) => {
    resolveNffrFloorballCalendarUrl(championship.sourceUrl);
    const html = await fetchHtml(championship.sourceUrl, { signal, forceFresh: true });
    return parseNffrFloorballChampionshipHtml(html, championship);
  };

  return Object.freeze({
    provider: NFFR_FLOORBALL_PROVIDER,
    async testConnection(config: TLineChampionshipConfig, testOptions?: { readonly signal?: AbortSignal }) {
      const snapshot = await fetchAndParse(config, testOptions?.signal);
      return Object.freeze({
        ok: true as const,
        provider: NFFR_FLOORBALL_PROVIDER,
        teamCount: snapshot.teams.length,
        matchCount: snapshot.matches.length,
        eligibleMatchCount: snapshot.matches.length,
        excludedMatchCount: 0,
        exactTimeCount: countPrecision(snapshot.matches, "EXACT"),
        dateOnlyTimeCount: countPrecision(snapshot.matches, "DATE_ONLY"),
        undefinedTimeCount: countPrecision(snapshot.matches, "UNDEFINED"),
        diagnostics: Object.freeze({
          reasonCodes: Object.freeze([]),
          excludedStageNames: Object.freeze([]),
          eligibleMatchCount: snapshot.matches.length,
          excludedMatchCount: 0,
        }),
        checkedAt: new Date().toISOString(),
      });
    },
    async fetchChampionship(input: Parameters<OfficialSourceAdapter["fetchChampionship"]>[0]) {
      const snapshot = await fetchAndParse(input.championship, input.signal);
      const matches = snapshot.matches.filter((match) => isMatchInsidePeriod(
        match,
        input.from,
        input.to,
        input.includeUndatedSourceMatches,
      ));
      return Object.freeze({
        ...snapshot,
        matches: Object.freeze([...matches]),
        teams: Object.freeze([...snapshot.teams]),
      });
    },
  });
}

export function parseNffrFloorballChampionshipHtml(
  html: string,
  config: TLineChampionshipConfig,
): OfficialChampionshipSnapshot {
  const resolved = resolveNffrFloorballCalendarUrl(config.sourceUrl);
  if (resolved.externalId !== config.externalId) {
    throw new Error(`NFFR floorball URL does not match the configured championship (${resolved.externalId} != ${config.externalId})`);
  }

  const $ = cheerio.load(html);
  const selectedCalendarId = clean($("#group_id option[selected]").first().attr("value"));
  if (!selectedCalendarId) {
    throw new Error("NFFR floorball selected calendar marker is missing; the page structure may have changed");
  }
  if (selectedCalendarId !== config.externalId) {
    throw new Error(
      `NFFR floorball selected calendar does not match the configured championship (${selectedCalendarId} != ${config.externalId})`,
    );
  }
  const selectedStage = clean($("#group_id option[selected]").first().text()) || null;
  const competitionId = resolveCompetitionId($, config.externalId);
  const cards = $(".match-item").toArray();
  if (cards.length === 0) {
    throw new Error("NFFR floorball parser found no match cards; the page structure may have changed");
  }

  const matches = cards.map((card, index) => parseMatchCard({
    $,
    card,
    index,
    competitionId,
    selectedStage,
    config,
  }));
  return Object.freeze({
    provider: NFFR_FLOORBALL_PROVIDER,
    championshipId: config.id,
    externalId: config.externalId,
    name: config.name,
    sourceUrl: resolved.sourceUrl,
    fetchedAt: new Date().toISOString(),
    teams: Object.freeze(uniqueSourceTeams(config.id, matches)),
    matches: Object.freeze(matches),
  });
}

function parseMatchCard(input: {
  $: cheerio.CheerioAPI;
  card: AnyNode;
  index: number;
  competitionId: string;
  selectedStage: string | null;
  config: TLineChampionshipConfig;
}): OfficialSourceMatch {
  const { $, card, index, competitionId, selectedStage, config } = input;
  const $card = $(card);
  const protocolLink = $card.find(".match-item-result a[href]").first();
  const matchId = parseNffrPathId(protocolLink.attr("href"), "protocol");
  if (!matchId) throw new Error(`NFFR floorball match ${index + 1} official match ID is missing`);
  const sourceUrl = resolveNffrEvidenceUrl(protocolLink.attr("href"), `/sport/protocol/${matchId}`);
  const teamNodes = $card.find(".match-item-team").toArray();
  if (teamNodes.length !== 2) throw new Error(`NFFR floorball match ${matchId} must contain exactly two teams`);
  const [home, away] = teamNodes.map((teamNode) => parseTeam($, teamNode, matchId, competitionId));
  const startTimeRaw = clean($card.find(".match-info-date").first().text());
  const parsedTime = parseNffrDateTime(startTimeRaw, config.sourceTimezone);
  const score = parseScore(clean(protocolLink.text()));
  const matchNumber = clean($card.find(".match-info-number").first().text()) || null;

  return Object.freeze({
    id: matchId,
    championshipId: config.id,
    externalId: matchId,
    home: Object.freeze({ ...home, adminTeamId: null }),
    away: Object.freeze({ ...away, adminTeamId: null }),
    startTimeRaw,
    sourceTimezone: config.sourceTimezone,
    startTimeUtc: parsedTime.startTimeUtc,
    startTimeMoscow: parsedTime.startTimeMoscow,
    timePrecision: parsedTime.timePrecision,
    status: parseNffrStatus($card.attr("class"), $card.text(), score, parsedTime.timePrecision),
    matchNumber,
    score: Object.freeze(score),
    stage: selectedStage,
    round: null,
    sourceUrl,
  });
}

function parseTeam(
  $: cheerio.CheerioAPI,
  node: AnyNode,
  matchId: string,
  expectedCompetitionId: string,
) {
  const $team = $(node);
  const link = $team.find(".match-item-team-name a[href]").first();
  const href = link.attr("href");
  const ids = href?.match(/^\/sport\/team\/([1-9]\d{0,127})\/([1-9]\d{0,127})\/?$/u);
  if (!ids) throw new Error(`NFFR floorball match ${matchId} has an invalid official team URL`);
  if (ids[2] !== expectedCompetitionId) {
    throw new Error(`NFFR floorball match ${matchId} team competition ID does not match the calendar`);
  }
  resolveNffrEvidenceUrl(href, `/sport/team/${ids[1]}/${ids[2]}`);
  const name = clean(link.text());
  if (!name) throw new Error(`NFFR floorball match ${matchId} is missing a team name`);
  return Object.freeze({ sourceTeamId: ids[1], name, city: clean($team.find(".match-item-team-city").text()) || null });
}

function resolveCompetitionId($: cheerio.CheerioAPI, calendarId: string) {
  const ids = new Set<string>();
  $("a[href]").each((_index, anchor) => {
    const href = $(anchor).attr("href");
    const match = href?.match(/^\/sport\/competitions\/([1-9]\d{0,127})\/([1-9]\d{0,127})\/?$/u);
    if (match?.[2] === calendarId) ids.add(match[1]);
  });
  if (ids.size !== 1) {
    throw new Error("NFFR floorball competition identity marker is missing or ambiguous");
  }
  return [...ids][0];
}

function parseNffrDateTime(rawValue: string, sourceTimezone: string): {
  startTimeUtc: string | null;
  startTimeMoscow: string | null;
  timePrecision: TLineTimePrecision;
} {
  if (!rawValue) return { startTimeUtc: null, startTimeMoscow: null, timePrecision: "UNDEFINED" };
  const exact = rawValue.match(/\b(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})\b/u);
  if (exact) {
    const local = DateTime.fromFormat(`${exact[1]} ${exact[2]}`, "dd.MM.yyyy H:mm", {
      zone: sourceTimezone,
      locale: "ru",
    });
    if (!local.isValid) throw new Error(`NFFR floorball returned an invalid match date: ${rawValue}`);
    return {
      startTimeUtc: local.toUTC().toISO({ suppressMilliseconds: false }),
      startTimeMoscow: local.setZone("Europe/Moscow").toISO({ suppressMilliseconds: false }),
      timePrecision: "EXACT",
    };
  }
  if (/\b\d{2}\.\d{2}\.\d{4}\b/u.test(rawValue)) {
    return { startTimeUtc: null, startTimeMoscow: null, timePrecision: "DATE_ONLY" };
  }
  return { startTimeUtc: null, startTimeMoscow: null, timePrecision: "UNDEFINED" };
}

function parseScore(value: string) {
  const match = value.match(/^(\d+)\s*:\s*(\d+)$/u);
  return match
    ? { home: Number(match[1]), away: Number(match[2]) }
    : { home: null, away: null };
}

function parseNffrStatus(
  className: string | undefined,
  cardText: string,
  score: { home: number | null; away: number | null },
  precision: TLineTimePrecision,
): TLineMatchStatus {
  const normalized = `${className ?? ""} ${cardText}`.toLocaleLowerCase("ru-RU");
  if (/отмен|cancel/u.test(normalized)) return "CANCELLED";
  if (/перенес|отлож|postpon/u.test(normalized)) return "POSTPONED";
  if (score.home !== null && score.away !== null) return "FINISHED";
  if (/\bpast\b/u.test(normalized)) return "FINISHED";
  if (precision === "UNDEFINED") return "TBD";
  return "SCHEDULED";
}

function uniqueSourceTeams(championshipId: string, matches: readonly OfficialSourceMatch[]) {
  const teams = new Map<string, TLineSourceTeam>();
  for (const match of matches) {
    for (const team of [match.home, match.away]) {
      if (!teams.has(team.sourceTeamId)) {
        teams.set(team.sourceTeamId, Object.freeze({
          id: team.sourceTeamId,
          championshipId,
          externalId: team.sourceTeamId,
          nameRu: team.name,
          nameEn: null,
          city: team.city ?? null,
          aliases: Object.freeze([]),
        }));
      }
    }
  }
  return [...teams.values()];
}

function isMatchInsidePeriod(
  match: OfficialSourceMatch,
  from: Date,
  to: Date,
  includeUndatedSourceMatches: boolean,
) {
  if (match.startTimeUtc) {
    const timestamp = new Date(match.startTimeUtc).getTime();
    return timestamp >= from.getTime() && timestamp <= to.getTime();
  }
  const date = match.startTimeRaw.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/u);
  if (!date) return includeUndatedSourceMatches;
  const day = DateTime.fromObject(
    { year: Number(date[3]), month: Number(date[2]), day: Number(date[1]) },
    { zone: match.sourceTimezone },
  );
  return day.endOf("day").toMillis() >= from.getTime() && day.startOf("day").toMillis() <= to.getTime();
}

export function resolveNffrFloorballCalendarUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidCalendarUrl();
  }
  const externalId = url.pathname.match(/^\/sport\/calendar\/([1-9]\d{0,127})$/u)?.[1];
  if (
    url.protocol !== "https:"
    || url.hostname !== NFFR_HOSTNAME
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || !externalId
  ) {
    throw invalidCalendarUrl();
  }
  return Object.freeze({ sourceUrl: url.toString(), externalId });
}

function invalidCalendarUrl() {
  return new Error("A valid HTTPS NFFR floorball calendar URL is required");
}

function parseNffrPathId(value: string | undefined, resource: string) {
  return value?.match(new RegExp(`^/sport/${resource}/([1-9]\\d{0,127})/?$`, "u"))?.[1] ?? null;
}

function resolveNffrEvidenceUrl(value: string | undefined, expectedPath: string) {
  let url: URL;
  try {
    url = new URL(value ?? "", NFFR_ORIGIN);
  } catch {
    throw new Error(`NFFR floorball evidence URL is invalid: ${expectedPath}`);
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== NFFR_HOSTNAME
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname !== expectedPath
  ) {
    throw new Error(`NFFR floorball evidence URL is invalid: ${expectedPath}`);
  }
  return url.toString();
}

async function fetchNffrFloorballHtml(
  url: string,
  options: { readonly signal?: AbortSignal; readonly forceFresh: true },
) {
  const timeout = AbortSignal.timeout(NFFR_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`NFFR floorball request failed with HTTP ${response.status}`);
  return readNffrFloorballHtmlResponse(response);
}

export async function readNffrFloorballHtmlResponse(response: Response) {
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/u.test(contentType)) {
    throw new Error("NFFR floorball did not return an HTML response");
  }
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > NFFR_MAX_HTML_BYTES) {
    throw new Error("NFFR floorball response exceeded the TLine size limit");
  }
  if (!response.body) throw new Error("NFFR floorball returned an empty HTML response body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > NFFR_MAX_HTML_BYTES) {
        await reader.cancel("TLine response size limit exceeded");
        throw new Error("NFFR floorball response exceeded the TLine size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(payload);
}

function countPrecision(matches: readonly OfficialSourceMatch[], precision: TLineTimePrecision) {
  return matches.filter((match) => match.timePrecision === precision).length;
}

function clean(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}
