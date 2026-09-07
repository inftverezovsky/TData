import { requestTLine } from "../api";
import type { TLineChampionship, TLineGlobalHeader, TLineSchedule, TLineSport, TLineTeamMapping } from "../types";

/** Граница HTTP → проверенные модели форм; секретные настройки не входят в эти структуры. */
export const emptySchedule: TLineSchedule = {
  enabled: false,
  slots: ["08:00", "12:00", "16:00", "22:00"],
  nextRunAt: null,
};
export const EMPTY_SPORTS: TLineSport[] = [];
export const EMPTY_CHAMPIONSHIPS: TLineChampionship[] = [];
export const EMPTY_GLOBAL_HEADERS: TLineGlobalHeader[] = [];

export async function loadSports(url: string): Promise<TLineSport[]> {
  const data = await requestTLine<unknown>(url);
  const values = readArray(data, "sports");
  return values.flatMap((value) =>
    isRecord(value) && asString(value.id) && asString(value.name)
      ? [
          {
            id: asString(value.id),
            slug: asString(value.slug) || asString(value.id),
            name: asString(value.name),
            active: value.active !== false,
            autoEnabled: Boolean(value.autoEnabled),
            adminSportId: nullableString(value.adminSportId),
            autoPeriodFromOffsetMinutes: nullableNumber(value.autoPeriodFromOffsetMinutes),
            autoPeriodToOffsetMinutes: nullableNumber(value.autoPeriodToOffsetMinutes),
            candidateMatchWindowMinutes: nullableNumber(value.candidateMatchWindowMinutes),
            defaultAllowedTimeDriftMinutes: nullableNumber(value.defaultAllowedTimeDriftMinutes),
          },
        ]
      : [],
  );
}

export async function loadChampionships(url: string): Promise<TLineChampionship[]> {
  const data = await requestTLine<unknown>(url);
  const values = readArray(data, "championships");
  return values.flatMap((value) =>
    isRecord(value) && asString(value.id) && asString(value.name)
      ? [
          {
            id: asString(value.id),
            name: asString(value.name),
            sportId: asString(value.sportId),
            sourceUrl: asString(value.sourceUrl),
            globalHeaderId: nullableString(value.globalHeaderId),
            globalHeader: parseGlobalHeaderRef(value.globalHeader),
            active: value.active !== false,
            autoEnabled: Boolean(value.autoEnabled),
            allowedTimeDriftMinutes: nullableNumber(value.allowedTimeDriftMinutes),
            candidateMatchWindowMinutes: nullableNumber(value.candidateMatchWindowMinutes),
            adminChampionshipId: nullableString(value.adminChampionshipId),
            adminChampionshipName: nullableString(value.adminChampionshipName),
          },
        ]
      : [],
  );
}

export async function loadGlobalHeaders(url: string): Promise<TLineGlobalHeader[]> {
  const data = await requestTLine<unknown>(url);
  const values = readArray(data);
  return values.flatMap((value) =>
    isRecord(value) && asString(value.id)
      ? [
          {
            id: asString(value.id),
            sportId: asString(value.sportId),
            sportName: asString(value.sportName),
            adminShapkaId: asString(value.adminShapkaId),
            name: nullableString(value.name),
            active: value.active !== false,
            teamCount: nullableNumber(value.teamCount) ?? 0,
            championships: Array.isArray(value.championships)
              ? value.championships.flatMap((championship) =>
                  isRecord(championship) && asString(championship.id)
                    ? [
                        {
                          id: asString(championship.id),
                          name: asString(championship.name),
                          active: championship.active !== false,
                        },
                      ]
                    : [],
                )
              : [],
          },
        ]
      : [],
  );
}

export async function loadMappings(url: string): Promise<TLineTeamMapping[]> {
  const data = await requestTLine<unknown>(url);
  const values = readArray(data, "mappings");
  return values.flatMap((value) =>
    isRecord(value) && asString(value.id) && asString(value.sourceTeamId)
      ? [
          {
            id: asString(value.id),
            sourceTeamId: asString(value.sourceTeamId),
            sourceTeamExternalId: nullableString(value.sourceTeamExternalId),
            sourceTeamName: asString(value.sourceTeamName || value.sourceName),
            adminTeamId: nullableString(value.adminTeamId),
            adminTeamPlatformId: nullableString(value.adminTeamPlatformId),
            adminTeamName: nullableString(value.adminTeamName),
            status: asString(value.status) || "UNMAPPED",
            matchMethod: nullableString(value.matchMethod),
            inDirectory: Boolean(value.inDirectory),
            locked: Boolean(value.locked),
            confidence: typeof value.confidence === "number" ? value.confidence : null,
          },
        ]
      : [],
  );
}

export async function loadSchedule(url: string): Promise<TLineSchedule> {
  const data = await requestTLine<unknown>(url);
  if (!isRecord(data) || typeof data.enabled !== "boolean" || !Array.isArray(data.slots))
    throw new Error("Некорректный ответ расписания TLine");
  return isRecord(data)
    ? {
        enabled: Boolean(data.enabled),
        slots: Array.isArray(data.slots)
          ? data.slots.filter((value): value is string => typeof value === "string")
          : emptySchedule.slots,
        nextRunAt: nullableString(data.nextRunAt),
      }
    : emptySchedule;
}

export async function loadAdminStatus(url: string): Promise<{ configured: boolean; connected: boolean }> {
  const data = await requestTLine<unknown>(url);
  return isRecord(data)
    ? { configured: Boolean(data.configured), connected: Boolean(data.connected) }
    : { configured: false, connected: false };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function asString(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
function nullableString(value: unknown) {
  return asString(value) || null;
}
function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function parseGlobalHeaderRef(value: unknown): TLineChampionship["globalHeader"] {
  return isRecord(value) && asString(value.id)
    ? {
        id: asString(value.id),
        adminShapkaId: asString(value.adminShapkaId),
        name: nullableString(value.name),
        active: value.active !== false,
      }
    : null;
}

function readArray(data: unknown, key?: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (key && isRecord(data) && Array.isArray(data[key])) return data[key];
  throw new Error("Некорректный ответ справочника TLine");
}
