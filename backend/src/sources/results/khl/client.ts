import type { KhlMatchStatus, KhlScore, KhlTeamIdentity } from "./normalize";

const DEFAULT_BASE_URL = "https://khl.api.webcaster.pro/api/khl_mobile";
const DEFAULT_PAGE_SIZE = 16;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const BUILTIN_HOSTS = new Set(["khl.api.webcaster.pro", "api-video.khl.ru"]);
const BUILTIN_API_PATHS = new Set(["/api/khl_mobile", "/api/khl_site"]);

type FetchImplementation = typeof fetch;

type ClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxPages?: number;
};

export type KhlStage = {
  stageId: string;
  khlStageId: string;
  title: string;
  type: string;
  season: string;
  current: boolean;
};

export type KhlScheduleEvent = {
  apiEventId: string;
  khlGameId: string;
  matchId: string;
  stageId: string;
  khlStageId: string;
  stageName: string;
  name: string;
  startsAt: string;
  eventStartsAt: string;
  status: KhlMatchStatus;
  score: KhlScore;
  periodScores: {
    P1: KhlScore | null;
    P2: KhlScore | null;
    P3: KhlScore | null;
    OT: KhlScore | null;
    SO: KhlScore | null;
  };
  teams: Record<"home" | "away", KhlTeamIdentity>;
};

export type ListEventsOptions = {
  stageId: string;
  from: Date;
  to: Date;
  orderDirection?: "asc" | "desc";
};

export type KhlEventDetailEnvelope = {
  event: Record<string, unknown>;
  rawBody: string;
  sourceUrl: string;
  contentType: string | null;
  fetchedAt: Date;
};

type RawObject = Record<string, unknown>;

export class KhlApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KhlApiError";
  }
}

export class KhlApiClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxPages: number;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = validateBaseUrl(
      options.baseUrl || process.env.KHL_API_BASE_URL || DEFAULT_BASE_URL
    );
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES;
    this.maxPages = options.maxPages || DEFAULT_MAX_PAGES;
  }

  async listStages(): Promise<KhlStage[]> {
    const url = this.buildUrl("data.json", { locale: "ru" });
    return parseKhlStagesResponse(await this.fetchJson(url));
  }

  async listEvents(options: ListEventsOptions): Promise<KhlScheduleEvent[]> {
    validateListOptions(options);
    const fromSeconds = Math.floor(options.from.getTime() / 1000);
    const toSeconds = Math.floor(options.to.getTime() / 1000);
    const result: KhlScheduleEvent[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= this.maxPages; page += 1) {
      const url = this.buildUrl("events_v2.json", {
        locale: "ru",
        stage_id: String(options.stageId),
        "q[start_at_gt_time_from_unixtime]": String(fromSeconds),
        "q[start_at_lt_time_from_unixtime]": String(toSeconds),
        order_direction: options.orderDirection || "asc",
        page: String(page),
      });
      const raw = await this.fetchJson(url);
      const events = parseKhlScheduleResponse(raw);
      for (const event of events) {
        if (seen.has(event.apiEventId)) continue;
        seen.add(event.apiEventId);
        result.push(event);
      }
      if (events.length < DEFAULT_PAGE_SIZE) return result;
    }

    throw new KhlApiError(
      `KHL schedule pagination exceeded the configured limit of ${this.maxPages} pages.`
    );
  }

  async getEventDetail(input: { apiEventId: string; stageId: string }): Promise<unknown> {
    return (await this.getEventDetailEnvelope(input)).event;
  }

  async getEventDetailEnvelope(
    input: { apiEventId: string; stageId: string }
  ): Promise<KhlEventDetailEnvelope> {
    const apiEventId = positiveDecimalId(input.apiEventId, "KHL API event id");
    const stageId = positiveDecimalId(input.stageId, "KHL stage id");
    const url = this.buildUrl("event_v2.json", {
      id: apiEventId,
      stage_id: stageId,
      locale: "ru",
    });
    const fetched = await this.fetchJsonEnvelope(url);
    const response = asObject(fetched.json, "KHL detail response");
    return {
      event: asObject(response.event, "KHL detail event wrapper"),
      rawBody: fetched.rawBody,
      sourceUrl: url.toString(),
      contentType: fetched.contentType,
      fetchedAt: fetched.fetchedAt,
    };
  }

  private buildUrl(path: string, parameters: Record<string, string>) {
    const base = this.baseUrl.toString().replace(/\/$/, "");
    const url = new URL(`${base}/${path}`);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  private async fetchJson(url: URL): Promise<unknown> {
    return (await this.fetchJsonEnvelope(url)).json;
  }

  private async fetchJsonEnvelope(url: URL): Promise<{
    json: unknown;
    rawBody: string;
    contentType: string | null;
    fetchedAt: Date;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Language": "ru",
          "User-Agent": "TData-KHL/0.1 (+https://www.tdata.info/)",
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > this.maxResponseBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new KhlApiError("KHL API response exceeds the configured size limit.");
      }
      const text = await readBoundedResponseText(response, this.maxResponseBytes);
      if (!response.ok) {
        throw new KhlApiError(`KHL API returned HTTP ${response.status}.`);
      }
      try {
        return {
          json: JSON.parse(text) as unknown,
          rawBody: text,
          contentType: response.headers.get("content-type"),
          fetchedAt: new Date(),
        };
      } catch {
        throw new KhlApiError("KHL API response is not valid JSON.");
      }
    } catch (error) {
      if (error instanceof KhlApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new KhlApiError(`KHL API request timed out after ${this.timeoutMs} ms.`);
      }
      throw new KhlApiError(
        `KHL API request failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseKhlStagesResponse(input: unknown): KhlStage[] {
  const raw = asObject(input, "KHL bootstrap response");
  const currentStageId = requiredExternalId(raw.current_stage_id, "KHL current stage id");
  const stages = asArray(raw.stages_v2, "KHL stages_v2");
  if (stages.length === 0) {
    throw new KhlApiError("KHL stages_v2 is empty; refusing a partial bootstrap response.");
  }
  return stages.map((value, index) => {
    const stage = asObject(value, `KHL stage ${index}`);
    const stageId = requiredExternalId(stage.id, `KHL stage ${index} id`);
    return {
      stageId,
      khlStageId: requiredExternalId(stage.khl_id, `KHL stage ${index} khl_id`),
      title: requiredString(stage.title, `KHL stage ${index} title`),
      type: requiredString(stage.type, `KHL stage ${index} type`),
      season: requiredString(stage.season, `KHL stage ${index} season`),
      current: stageId === currentStageId,
    };
  });
}

export function parseKhlScheduleResponse(input: unknown): KhlScheduleEvent[] {
  const values = asArray(input, "KHL schedule response");
  return values.map((value, index) => {
    const wrapper = asObject(value, `KHL schedule wrapper ${index}`);
    const raw = asObject(wrapper.event, `KHL schedule wrapper ${index} event`);
    const home = asObject(raw.team_a, `KHL schedule event ${index} home team`);
    const away = asObject(raw.team_b, `KHL schedule event ${index} away team`);
    const scores = asObject(raw.scores, `KHL schedule event ${index} scores`);
    return {
      apiEventId: requiredExternalId(raw.id, `KHL schedule event ${index} id`),
      khlGameId: requiredExternalId(raw.khl_id, `KHL schedule event ${index} khl_id`),
      matchId: requiredString(raw.match_id, `KHL schedule event ${index} match_id`),
      stageId: requiredExternalId(raw.stage_id, `KHL schedule event ${index} stage_id`),
      khlStageId: requiredExternalId(
        raw.outer_stage_id,
        `KHL schedule event ${index} outer_stage_id`
      ),
      stageName: requiredString(raw.stage_name, `KHL schedule event ${index} stage name`),
      name: requiredString(raw.name, `KHL schedule event ${index} name`),
      startsAt: parseMillisecondTimestamp(raw.start_at, `KHL schedule event ${index} start_at`),
      eventStartsAt: parseMillisecondTimestamp(
        raw.event_start_at,
        `KHL schedule event ${index} event_start_at`
      ),
      status: normalizeStatus(optionalString(raw.game_state_key)),
      score: parseScore(raw.score, `KHL schedule event ${index} score`) || { home: 0, away: 0 },
      periodScores: {
        P1: parseScore(scores.first_period, "KHL first period score"),
        P2: parseScore(scores.second_period, "KHL second period score"),
        P3: parseScore(scores.third_period, "KHL third period score"),
        OT: parseScore(scores.overtime, "KHL overtime score"),
        SO: parseScore(scores.bullitt, "KHL shootout score"),
      },
      teams: {
        home: parseTeam(home, "home"),
        away: parseTeam(away, "away"),
      },
    };
  });
}

function parseTeam(raw: RawObject, side: "home" | "away"): KhlTeamIdentity {
  return {
    apiTeamId: requiredExternalId(raw.id, `KHL ${side} API team id`),
    khlTeamId: requiredExternalId(raw.khl_id, `KHL ${side} team id`),
    name: requiredString(raw.name, `KHL ${side} team name`),
    location: optionalString(raw.location),
  };
}

function validateBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KhlApiError("KHL API base URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new KhlApiError("KHL API base URL must use HTTPS without inline credentials.");
  }
  const configuredHosts = String(process.env.KHL_API_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (!BUILTIN_HOSTS.has(url.hostname.toLowerCase()) && !configuredHosts.includes(url.hostname.toLowerCase())) {
    throw new KhlApiError("KHL API host is not approved.");
  }
  const path = url.pathname.replace(/\/$/, "");
  if (!BUILTIN_API_PATHS.has(path)) {
    throw new KhlApiError("KHL API base path is not approved.");
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

function validateListOptions(options: ListEventsOptions) {
  positiveDecimalId(options.stageId, "KHL stage id");
  if (!Number.isFinite(options.from.getTime()) || !Number.isFinite(options.to.getTime())) {
    throw new KhlApiError("KHL schedule bounds must be valid dates.");
  }
  if (options.from.getTime() >= options.to.getTime()) {
    throw new KhlApiError("KHL schedule start must be before its end.");
  }
}

function parseMillisecondTimestamp(value: unknown, label: string) {
  const timestamp = requiredNumber(value, label);
  if (timestamp < 1_000_000_000_000) {
    throw new KhlApiError(`${label} must be expressed in milliseconds.`);
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new KhlApiError(`${label} is invalid.`);
  return date.toISOString();
}

function parseScore(value: unknown, label: string): KhlScore | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new KhlApiError(`${label} must be a string or null.`);
  const match = value.trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) throw new KhlApiError(`${label} must use home:away format.`);
  return { home: Number(match[1]), away: Number(match[2]) };
}

function normalizeStatus(value: string | null): KhlMatchStatus {
  if (value === "finished") return "finished";
  if (value === "in_progress") return "live";
  if (value === "not_yet_started") return "scheduled";
  if (value === "cancelled" || value === "postponed") return "cancelled";
  return "unknown";
}

function asObject(value: unknown, label: string): RawObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KhlApiError(`${label} must be an object.`);
  }
  return value as RawObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new KhlApiError(`${label} must be an array.`);
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new KhlApiError(`${label} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredNumber(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new KhlApiError(`${label} must be a number.`);
  return number;
}

function requiredExternalId(value: unknown, label: string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new KhlApiError(`${label} must be a positive safe integer or decimal string.`);
    }
    return String(value);
  }
  if (typeof value === "string") return positiveDecimalId(value, label);
  throw new KhlApiError(`${label} must be a positive safe integer or decimal string.`);
}

function positiveDecimalId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[1-9]\d{0,127}$/.test(value.trim())) {
    throw new KhlApiError(`${label} must be a positive decimal string.`);
  }
  return value.trim();
}

async function readBoundedResponseText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new KhlApiError("KHL API response exceeds the configured size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}
