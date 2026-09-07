import type { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

import {
  KhlApiClient,
  type KhlEventDetailEnvelope,
  type KhlScheduleEvent,
  type KhlStage,
  type ListEventsOptions,
} from "@backend/sources/results/khl/client";
import {
  normalizeKhlEventDetail,
  type KhlMatchStatus,
} from "@backend/sources/results/khl/normalize";
import { ingestKhlEventDetail } from "./repository";

export const KHL_RESULTS_CUTOFF_DAY = "2026-05-01";
export const KHL_RESULTS_TIME_ZONE = "Europe/Moscow";
export const KHL_RESULTS_CUTOFF = localDayStart(
  KHL_RESULTS_CUTOFF_DAY,
  KHL_RESULTS_TIME_ZONE
);
export const KHL_RESULTS_DEFAULT_LOOKBACK_DAYS = 14;
export const KHL_RESULTS_REFRESH_HOURS = 6;

const SCHEDULE_WINDOW_DAYS = 31;
const DAY_MS = 86_400_000;

function localDayStart(day: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid KHL results cutoff day: ${day}`);
  }
  const local = DateTime.fromISO(day, { zone: timeZone }).startOf("day");
  if (!local.isValid || local.toISODate() !== day) {
    throw new Error(
      `Invalid KHL results cutoff day or time zone: ${day} (${timeZone}).`
    );
  }
  const instant = local.toUTC().toJSDate();
  if (!Number.isFinite(instant.getTime())) {
    throw new Error(`Invalid KHL results cutoff instant: ${day} (${timeZone}).`);
  }
  return instant;
}

export type KhlResultsSyncClient = {
  listStages(): Promise<KhlStage[]>;
  listEvents(options: ListEventsOptions): Promise<KhlScheduleEvent[]>;
  getEventDetailEnvelope(input: {
    apiEventId: string;
    stageId: string;
  }): Promise<KhlEventDetailEnvelope>;
};

type SyncFailure = {
  scope: "schedule" | "event";
  stageId: string;
  khlGameId: string | null;
  apiEventId: string | null;
  message: string;
};

export type KhlResultsSyncSummary = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  range: { from: string; to: string };
  stages: { available: number; selected: number; scannedWindows: number };
  events: {
    discovered: number;
    eligible: number;
    ingested: number;
    reusedSnapshots: number;
    reusedRevisions: number;
    rejectedRevisions: number;
    skippedBeforeCutoff: number;
    skippedAfterRange: number;
    skippedNotFinished: number;
    skippedDuplicate: number;
    skippedRecentlyFetched: number;
  };
  failures: SyncFailure[];
};

type IngestResult = {
  reusedSnapshot: boolean;
  reusedRevision: boolean;
  revision?: { state: string };
};

type SyncOptions = {
  prisma: PrismaClient;
  from: Date;
  to: Date;
  now?: Date;
  client?: KhlResultsSyncClient;
  refreshExistingAfterMs?: number;
  inspectDetail?: (event: Record<string, unknown>) => {
    khlGameId: string;
    stageId: string;
    startsAt: Date;
    status: KhlMatchStatus;
  };
  ingest?: (
    prisma: PrismaClient,
    input: {
      rawBody: string;
      sourceUrl: string;
      fetchedAt: Date;
      contentType?: string;
    }
  ) => Promise<IngestResult>;
};

/**
 * Ограничить период датой начала проекта → прочитать расписание окнами → отобрать
 * уникальные завершённые игры → проверить подробный протокол → сохранить ревизии.
 * Ошибки отдельных окон и игр попадают в отчёт; импорт остальных результатов продолжается.
 */
export async function syncKhlResults(options: SyncOptions): Promise<KhlResultsSyncSummary> {
  const startedAt = validDate(options.now || new Date(), "sync start");
  const requestedFrom = validDate(options.from, "sync range start");
  const to = validDate(options.to, "sync range end");
  const from = new Date(Math.max(requestedFrom.getTime(), KHL_RESULTS_CUTOFF.getTime()));
  if (from.getTime() >= to.getTime()) {
    throw new Error("KHL automatic sync range must end after 2026-05-01 and after its start.");
  }

  const client = options.client || new KhlApiClient();
  const ingest = options.ingest || ingestKhlEventDetail;
  const inspectDetail = options.inspectDetail || inspectNormalizedDetail;
  const refreshExistingAfterMs = options.refreshExistingAfterMs
    ?? KHL_RESULTS_REFRESH_HOURS * 60 * 60 * 1000;
  if (!Number.isFinite(refreshExistingAfterMs) || refreshExistingAfterMs < 0) {
    throw new Error("KHL automatic sync refresh interval must be a non-negative number.");
  }

  const stages = await client.listStages();
  const selectedStages = stages.filter((stage) => seasonOverlapsRange(stage.season, from, to));
  const windows = buildScheduleWindows(from, to);
  const failures: SyncFailure[] = [];
  const candidates: KhlScheduleEvent[] = [];
  const seenGames = new Set<string>();
  const eventCounters = {
    discovered: 0,
    eligible: 0,
    ingested: 0,
    reusedSnapshots: 0,
    reusedRevisions: 0,
    rejectedRevisions: 0,
    skippedBeforeCutoff: 0,
    skippedAfterRange: 0,
    skippedNotFinished: 0,
    skippedDuplicate: 0,
    skippedRecentlyFetched: 0,
  };
  let scannedWindows = 0;

  for (const stage of selectedStages) {
    for (const window of windows) {
      try {
        const events = await client.listEvents({
          stageId: stage.stageId,
          from: window.from,
          to: window.to,
          orderDirection: "asc",
        });
        scannedWindows += 1;
        eventCounters.discovered += events.length;
        for (const event of events) {
          const startsAt = new Date(event.startsAt);
          if (!Number.isFinite(startsAt.getTime())) {
            failures.push(eventFailure(event, "KHL schedule returned an invalid match date."));
            continue;
          }
          if (startsAt < KHL_RESULTS_CUTOFF || startsAt < from) {
            eventCounters.skippedBeforeCutoff += 1;
            continue;
          }
          if (startsAt > to) {
            eventCounters.skippedAfterRange += 1;
            continue;
          }
          if (event.status !== "finished") {
            eventCounters.skippedNotFinished += 1;
            continue;
          }
          if (seenGames.has(event.khlGameId)) {
            eventCounters.skippedDuplicate += 1;
            continue;
          }
          seenGames.add(event.khlGameId);
          candidates.push(event);
        }
      } catch (cause) {
        failures.push({
          scope: "schedule",
          stageId: stage.stageId,
          khlGameId: null,
          apiEventId: null,
          message: errorMessage(cause),
        });
      }
    }
  }

  // Сначала собираем кандидатов, затем одним пакетным чтением исключаем недавно обновлённые игры.
  eventCounters.eligible = candidates.length;
  const recentlyFetched = await recentlyFetchedGameIds(
    options.prisma,
    candidates.map((event) => event.khlGameId),
    new Date(startedAt.getTime() - refreshExistingAfterMs)
  );

  for (const event of candidates) {
    if (refreshExistingAfterMs > 0 && recentlyFetched.has(event.khlGameId)) {
      eventCounters.skippedRecentlyFetched += 1;
      continue;
    }
    try {
      const detail = await client.getEventDetailEnvelope({
        apiEventId: event.apiEventId,
        stageId: event.stageId,
      });
      // Доверия к расписанию недостаточно: протокол обязан совпасть по игре, этапу, периоду и статусу.
      const inspected = inspectDetail(detail.event);
      if (
        inspected.khlGameId !== event.khlGameId
        || inspected.stageId !== event.stageId
        || inspected.startsAt < KHL_RESULTS_CUTOFF
        || inspected.startsAt < from
        || inspected.startsAt > to
        || inspected.status !== "finished"
      ) {
        throw new Error("KHL detail identity, date or finished status does not match the selected result.");
      }
      const result = await ingest(options.prisma, {
        rawBody: detail.rawBody,
        sourceUrl: detail.sourceUrl,
        fetchedAt: detail.fetchedAt,
        contentType: detail.contentType || "application/json",
      });
      eventCounters.ingested += 1;
      if (result.reusedSnapshot) eventCounters.reusedSnapshots += 1;
      if (result.reusedRevision) eventCounters.reusedRevisions += 1;
      if (result.revision && result.revision.state !== "VALIDATED") {
        eventCounters.rejectedRevisions += 1;
        failures.push(eventFailure(
          event,
          `KHL normalized revision was stored as ${result.revision.state} and was not activated.`
        ));
      }
    } catch (cause) {
      failures.push(eventFailure(event, errorMessage(cause)));
    }
  }

  const completedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    range: { from: from.toISOString(), to: to.toISOString() },
    stages: {
      available: stages.length,
      selected: selectedStages.length,
      scannedWindows,
    },
    events: eventCounters,
    failures,
  };
}

export function defaultKhlSyncFrom(now: Date) {
  const validNow = validDate(now, "current time");
  return new Date(Math.max(
    KHL_RESULTS_CUTOFF.getTime(),
    validNow.getTime() - KHL_RESULTS_DEFAULT_LOOKBACK_DAYS * DAY_MS
  ));
}

function buildScheduleWindows(from: Date, to: Date) {
  const windows: Array<{ from: Date; to: Date }> = [];
  let cursor = from.getTime();
  while (cursor < to.getTime()) {
    const end = Math.min(cursor + SCHEDULE_WINDOW_DAYS * DAY_MS, to.getTime());
    windows.push({ from: new Date(cursor), to: new Date(end) });
    cursor = end;
  }
  return windows;
}

function seasonOverlapsRange(season: string, from: Date, to: Date) {
  const match = season.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return false;
  const seasonStartYear = Number(match[1]);
  const seasonEndYear = Number(match[2]);
  return seasonEndYear >= from.getUTCFullYear() && seasonStartYear <= to.getUTCFullYear();
}

async function recentlyFetchedGameIds(
  prisma: PrismaClient,
  khlGameIds: string[],
  refreshBefore: Date
) {
  const result = new Set<string>();
  for (let offset = 0; offset < khlGameIds.length; offset += 500) {
    const matches = await prisma.khlMatch.findMany({
      where: { khlGameId: { in: khlGameIds.slice(offset, offset + 500) } },
      select: {
        khlGameId: true,
        rawSnapshots: {
          orderBy: { lastFetchedAt: "desc" },
          take: 1,
          select: { lastFetchedAt: true },
        },
      },
    });
    for (const match of matches) {
      const lastFetchedAt = match.rawSnapshots[0]?.lastFetchedAt;
      if (lastFetchedAt && lastFetchedAt >= refreshBefore) result.add(match.khlGameId);
    }
  }
  return result;
}

function eventFailure(event: KhlScheduleEvent, message: string): SyncFailure {
  return {
    scope: "event",
    stageId: event.stageId,
    khlGameId: event.khlGameId,
    apiEventId: event.apiEventId,
    message,
  };
}

function validDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`KHL ${label} must be a valid date.`);
  }
  return new Date(value.getTime());
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Unknown KHL sync error.";
}

function inspectNormalizedDetail(event: Record<string, unknown>) {
  const normalized = normalizeKhlEventDetail(event);
  return {
    khlGameId: normalized.identity.khlGameId,
    stageId: normalized.identity.stageId,
    startsAt: new Date(normalized.startsAt),
    status: normalized.status,
  };
}
