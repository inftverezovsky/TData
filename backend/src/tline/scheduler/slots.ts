import { DateTime } from "luxon";

export const DEFAULT_TLINE_SLOT_HOURS = Object.freeze([8, 12, 16, 22]);
export const DEFAULT_TLINE_TIMEZONE = "Europe/Moscow";

export interface ComputeDueScheduleSlotsInput {
  lastTickAt: Date;
  now: Date;
  timezone?: string;
  slotHours?: readonly number[];
}

export interface SchedulableSport {
  id: string;
  active: boolean;
  autoEnabled: boolean;
  autoPeriodFromOffsetMinutes: number | null;
  autoPeriodToOffsetMinutes: number | null;
}

export interface ScheduledRunRequest {
  sportConfigId: string;
  scheduledAt: Date;
  periodFrom: Date;
  periodTo: Date;
  idempotencyKey: string;
}

export interface BuildScheduledRunRequestsInput {
  slots: readonly Date[];
  sports: readonly SchedulableSport[];
}

export function computeDueScheduleSlots(input: ComputeDueScheduleSlotsInput): Date[] {
  assertValidDate(input.lastTickAt, "lastTickAt");
  assertValidDate(input.now, "now");
  if (input.now.getTime() < input.lastTickAt.getTime()) {
    throw new Error("now must not precede lastTickAt");
  }

  const timezone = input.timezone ?? DEFAULT_TLINE_TIMEZONE;
  const now = DateTime.fromJSDate(input.now, { zone: timezone });
  const lastTick = DateTime.fromJSDate(input.lastTickAt, { zone: timezone });
  if (!now.isValid || !lastTick.isValid) {
    throw new Error(`timezone must be a valid IANA zone: ${timezone}`);
  }

  const slotHours = normalizeSlotHours(input.slotHours ?? DEFAULT_TLINE_SLOT_HOURS);
  const due: Date[] = [];
  let day = lastTick.startOf("day");
  const finalDay = now.startOf("day");
  let visitedDays = 0;

  while (day <= finalDay) {
    if (visitedDays++ > 3_660) {
      throw new Error("schedule catch-up window exceeds 10 years");
    }
    for (const hour of slotHours) {
      const slot = day.set({ hour, minute: 0, second: 0, millisecond: 0 });
      if (
        slot.isValid &&
        slot.toMillis() > lastTick.toMillis() &&
        slot.toMillis() <= now.toMillis()
      ) {
        due.push(slot.toUTC().toJSDate());
      }
    }
    day = day.plus({ days: 1 }).startOf("day");
  }

  return due;
}

export function buildScheduledRunRequests(
  input: BuildScheduledRunRequestsInput,
): ScheduledRunRequest[] {
  const requests: ScheduledRunRequest[] = [];
  const slots = [...input.slots].sort((left, right) => left.getTime() - right.getTime());

  for (const slot of slots) {
    assertValidDate(slot, "scheduledAt");
    for (const sport of input.sports) {
      if (!sport.active || !sport.autoEnabled) continue;
      if (
        sport.autoPeriodFromOffsetMinutes === null ||
        sport.autoPeriodToOffsetMinutes === null
      ) {
        throw new Error(`period offsets are required for enabled sport ${sport.id}`);
      }
      if (!sport.id.trim()) throw new Error("sport id is required");

      const periodFrom = addMinutes(slot, sport.autoPeriodFromOffsetMinutes);
      const periodTo = addMinutes(slot, sport.autoPeriodToOffsetMinutes);
      if (periodTo.getTime() <= periodFrom.getTime()) {
        throw new Error(`period offsets are inverted for enabled sport ${sport.id}`);
      }

      requests.push({
        sportConfigId: sport.id,
        scheduledAt: slot,
        periodFrom,
        periodTo,
        idempotencyKey: `tline:run:${sport.id}:${slot.toISOString()}`,
      });
    }
  }

  return requests;
}

function normalizeSlotHours(hours: readonly number[]) {
  if (hours.length === 0) throw new Error("slotHours must not be empty");
  for (const hour of hours) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error("slotHours must contain integers from 0 through 23");
    }
  }
  return [...new Set(hours)].sort((left, right) => left - right);
}

function assertValidDate(value: Date, name: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
}

function addMinutes(date: Date, minutes: number) {
  if (!Number.isSafeInteger(minutes)) {
    throw new Error("period offsets must be safe integers");
  }
  return new Date(date.getTime() + minutes * 60_000);
}
