export type TLineRunState =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "CANCELLED"
  | "FAILED";

export interface TLineRunRecord {
  id: string;
  sportConfigId: string;
  status: TLineRunState;
  periodFrom: Date;
  periodTo: Date;
  createdAt: Date;
}

export interface ManualTLineRunInput {
  sportId: string;
  from: Date;
  to: Date;
}

export interface CreateTLineRunWithJobInput extends ManualTLineRunInput {
  trigger: "MANUAL";
}

export interface TLineRunStore {
  findActiveRun(sportConfigId: string): Promise<TLineRunRecord | null>;
  createRunWithJob(input: CreateTLineRunWithJobInput): Promise<TLineRunRecord>;
}

export class TLineRunRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TLineRunRequestError";
  }
}

export class TLineRunAlreadyActiveError extends Error {
  constructor() {
    super("A run for this sport is already active.");
    this.name = "TLineRunAlreadyActiveError";
  }
}

export async function requestManualTLineRun(
  store: TLineRunStore,
  input: ManualTLineRunInput,
): Promise<{ run: TLineRunRecord; deduplicated: boolean }> {
  validateManualRunInput(input);

  const activeRun = await store.findActiveRun(input.sportId);
  if (activeRun) return { run: activeRun, deduplicated: true };

  try {
    const run = await store.createRunWithJob({
      sportId: input.sportId,
      from: new Date(input.from),
      to: new Date(input.to),
      trigger: "MANUAL",
    });
    return { run, deduplicated: false };
  } catch (error) {
    if (!(error instanceof TLineRunAlreadyActiveError)) throw error;
    const concurrentRun = await store.findActiveRun(input.sportId);
    if (!concurrentRun) throw error;
    return { run: concurrentRun, deduplicated: true };
  }
}

function validateManualRunInput(input: ManualTLineRunInput) {
  if (!input.sportId.trim()) {
    throw new TLineRunRequestError("SPORT_REQUIRED", "Sport is required.");
  }
  if (!isValidDate(input.from) || !isValidDate(input.to) || input.to <= input.from) {
    throw new TLineRunRequestError("INVALID_PERIOD", "The end of the period must follow its start.");
  }
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}
