export type TLineRunTriggerValue = "MANUAL" | "SCHEDULED";

export interface CreateTLineRunInput {
  sportConfigId: string;
  trigger: TLineRunTriggerValue;
  periodFrom: Date;
  periodTo: Date;
  scheduledAt?: Date | null;
}

export interface TLineRunCreateData {
  sportConfigId: string;
  trigger: TLineRunTriggerValue;
  status: "QUEUED";
  periodFrom: Date;
  periodTo: Date;
  scheduledAt: Date | null;
}

export function buildCreateRunInput(input: CreateTLineRunInput): TLineRunCreateData {
  if (!input.sportConfigId.trim()) {
    throw new Error("sportConfigId is required");
  }
  assertValidDate(input.periodFrom, "periodFrom");
  assertValidDate(input.periodTo, "periodTo");
  if (input.periodTo.getTime() <= input.periodFrom.getTime()) {
    throw new Error("periodTo must be after periodFrom");
  }
  if (input.trigger === "SCHEDULED" && !input.scheduledAt) {
    throw new Error("scheduledAt is required for a scheduled run");
  }
  if (input.scheduledAt) {
    assertValidDate(input.scheduledAt, "scheduledAt");
  }

  return {
    sportConfigId: input.sportConfigId,
    trigger: input.trigger,
    status: "QUEUED",
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    scheduledAt: input.scheduledAt ?? null,
  };
}

export function isActiveRunConstraintViolation(error: unknown): boolean {
  if (!isRecord(error) || error.code !== "P2002" || !isRecord(error.meta)) {
    return false;
  }

  const target = error.meta.target;
  if (typeof target === "string") {
    return (
      target === "TLineRun_one_active_per_sport" ||
      target.includes("TLineRun_one_active_per_sport")
    );
  }
  if (Array.isArray(target)) {
    return (
      target.includes("TLineRun_one_active_per_sport") ||
      (target.length === 1 && target[0] === "sportConfigId")
    );
  }

  const modelName = error.meta.modelName;
  const message = typeof error.message === "string" ? error.message : "";
  return (
    modelName === "TLineRun" &&
    (target === null || message.includes("TLineRun_one_active_per_sport"))
  );
}

function assertValidDate(value: Date, name: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
