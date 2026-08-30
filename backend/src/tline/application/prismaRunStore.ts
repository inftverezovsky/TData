import type { PrismaClient } from "@prisma/client";

import {
  TLineRunAlreadyActiveError,
  TLineRunRequestError,
  type CreateTLineRunWithJobInput,
  type TLineRunRecord,
  type TLineRunStore,
} from "./runs";
import { isActiveRunConstraintViolation } from "../persistence/runs";

const ACTIVE_RUN_STATES = ["QUEUED", "RUNNING"] as const;
const runSelection = {
  id: true,
  sportConfigId: true,
  status: true,
  periodFrom: true,
  periodTo: true,
  createdAt: true,
} as const;

export class PrismaTLineRunStore implements TLineRunStore {
  constructor(private readonly client: PrismaClient) {}

  async findActiveRun(sportConfigId: string): Promise<TLineRunRecord | null> {
    return this.client.tLineRun.findFirst({
      where: { sportConfigId, status: { in: [...ACTIVE_RUN_STATES] } },
      orderBy: { createdAt: "desc" },
      select: runSelection,
    });
  }

  async createRunWithJob(input: CreateTLineRunWithJobInput): Promise<TLineRunRecord> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const sport = await transaction.tLineSportConfig.findFirst({
          where: { id: input.sportId, active: true },
          select: {
            id: true,
            championships: {
              where: { active: true, deletedAt: null },
              select: { id: true },
            },
          },
        });
        if (!sport) {
          throw new TLineRunRequestError("SPORT_NOT_FOUND", "The selected TLine sport is unavailable.");
        }
        if (sport.championships.length === 0) {
          throw new TLineRunRequestError(
            "NO_ACTIVE_CHAMPIONSHIPS",
            "The selected sport has no active championships.",
          );
        }

        const run = await transaction.tLineRun.create({
          data: {
            sportConfigId: sport.id,
            trigger: input.trigger,
            status: "QUEUED",
            periodFrom: input.from,
            periodTo: input.to,
            progressTotal: sport.championships.length,
            unprocessedCount: sport.championships.length,
            runChampionships: {
              create: sport.championships.map(({ id }) => ({
                championshipId: id,
                reasonCodes: [],
              })),
            },
          },
          select: runSelection,
        });

        await transaction.tLineJob.create({
          data: {
            sportConfigId: sport.id,
            runId: run.id,
            type: "RUN_CHECK",
            status: "QUEUED",
            idempotencyKey: `tline:run:${run.id}`,
            payload: {
              runId: run.id,
              periodFrom: input.from.toISOString(),
              periodTo: input.to.toISOString(),
            },
          },
        });
        return run;
      });
    } catch (error) {
      if (isActiveRunConstraintViolation(error)) {
        throw new TLineRunAlreadyActiveError();
      }
      throw error;
    }
  }
}
