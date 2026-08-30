import { Prisma, type PrismaClient } from "@prisma/client";

const runInclude = {
  runChampionships: {
    orderBy: { createdAt: "asc" },
    include: {
      championship: { select: { id: true, name: true } },
      manualDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
      comparisons: {
        orderBy: { createdAt: "asc" },
        include: {
          sourceSnapshot: true,
          adminSnapshot: true,
          manualDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  },
} satisfies Prisma.TLineRunInclude;

type RunWithResults = Prisma.TLineRunGetPayload<{ include: typeof runInclude }>;

export async function findTLineRunView(client: PrismaClient, runId: string) {
  const run = await client.tLineRun.findUnique({ where: { id: runId }, include: runInclude });
  return run ? mapTLineRunView(run) : null;
}

export async function findActiveTLineRunView(client: PrismaClient, sportId: string) {
  const run = await client.tLineRun.findFirst({
    where: { sportConfigId: sportId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    include: runInclude,
  });
  return run ? mapTLineRunView(run) : null;
}

export async function findLatestTLineRunView(client: PrismaClient, sportId: string) {
  const run = await client.tLineRun.findFirst({
    where: { sportConfigId: sportId },
    orderBy: { createdAt: "desc" },
    include: runInclude,
  });
  return run ? mapTLineRunView(run) : null;
}

export async function listTLineRunHistory(
  client: PrismaClient,
  input: { sportId?: string; limit: number; cursor?: string },
) {
  const runs = await client.tLineRun.findMany({
    where: input.sportId ? { sportConfigId: input.sportId } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      sportConfigId: true,
      trigger: true,
      status: true,
      periodFrom: true,
      periodTo: true,
      progressTotal: true,
      progressProcessed: true,
      okCount: true,
      warningCount: true,
      errorCount: true,
      criticalCount: true,
      unprocessedCount: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      sportConfig: { select: { discipline: { select: { slug: true, name: true } } } },
    },
  });
  const hasMore = runs.length > input.limit;
  const items = hasMore ? runs.slice(0, input.limit) : runs;
  return {
    items: items.map((run) => ({
      id: run.id,
      sportId: run.sportConfigId,
      sportSlug: run.sportConfig.discipline.slug,
      sportName: run.sportConfig.discipline.name,
      trigger: run.trigger,
      state: run.status,
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      progress: percentage(run.progressProcessed, run.progressTotal),
      counts: {
        total: run.progressTotal,
        processed: run.progressProcessed,
        ok: run.okCount,
        warning: run.warningCount,
        error: run.errorCount,
        critical: run.criticalCount,
        unprocessed: run.unprocessedCount,
      },
      startedAt: run.startedAt,
      finishedAt: run.completedAt,
      createdAt: run.createdAt,
    })),
    nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
  };
}

export function mapTLineRunView(run: RunWithResults) {
  return {
    id: run.id,
    sportId: run.sportConfigId,
    state: run.status,
    trigger: run.trigger,
    periodFrom: run.periodFrom,
    periodTo: run.periodTo,
    progress: percentage(run.progressProcessed, run.progressTotal),
    counts: {
      total: run.progressTotal,
      processed: run.progressProcessed,
      ok: run.okCount,
      warning: run.warningCount,
      error: run.errorCount,
      critical: run.criticalCount,
      unprocessed: run.unprocessedCount,
    },
    startedAt: run.startedAt,
    finishedAt: run.completedAt,
    cancelRequestedAt: run.cancelRequestedAt,
    championships: run.runChampionships.map((runChampionship) => {
      const projection = projectTLineManualOverlay({
        automaticStatus: runChampionship.automaticStatus,
        automaticSeverity: runChampionship.severity,
        effectiveStatus: runChampionship.effectiveStatus,
        effectiveSeverity: runChampionship.effectiveSeverity,
        manualStatus: runChampionship.manualStatus,
        latestDecision: runChampionship.manualDecisions[0],
      });
      return {
        id: runChampionship.id,
        championshipId: runChampionship.championship.id,
        name: runChampionship.championship.name,
        state: runChampionship.status,
        status: projection.effectiveStatus,
        automaticStatus: runChampionship.automaticStatus,
        manualStatus: projection.manual ? runChampionship.manualStatus : null,
        manual: projection.manual,
        severity: projection.effectiveSeverity,
        reasons: stringReasons(runChampionship.reasonCodes),
        comparisons: runChampionship.comparisons.map((comparison) => {
          const comparisonProjection = projectTLineManualOverlay({
            automaticStatus: comparison.automaticStatus,
            automaticSeverity: comparison.severity,
            effectiveStatus: comparison.effectiveStatus,
            effectiveSeverity: comparison.effectiveSeverity,
            manualStatus: comparison.manualStatus,
            latestDecision: comparison.manualDecisions[0],
          });
          return {
            id: comparison.id,
            automaticStatus: comparison.automaticStatus,
            effectiveStatus: comparisonProjection.effectiveStatus,
            severity: comparisonProjection.effectiveSeverity,
            manual: comparisonProjection.manual,
            swappedSides: comparison.swappedSides,
            timeDeltaMinutes: comparison.timeDeltaMinutes,
            reasons: stringReasons(comparison.reasonCodes),
            source: comparison.sourceSnapshot ? {
              externalId: comparison.sourceSnapshot.externalMatchId,
              startsAt: comparison.sourceSnapshot.scheduledAtUtc,
              sourceTimeText: comparison.sourceSnapshot.originalTimeText,
              teamHome: comparison.sourceSnapshot.homeTeamName,
              teamAway: comparison.sourceSnapshot.awayTeamName,
              status: comparison.sourceSnapshot.sourceStatus,
              sourceUrl: comparison.sourceSnapshot.sourceUrl,
            } : null,
            admin: comparison.adminSnapshot ? {
              externalId: comparison.adminSnapshot.adminMatchId,
              startsAt: comparison.adminSnapshot.scheduledAtUtc,
              sourceTimeText: comparison.adminSnapshot.originalTimeText,
              teamHome: comparison.adminSnapshot.homeTeamName,
              teamAway: comparison.adminSnapshot.awayTeamName,
              status: comparison.adminSnapshot.adminStatus,
            } : null,
          };
        }),
      };
    }),
  };
}

export function projectTLineManualOverlay(input: {
  automaticStatus: string;
  automaticSeverity: string;
  effectiveStatus: string;
  effectiveSeverity: string;
  manualStatus: string | null;
  latestDecision?: { decisionType: string; expiresAt: Date | null } | null;
  now?: Date;
}) {
  const expired = input.latestDecision?.decisionType === "IGNORE_UNTIL"
    && input.latestDecision.expiresAt !== null
    && input.latestDecision.expiresAt <= (input.now ?? new Date());
  const reset = input.latestDecision?.decisionType === "RESET";
  if (input.manualStatus === null || reset || expired) {
    return {
      effectiveStatus: input.automaticStatus,
      effectiveSeverity: input.automaticSeverity,
      manual: false,
    };
  }
  return {
    effectiveStatus: input.effectiveStatus,
    effectiveSeverity: input.effectiveSeverity,
    manual: true,
  };
}

function percentage(processed: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(processed / total * 100)));
}

function stringReasons(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
