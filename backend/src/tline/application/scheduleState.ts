import type { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

import { TLineValidationError } from "../api/validation";
import { DEFAULT_TLINE_SLOT_HOURS, DEFAULT_TLINE_TIMEZONE } from "../scheduler/slots";

export async function getTLineScheduleView(client: PrismaClient) {
  const state = await client.tLineScheduleState.findUnique({ where: { id: "global" } });
  const enabled = state?.enabled ?? false;
  const timezone = state?.timezone ?? DEFAULT_TLINE_TIMEZONE;
  const slotHours = state?.slotHours ?? [...DEFAULT_TLINE_SLOT_HOURS];
  return {
    enabled,
    timezone,
    slots: slotHours.map((hour) => `${String(hour).padStart(2, "0")}:00`),
    nextRunAt: enabled ? nextScheduleSlot(new Date(), timezone, slotHours) : null,
  };
}

export async function updateTLineSchedule(
  client: PrismaClient,
  input: { enabled?: boolean; slotHours?: number[] },
) {
  if (input.enabled) await assertTLineSchedulerReady(client);
  await client.tLineScheduleState.upsert({
    where: { id: "global" },
    update: {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.slotHours === undefined ? {} : { slotHours: input.slotHours }),
    },
    create: {
      id: "global",
      enabled: input.enabled ?? false,
      timezone: DEFAULT_TLINE_TIMEZONE,
      slotHours: input.slotHours ?? [...DEFAULT_TLINE_SLOT_HOURS],
    },
  });
  return getTLineScheduleView(client);
}

export async function stopTLineSchedule(client: PrismaClient) {
  const now = new Date();
  await client.$transaction([
    client.tLineScheduleState.upsert({
      where: { id: "global" },
      update: { enabled: false },
      create: { id: "global", enabled: false },
    }),
    client.tLineRun.updateMany({
      where: { trigger: "SCHEDULED", status: { in: ["QUEUED", "RUNNING"] } },
      data: { cancelRequestedAt: now },
    }),
    client.tLineJob.updateMany({
      where: {
        run: { is: { trigger: "SCHEDULED", status: { in: ["QUEUED", "RUNNING"] } } },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: { cancelRequestedAt: now },
    }),
  ]);
  return getTLineScheduleView(client);
}

export async function assertTLineSchedulerReady(client: PrismaClient) {
  if (process.env.TLINE_ENABLED !== "1" || process.env.TLINE_SCHEDULER_READY !== "1") {
    throw new TLineValidationError(
      "SCHEDULER_NOT_READY",
      "Scheduler activation is locked until deployment readiness is explicitly confirmed.",
    );
  }
  const configuredSports = await client.tLineSportConfig.findMany({
    where: { active: true, autoEnabled: true },
    select: {
      adminSportId: true,
      autoPeriodFromOffsetMinutes: true,
      autoPeriodToOffsetMinutes: true,
      candidateMatchWindowMinutes: true,
      defaultAllowedTimeDriftMinutes: true,
      championships: {
        where: { active: true, autoEnabled: true, deletedAt: null },
        select: {
          adminChampionshipId: true,
          globalHeader: { select: { adminShapkaId: true } },
          allowedTimeDriftMinutes: true,
          candidateMatchWindowMinutes: true,
        },
      },
    },
  });
  const invalid = configuredSports.length === 0 || configuredSports.some((sport) =>
    sport.adminSportId === null
    || sport.autoPeriodFromOffsetMinutes === null
    || sport.autoPeriodToOffsetMinutes === null
    || sport.candidateMatchWindowMinutes === null
    || sport.defaultAllowedTimeDriftMinutes === null
    || sport.championships.length === 0
    || sport.championships.some((championship) =>
      championship.adminChampionshipId === null
      || !championship.globalHeader?.adminShapkaId
      || (championship.allowedTimeDriftMinutes ?? sport.defaultAllowedTimeDriftMinutes) === null
      || (championship.candidateMatchWindowMinutes ?? sport.candidateMatchWindowMinutes) === null
    )
  );
  if (invalid) {
    throw new TLineValidationError(
      "SCHEDULER_CONFIG_INCOMPLETE",
      "Scheduler settings, candidate windows, tolerances and Admin Sport, Shapka and Championship IDs must be configured first.",
    );
  }
}

export function parseScheduleSlots(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TLineValidationError("INVALID_SCHEDULE", "slots must be a non-empty array.");
  }
  const hours = value.map((slot) => {
    if (typeof slot !== "string" || !/^(?:[01]\d|2[0-3]):00$/.test(slot)) {
      throw new TLineValidationError("INVALID_SCHEDULE", "Each schedule slot must be an exact HH:00 value.");
    }
    return Number(slot.slice(0, 2));
  });
  return [...new Set(hours)].sort((left, right) => left - right);
}

function nextScheduleSlot(now: Date, timezone: string, slotHours: readonly number[]) {
  const localNow = DateTime.fromJSDate(now, { zone: timezone });
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const day = localNow.plus({ days: dayOffset }).startOf("day");
    for (const hour of [...slotHours].sort((left, right) => left - right)) {
      const candidate = day.set({ hour });
      if (candidate > localNow) return candidate.toUTC().toJSDate();
    }
  }
  return null;
}
