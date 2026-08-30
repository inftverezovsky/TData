export type TLineInputErrorCode =
  | "INVALID_MANUAL_RUN"
  | "INVALID_PERIOD"
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE";

export class TLineInputError extends Error {
  constructor(
    readonly code: TLineInputErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TLineInputError";
  }
}

export interface ManualRunRequest {
  sportId: string;
  from: Date;
  to: Date;
}

export function parseManualRunRequest(value: unknown): ManualRunRequest {
  if (!isObject(value)) {
    throw invalidManualRun();
  }

  const sportId = typeof value.sportId === "string" ? value.sportId.trim() : "";
  const from = parseUtcDate(value.from);
  const to = parseUtcDate(value.to);
  if (!sportId || sportId.length > 128 || !from || !to) {
    throw invalidManualRun();
  }
  if (from.getTime() >= to.getTime()) {
    throw new TLineInputError("INVALID_PERIOD", "The run period must end after it starts.");
  }

  return { sportId, from, to };
}

export function serializeTLineJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => serializeTLineJson(item));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeTLineJson(item)])
    );
  }
  return value;
}

function parseUtcDate(value: unknown) {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidManualRun() {
  return new TLineInputError(
    "INVALID_MANUAL_RUN",
    "sportId and valid timezone-aware from/to timestamps are required."
  );
}
