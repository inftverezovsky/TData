import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type {
  OfficialChampionshipSnapshot,
  OfficialSourceAdapter,
  TLineChampionshipConfig,
} from "./contracts";
import type { OfficialSourceMatch, TLineMatchStatus, TLineSourceTeam, TLineTimePrecision } from "../domain/types";

export const VOLLEY_RU_PROVIDER = "volley-ru";
const VOLLEY_RU_TIMEOUT_MS = 15_000;
const VOLLEY_RU_MAX_HTML_BYTES = 5 * 1024 * 1024;

type HtmlFetcher = (
  url: string,
  options: { readonly signal?: AbortSignal; readonly forceFresh: true },
) => Promise<string>;

export function createVolleyRuAdapter(options: { readonly fetchHtml?: HtmlFetcher } = {}): OfficialSourceAdapter {
  const fetchHtml = options.fetchHtml ?? fetchVolleyRuHtml;

  const fetchAndParse = async (
    championship: TLineChampionshipConfig,
    signal?: AbortSignal,
  ): Promise<OfficialChampionshipSnapshot> => {
    validateVolleyRuCalendarUrl(championship.sourceUrl);
    const html = await fetchHtml(championship.sourceUrl, { signal, forceFresh: true });
    return parseVolleyRuChampionshipHtml(html, championship);
  };

  const adapter: OfficialSourceAdapter = Object.freeze({
    provider: VOLLEY_RU_PROVIDER,
    async testConnection(config: TLineChampionshipConfig) {
      const snapshot = await fetchAndParse(config);
      return Object.freeze({
        ok: true as const,
        provider: VOLLEY_RU_PROVIDER,
        matchCount: snapshot.matches.length,
        checkedAt: new Date().toISOString(),
      });
    },
    async fetchChampionship(input: Parameters<OfficialSourceAdapter["fetchChampionship"]>[0]) {
      const snapshot = await fetchAndParse(input.championship, input.signal);
      const matches = snapshot.matches.filter((match) => isMatchInsidePeriod(match, input.from, input.to));
      const usedTeamIds = new Set(matches.flatMap((match) => [match.home.sourceTeamId, match.away.sourceTeamId]));
      return Object.freeze({
        ...snapshot,
        matches: Object.freeze([...matches]),
        teams: Object.freeze(snapshot.teams.filter((team) => usedTeamIds.has(team.id))),
      });
    },
  });
  return adapter;
}

export function parseVolleyRuChampionshipHtml(
  html: string,
  config: TLineChampionshipConfig,
): OfficialChampionshipSnapshot {
  validateVolleyRuCalendarUrl(config.sourceUrl);
  const $ = cheerio.load(html);
  const cards = $(".ginfo-card").toArray();
  if (cards.length === 0) throw new Error("Volley.ru parser found no match cards; the page structure may have changed");
  assertSelectedVolleyRuLeague($, config);
  const officialTeamIds = extractOfficialTeamIds($);

  const matches = cards.map((card, index) => {
    const $card = $(card);
    const $info = $card.find(".ginfo").first();
    const rawMatchUrl = $card.attr("href");
    const dataId = clean($info.attr("data-id"));
    const hrefId = extractGameId(rawMatchUrl);
    const id = dataId || hrefId;
    if (!id) throw new Error(`Volley.ru match ${index + 1} official match ID is missing`);
    const sourceUrl = parseVolleyRuMatchUrl(rawMatchUrl, id);
    const rawDateTime = clean($info.find(".ginfo__datetime").first().text());
    const parsedTime = parseVolleyRuDateTime(rawDateTime, config.sourceTimezone);
    const $home = $info.find(".ginfo-team--a").first();
    const $away = $info.find(".ginfo-team--b").first();
    const homeName = clean($home.find(".ginfo-team__title").first().text());
    const awayName = clean($away.find(".ginfo-team__title").first().text());
    if (!homeName || !awayName) throw new Error(`Volley.ru match ${id} is missing a team name`);

    const roundWrapper = $card.closest(".result-cards-wrapper");
    const round = clean(roundWrapper.children(".result-cards-title").first().text()) || null;
    const stage = clean(
      roundWrapper.parent(".result-groups-list").siblings(".result-cards-title").first().text(),
    ) || null;
    const homeTeamId = resolveOfficialTeamId($home.attr("data-team-id"), homeName, officialTeamIds, id);
    const awayTeamId = resolveOfficialTeamId($away.attr("data-team-id"), awayName, officialTeamIds, id);

    return Object.freeze({
      id,
      championshipId: config.id,
      externalId: id,
      home: Object.freeze({ sourceTeamId: homeTeamId, name: homeName, adminTeamId: null }),
      away: Object.freeze({ sourceTeamId: awayTeamId, name: awayName, adminTeamId: null }),
      startTimeRaw: rawDateTime,
      sourceTimezone: config.sourceTimezone,
      startTimeUtc: parsedTime.startTimeUtc,
      startTimeMoscow: parsedTime.startTimeMoscow,
      timePrecision: parsedTime.timePrecision,
      status: parseVolleyRuStatus(
        $info.attr("data-status"),
        $info.text(),
        $info.find(".ginfo-data__score").map((_scoreIndex, score) => clean($(score).text())).get(),
      ),
      stage,
      round,
      sourceUrl,
    }) satisfies OfficialSourceMatch;
  });

  const teams = uniqueSourceTeams(config.id, matches);
  return Object.freeze({
    provider: VOLLEY_RU_PROVIDER,
    championshipId: config.id,
    externalId: config.externalId,
    name: config.name,
    sourceUrl: config.sourceUrl,
    fetchedAt: new Date().toISOString(),
    teams: Object.freeze(teams),
    matches: Object.freeze(matches),
  });
}

function assertSelectedVolleyRuLeague($: cheerio.CheerioAPI, config: TLineChampionshipConfig) {
  const selectedLeagueId = clean($("#league option[selected]").first().attr("value"))
    || clean($("#league").first().attr("data-value"));
  if (!selectedLeagueId) {
    throw new Error("Volley.ru selected league marker is missing; the page structure may have changed");
  }
  if (selectedLeagueId !== config.externalId) {
    throw new Error(
      `Volley.ru selected league does not match the configured championship (${selectedLeagueId} != ${config.externalId})`,
    );
  }
}

function resolveOfficialTeamId(
  dataTeamId: string | undefined,
  teamName: string,
  officialTeamIds: ReadonlyMap<string, string>,
  matchId: string,
) {
  const id = clean(dataTeamId) || officialTeamIds.get(normalizeTeamLookupName(teamName));
  if (!id) throw new Error(`Volley.ru match ${matchId} official team ID is missing for ${teamName}`);
  return id;
}

function extractOfficialTeamIds($: cheerio.CheerioAPI) {
  const candidates = new Map<string, string | null>();
  $("#team option[value]").each((_index, option) => {
    const id = clean($(option).attr("value"));
    const label = clean($(option).text());
    if (!id || !label) return;
    registerTeamId(candidates, normalizeTeamLookupName(label), id);
    const withoutLocation = clean(label.replace(/\s+\([^()]+\)\s*$/u, ""));
    if (withoutLocation !== label) registerTeamId(candidates, normalizeTeamLookupName(withoutLocation), id);
  });
  return new Map(
    Array.from(candidates.entries()).flatMap(([name, id]) => id ? [[name, id] as const] : []),
  );
}

function registerTeamId(candidates: Map<string, string | null>, name: string, id: string) {
  if (!name) return;
  const existing = candidates.get(name);
  candidates.set(name, existing === undefined || existing === id ? id : null);
}

function normalizeTeamLookupName(value: string) {
  return clean(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function parseVolleyRuDateTime(rawValue: string, sourceTimezone: string): {
  readonly startTimeUtc: string | null;
  readonly startTimeMoscow: string | null;
  readonly timePrecision: TLineTimePrecision;
} {
  const dateMatch = rawValue.match(/\b(\d{2}\.\d{2}\.\d{4})(?:\s+(?:г\.\s*)?(\d{1,2}:\d{2}))?/u);
  if (!dateMatch) return { startTimeUtc: null, startTimeMoscow: null, timePrecision: "UNDEFINED" };
  if (!dateMatch[2]) return { startTimeUtc: null, startTimeMoscow: null, timePrecision: "DATE_ONLY" };

  const local = DateTime.fromFormat(`${dateMatch[1]} ${dateMatch[2]}`, "dd.MM.yyyy H:mm", {
    zone: sourceTimezone,
    locale: "ru",
  });
  if (!local.isValid) throw new Error(`Volley.ru returned an invalid match date: ${rawValue}`);
  return {
    startTimeUtc: local.toUTC().toISO({ suppressMilliseconds: false }),
    startTimeMoscow: local.setZone("Europe/Moscow").toISO({ suppressMilliseconds: false }),
    timePrecision: "EXACT",
  };
}

function parseVolleyRuStatus(
  dataStatus: string | undefined,
  cardText: string,
  scoreTexts: readonly string[],
): TLineMatchStatus {
  const normalized = `${dataStatus ?? ""} ${cardText}`.toLocaleLowerCase("ru-RU");
  if (/отмен|cancel/.test(normalized)) return "CANCELLED";
  if (/перенес|отлож|postpon/.test(normalized)) return "POSTPONED";
  if (/\btbd\b|время не определено/.test(normalized)) return "TBD";
  const finalScores = scoreTexts.filter((score) => /^\d+$/u.test(score)).map(Number);
  if (/заверш|окончен|finished/.test(normalized) || (finalScores.length >= 2 && Math.max(...finalScores) >= 3)) {
    return "FINISHED";
  }
  return "SCHEDULED";
}

function uniqueSourceTeams(
  championshipId: string,
  matches: readonly OfficialSourceMatch[],
): readonly TLineSourceTeam[] {
  const byId = matches.reduce<Map<string, TLineSourceTeam>>((teams, match) => {
    const next = new Map(teams);
    for (const team of [match.home, match.away]) {
      if (!next.has(team.sourceTeamId)) {
        next.set(team.sourceTeamId, Object.freeze({
          id: team.sourceTeamId,
          championshipId,
          externalId: team.sourceTeamId,
          nameRu: team.name,
          nameEn: null,
          aliases: Object.freeze([]),
        }));
      }
    }
    return next;
  }, new Map());
  return Array.from(byId.values());
}

function isMatchInsidePeriod(match: OfficialSourceMatch, from: Date, to: Date): boolean {
  if (match.startTimeUtc) {
    const timestamp = new Date(match.startTimeUtc).getTime();
    return timestamp >= from.getTime() && timestamp <= to.getTime();
  }
  const rawDate = match.startTimeRaw.match(/\b(\d{2})\.(\d{2})\.(\d{4})/);
  if (!rawDate) return true;
  const day = DateTime.fromObject(
    { year: Number(rawDate[3]), month: Number(rawDate[2]), day: Number(rawDate[1]) },
    { zone: match.sourceTimezone },
  );
  return day.endOf("day").toMillis() >= from.getTime() && day.startOf("day").toMillis() <= to.getTime();
}

function validateVolleyRuCalendarUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A valid HTTPS volley.ru calendar URL is required");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "volley.ru"
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || !/^\/calendar\/[^/]+\/allgames\/?$/.test(url.pathname)
  ) {
    throw new Error("A valid HTTPS volley.ru calendar URL is required");
  }
}

async function fetchVolleyRuHtml(
  url: string,
  options: { readonly signal?: AbortSignal; readonly forceFresh: true },
): Promise<string> {
  const timeout = AbortSignal.timeout(VOLLEY_RU_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`Volley.ru request failed with HTTP ${response.status}`);
  return readVolleyRuHtmlResponse(response);
}

export async function readVolleyRuHtmlResponse(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/u.test(contentType)) {
    throw new Error("Volley.ru did not return an HTML response");
  }
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > VOLLEY_RU_MAX_HTML_BYTES) {
    throw new Error("Volley.ru response exceeded the TLine size limit");
  }
  if (!response.body) throw new Error("Volley.ru returned an empty HTML response body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > VOLLEY_RU_MAX_HTML_BYTES) {
        await reader.cancel("TLine response size limit exceeded");
        throw new Error("Volley.ru response exceeded the TLine size limit");
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

function extractGameId(value: string | undefined) {
  return value?.match(/\/games\/([^/?#]+)/)?.[1] ?? null;
}

function parseVolleyRuMatchUrl(value: string | undefined, expectedId: string) {
  let url: URL;
  try {
    url = new URL(value ?? "", "https://volley.ru");
  } catch {
    throw new Error(`Volley.ru match ${expectedId} has an invalid match URL`);
  }
  const pathId = url.pathname.match(/^\/games\/([^/]+)\/?$/u)?.[1];
  if (
    url.protocol !== "https:"
    || url.hostname !== "volley.ru"
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || pathId !== expectedId
  ) {
    throw new Error(`Volley.ru match ${expectedId} has an invalid match URL`);
  }
  return url.toString();
}

function clean(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
