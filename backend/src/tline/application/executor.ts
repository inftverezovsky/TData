import { Prisma, type PrismaClient, type TLineAutomaticStatus, type TLineSeverity } from "@prisma/client";

import { normalizeFuzzyName } from "../../teams/fuzzyMatch";
import type { AdminLineAdapter } from "../admin";
import { compareTLineMatches } from "../comparison/engine";
import type { AdminLineMatch, OfficialSourceMatch } from "../domain/types";
import type { OfficialSourceRegistry } from "../sources/registry";

export interface TLineExecutorDependencies {
  officialSources: OfficialSourceRegistry;
  admin: AdminLineAdapter | null;
  signal?: AbortSignal;
  verifyLease?: (transaction: Prisma.TransactionClient) => Promise<void>;
}

export async function executeTLineRun(
  client: PrismaClient,
  runId: string,
  dependencies: TLineExecutorDependencies,
) {
  assertExecutionActive(dependencies.signal);
  const run = await client.tLineRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      sportConfig: true,
      runChampionships: {
        orderBy: { createdAt: "asc" },
        include: { championship: { include: { globalHeader: true } } },
      },
    },
  });
  assertExecutionActive(dependencies.signal);
  const startedAt = new Date();
  await client.tLineRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? startedAt },
  });

  let cancelled = false;
  for (const runChampionship of run.runChampionships) {
    assertExecutionActive(dependencies.signal);
    if (runChampionship.status === "SUCCEEDED" || runChampionship.status === "PARTIAL") {
      await refreshRunProgress(client, run.id);
      continue;
    }
    const cancellation = await client.tLineRun.findUnique({
      where: { id: run.id },
      select: { cancelRequestedAt: true },
    });
    if (cancellation?.cancelRequestedAt) {
      cancelled = true;
      break;
    }

    try {
      await executeChampionship(client, run, runChampionship, dependencies);
    } catch (error) {
      if (dependencies.signal?.aborted) throw abortReason(dependencies.signal);
      await client.tLineRunChampionship.update({
        where: { id: runChampionship.id },
        data: {
          status: "FAILED",
          automaticStatus: "PARSER_FAILED",
          effectiveStatus: "PARSER_FAILED",
          severity: "ERROR",
          effectiveSeverity: "ERROR",
          reasonCodes: ["PARSER_FAILED"],
          completedAt: new Date(),
          errorCode: safeErrorCode(error),
          errorMessage: "Fresh TLine championship processing failed.",
        },
      });
      await logStage(client, {
        runId: run.id,
        championshipId: runChampionship.championshipId,
        source: "tline-pipeline",
        startedAt,
        error,
      });
    }
    await refreshRunProgress(client, run.id);
  }

  assertExecutionActive(dependencies.signal);
  if (cancelled) {
    await client.tLineRunChampionship.updateMany({
      where: { runId: run.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "CANCELLED",
        automaticStatus: "CANCELLED",
        effectiveStatus: "CANCELLED",
        severity: "UNPROCESSED",
        effectiveSeverity: "UNPROCESSED",
        reasonCodes: ["CANCELLED"],
        completedAt: new Date(),
      },
    });
  }
  const finalStatus = cancelled ? "CANCELLED" : await resolveRunFinalStatus(client, run.id);
  await refreshRunProgress(client, run.id);
  assertExecutionActive(dependencies.signal);
  return client.tLineRun.update({
    where: { id: run.id },
    data: { status: finalStatus, completedAt: new Date() },
  });
}

async function executeChampionship(
  client: PrismaClient,
  run: Awaited<ReturnType<typeof loadRunShape>>,
  runChampionship: Awaited<ReturnType<typeof loadRunShape>>["runChampionships"][number],
  dependencies: TLineExecutorDependencies,
) {
  const startedAt = new Date();
  const championship = runChampionship.championship;
  await client.tLineRunChampionship.update({
    where: { id: runChampionship.id },
    data: {
      status: "RUNNING",
      automaticStatus: "PROCESSING",
      effectiveStatus: "PROCESSING",
      startedAt,
    },
  });
  const officialAdapter = dependencies.officialSources.get(championship.sourceProvider);
  const official = await officialAdapter.fetchChampionship({
    championship: {
      id: championship.id,
      externalId: championship.sourceChampionshipId || championship.id,
      name: championship.name,
      sourceUrl: championship.sourceUrl,
      sourceTimezone: championship.sourceTimezone,
    },
    from: run.periodFrom,
    to: run.periodTo,
    forceFresh: true,
    signal: dependencies.signal,
  });
  assertExecutionActive(dependencies.signal);
  await syncSourceTeams(client, championship.id, official.teams, dependencies.verifyLease);
  assertExecutionActive(dependencies.signal);

  const storedTeams = await client.tLineSourceTeam.findMany({
    where: { championshipId: championship.id },
    include: { mapping: { include: { adminTeam: { select: { platformId: true } } } } },
  });
  const adminIdBySourceExternalId = new Map(storedTeams.flatMap((team) => {
    const externalId = team.externalId;
    const adminId = team.mapping
      && ["AUTO_MAPPED", "MANUAL_MAPPED"].includes(team.mapping.status)
      ? team.mapping.adminTeam.platformId
      : null;
    return externalId && adminId ? [[externalId, adminId] as const] : [];
  }));
  const sourceMatches: OfficialSourceMatch[] = official.matches.map((match) => ({
    ...match,
    home: { ...match.home, adminTeamId: adminIdBySourceExternalId.get(match.home.sourceTeamId) ?? null },
    away: { ...match.away, adminTeamId: adminIdBySourceExternalId.get(match.away.sourceTeamId) ?? null },
  }));

  const tolerance = championship.allowedTimeDriftMinutes
    ?? run.sportConfig.defaultAllowedTimeDriftMinutes;
  const candidateWindow = championship.candidateMatchWindowMinutes
    ?? run.sportConfig.candidateMatchWindowMinutes;
  const admin = dependencies.admin;
  const adminSportId = run.sportConfig.adminSportId;
  const adminShapkaId = championship.globalHeader?.active
    ? championship.globalHeader.adminShapkaId
    : null;
  const adminChampionshipId = championship.adminChampionshipId;
  if (!admin || !adminSportId || !adminShapkaId || !adminChampionshipId || tolerance === null || candidateWindow === null) {
    const sourceOnlyReason = !admin
      ? "ADMIN_LINE_NOT_CONFIGURED"
      : !adminSportId || !adminShapkaId || !adminChampionshipId
        ? "ADMIN_IDENTIFIERS_NOT_CONFIGURED"
        : "ADMIN_COMPARISON_NOT_CONFIGURED";
    assertExecutionActive(dependencies.signal);
    await persistSourceOnlyEvidence(
      client,
      runChampionship.id,
      sourceMatches,
      sourceOnlyReason,
      dependencies.verifyLease,
    );
    await logStage(client, {
      runId: run.id,
      championshipId: championship.id,
      source: championship.sourceProvider,
      startedAt,
      matchesCount: official.matches.length,
    });
    return "PARTIAL" as const;
  }
  const adminSnapshots = await admin.fetchMatches({
    scope: {
      sportId: adminSportId,
      shapkaId: adminShapkaId,
      championshipId: adminChampionshipId,
    },
    from: run.periodFrom,
    to: run.periodTo,
    signal: dependencies.signal,
  });
  assertExecutionActive(dependencies.signal);
  const adminMatches: AdminLineMatch[] = adminSnapshots.flatMap((snapshot) => snapshot.matches.map((match) => ({
    id: match.id,
    championshipId: championship.id,
    externalId: match.id,
    home: { adminTeamId: match.team1Id, name: match.team1Name },
    away: { adminTeamId: match.team2Id, name: match.team2Name },
    startTimeUtc: match.startsAtUtc,
    status: normalizeAdminStatus(match.status),
  })));
  const persistentLinks = await client.tLinePersistentMatchLink.findMany({
    where: { championshipId: championship.id, active: true },
    select: { sourceMatchKey: true, adminMatchId: true },
  });
  const results = compareTLineMatches({
    sourceMatches,
    adminMatches,
    allowedTimeDriftMinutes: tolerance,
    candidateMatchWindowMinutes: candidateWindow,
    persistentLinks: persistentLinks.map((link) => ({
      sourceMatchId: link.sourceMatchKey,
      adminMatchId: link.adminMatchId,
    })),
  });
  const activeExceptions = await client.tLineException.findMany({
    where: {
      championshipId: championship.id,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });

  assertExecutionActive(dependencies.signal);
  await client.$transaction(async (transaction) => {
    if (dependencies.verifyLease) await dependencies.verifyLease(transaction);
    const sourceRows = await persistSourceSnapshots(transaction, runChampionship.id, sourceMatches);
    const adminRows = await persistAdminSnapshots(transaction, runChampionship.id, adminMatches);
    const sourceQueues = groupSnapshotIds(sourceRows);
    const adminQueues = groupSnapshotIds(adminRows);
    for (const result of results) {
      const automaticStatus = result.automaticStatus as TLineAutomaticStatus;
      const severity = severityForStatus(automaticStatus);
      const exception = activeExceptions.find((candidate) =>
        (result.sourceMatchId !== null && candidate.sourceMatchKey === result.sourceMatchId)
        || (result.adminMatchId !== null && candidate.adminMatchId === result.adminMatchId),
      );
      const comparison = await transaction.tLineComparison.create({
        data: {
          runChampionshipId: runChampionship.id,
          sourceSnapshotId: shiftSnapshotId(sourceQueues, result.sourceMatchId),
          adminSnapshotId: shiftSnapshotId(adminQueues, result.adminMatchId),
          pairKey: pairKeyForResult(result, sourceMatches, adminMatches),
          automaticStatus,
          manualStatus: exception ? "IGNORED" : result.manualLinked ? automaticStatus : null,
          effectiveStatus: exception ? "IGNORED" : automaticStatus,
          severity,
          effectiveSeverity: exception ? "UNPROCESSED" : severity,
          reasonCodes: [...result.reasons],
          swappedSides: result.swappedSides,
          timeDeltaMinutes: result.timeDeltaMinutes,
        },
      });
      if (result.manualLinked && !exception) {
        await transaction.tLineManualDecision.create({
          data: {
            comparisonId: comparison.id,
            decisionType: "MANUAL_LINK",
            effectiveStatus: automaticStatus,
            persistent: true,
          },
        });
      } else if (exception) {
        await transaction.tLineManualDecision.create({
          data: {
            comparisonId: comparison.id,
            decisionType: exception.type,
            effectiveStatus: "IGNORED",
            persistent: true,
            actorId: exception.createdBy,
            note: exception.reason,
            expiresAt: exception.expiresAt,
          },
        });
      }
    }
    const aggregate = aggregateChampionship(results.map((result) => result.automaticStatus));
    await transaction.tLineRunChampionship.update({
      where: { id: runChampionship.id },
      data: {
        status: "SUCCEEDED",
        automaticStatus: aggregate.status,
        effectiveStatus: aggregate.status,
        severity: aggregate.severity,
        effectiveSeverity: aggregate.severity,
        reasonCodes: [...new Set(results.flatMap((result) => result.reasons))],
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
  });
  await logStage(client, {
    runId: run.id,
    championshipId: championship.id,
    source: championship.sourceProvider,
    startedAt,
    matchesCount: official.matches.length,
  });
  return "SUCCEEDED" as const;
}

async function loadRunShape(client: PrismaClient, runId: string) {
  return client.tLineRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      sportConfig: true,
      runChampionships: { include: { championship: { include: { globalHeader: true } } } },
    },
  });
}

async function syncSourceTeams(
  client: PrismaClient,
  championshipId: string,
  teams: readonly { id: string; externalId: string | null; nameRu: string | null; nameEn: string | null }[],
  verifyLease?: (transaction: Prisma.TransactionClient) => Promise<void>,
) {
  const now = new Date();
  await client.$transaction(async (transaction) => {
    if (verifyLease) await verifyLease(transaction);
    for (const team of teams) {
      const externalId = team.externalId?.trim() || null;
      const name = team.nameRu || team.nameEn || externalId || team.id;
      const normalizedName = normalizeFuzzyName(name);
      const existing = await transaction.tLineSourceTeam.findFirst({
        where: externalId
          ? { championshipId, externalId }
          : { championshipId, externalId: null, normalizedName },
        select: { id: true },
      });
      if (existing) {
        await transaction.tLineSourceTeam.update({
          where: { id: existing.id },
          data: { externalId, name, normalizedName, lastSeenAt: now },
        });
      } else {
        await transaction.tLineSourceTeam.create({
          data: { championshipId, externalId, name, normalizedName, firstSeenAt: now, lastSeenAt: now },
        });
      }
    }
  });
}

async function persistSourceSnapshots(
  transaction: Prisma.TransactionClient,
  runChampionshipId: string,
  matches: readonly OfficialSourceMatch[],
) {
  const occurrences = new Map<string, number>();
  const rows: Array<{ key: string; id: string }> = [];
  for (const match of matches) {
    const occurrenceIndex = occurrences.get(match.id) ?? 0;
    occurrences.set(match.id, occurrenceIndex + 1);
    const created = await transaction.tLineSourceMatchSnapshot.create({
      data: {
        runChampionshipId,
        sourceKey: match.id,
        occurrenceIndex,
        externalMatchId: match.externalId,
        sourceUrl: match.sourceUrl,
        homeExternalTeamId: match.home.sourceTeamId,
        awayExternalTeamId: match.away.sourceTeamId,
        homeTeamName: match.home.name,
        awayTeamName: match.away.name,
        originalTimeText: match.startTimeRaw,
        sourceTimezone: match.sourceTimezone,
        scheduledAtUtc: match.startTimeUtc ? new Date(match.startTimeUtc) : null,
        sourceStatus: match.status,
        rawPayload: match as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    rows.push({ key: match.id, id: created.id });
  }
  return rows;
}

async function persistSourceOnlyEvidence(
  client: PrismaClient,
  runChampionshipId: string,
  matches: readonly OfficialSourceMatch[],
  reasonCode: string,
  verifyLease?: (transaction: Prisma.TransactionClient) => Promise<void>,
) {
  await client.$transaction(async (transaction) => {
    if (verifyLease) await verifyLease(transaction);
    const sourceRows = await persistSourceSnapshots(transaction, runChampionshipId, matches);
    const statuses: TLineAutomaticStatus[] = [];
    for (const [index, sourceRow] of sourceRows.entries()) {
      const automaticStatus: TLineAutomaticStatus = matches[index]?.startTimeUtc == null
        ? "SOURCE_TIME_UNDEFINED"
        : "SOURCE_ONLY";
      const reasonCodes = automaticStatus === "SOURCE_TIME_UNDEFINED"
        ? [reasonCode, "SOURCE_TIME_UNDEFINED"]
        : [reasonCode];
      statuses.push(automaticStatus);
      await transaction.tLineComparison.create({
        data: {
          runChampionshipId,
          sourceSnapshotId: sourceRow.id,
          adminSnapshotId: null,
          pairKey: null,
          automaticStatus,
          manualStatus: null,
          effectiveStatus: automaticStatus,
          severity: severityForStatus(automaticStatus),
          effectiveSeverity: severityForStatus(automaticStatus),
          reasonCodes,
          swappedSides: false,
          timeDeltaMinutes: null,
        },
      });
    }
    const noMatchesInPeriod = statuses.length === 0;
    const aggregate = noMatchesInPeriod
      ? { status: "PENDING" as const, severity: "WARNING" as const }
      : aggregateChampionship(statuses);
    await transaction.tLineRunChampionship.update({
      where: { id: runChampionshipId },
      data: {
        status: "PARTIAL",
        automaticStatus: aggregate.status,
        manualStatus: null,
        effectiveStatus: aggregate.status,
        severity: aggregate.severity,
        effectiveSeverity: aggregate.severity,
        reasonCodes: noMatchesInPeriod
          ? [reasonCode, "NO_MATCHES_IN_PERIOD"]
          : [reasonCode],
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
  });
}

async function resolveRunFinalStatus(client: PrismaClient, runId: string) {
  const championships = await client.tLineRunChampionship.findMany({
    where: { runId },
    select: { status: true },
  });
  if (championships.length === 0) return "SUCCEEDED" as const;
  if (championships.every((item) => item.status === "FAILED")) return "FAILED" as const;
  if (championships.every((item) => item.status === "CANCELLED")) return "CANCELLED" as const;
  if (championships.some((item) => item.status === "FAILED" || item.status === "PARTIAL")) return "PARTIAL" as const;
  return "SUCCEEDED" as const;
}

async function persistAdminSnapshots(
  transaction: Prisma.TransactionClient,
  runChampionshipId: string,
  matches: readonly AdminLineMatch[],
) {
  const occurrences = new Map<string, number>();
  const rows: Array<{ key: string; id: string }> = [];
  for (const match of matches) {
    const occurrenceIndex = occurrences.get(match.id) ?? 0;
    occurrences.set(match.id, occurrenceIndex + 1);
    const created = await transaction.tLineAdminMatchSnapshot.create({
      data: {
        runChampionshipId,
        adminMatchId: match.id,
        occurrenceIndex,
        homeAdminTeamPlatformId: match.home.adminTeamId,
        awayAdminTeamPlatformId: match.away.adminTeamId,
        homeTeamName: match.home.name,
        awayTeamName: match.away.name,
        scheduledAtUtc: match.startTimeUtc ? new Date(match.startTimeUtc) : null,
        adminStatus: match.status,
        rawPayload: match as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    rows.push({ key: match.id, id: created.id });
  }
  return rows;
}

function groupSnapshotIds(rows: Array<{ key: string; id: string }>) {
  return rows.reduce<Map<string, string[]>>((map, row) => {
    const next = new Map(map);
    next.set(row.key, [...(next.get(row.key) ?? []), row.id]);
    return next;
  }, new Map());
}

function shiftSnapshotId(queues: Map<string, string[]>, key: string | null) {
  if (!key) return null;
  const queue = queues.get(key);
  return queue?.shift() ?? null;
}

function pairKeyForResult(
  result: { sourceMatchId: string | null; adminMatchId: string | null },
  sources: readonly OfficialSourceMatch[],
  admins: readonly AdminLineMatch[],
) {
  const source = result.sourceMatchId ? sources.find((match) => match.id === result.sourceMatchId) : null;
  const admin = result.adminMatchId ? admins.find((match) => match.id === result.adminMatchId) : null;
  const ids = source?.home.adminTeamId && source.away.adminTeamId
    ? [source.home.adminTeamId, source.away.adminTeamId]
    : admin ? [admin.home.adminTeamId, admin.away.adminTeamId] : [];
  return ids.length === 2 ? [...ids].sort().join("::") : null;
}

function aggregateChampionship(statuses: readonly TLineAutomaticStatus[]) {
  if (statuses.length === 0) return { status: "AUTO_OK" as const, severity: "OK" as const };
  const ordered = [...statuses].sort((left, right) => severityRank(severityForStatus(right)) - severityRank(severityForStatus(left)));
  const status = ordered[0];
  return { status, severity: severityForStatus(status) };
}

function severityForStatus(status: TLineAutomaticStatus): TLineSeverity {
  if (status === "AUTO_OK") return "OK";
  if (status === "TIME_WARNING" || status === "SOURCE_TIME_UNDEFINED") return "WARNING";
  if (status === "TIME_CRITICAL") return "CRITICAL";
  if (status === "PENDING" || status === "PROCESSING" || status === "CANCELLED") return "UNPROCESSED";
  return "ERROR";
}

function severityRank(severity: TLineSeverity) {
  return { UNPROCESSED: 0, OK: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 }[severity];
}

function normalizeAdminStatus(value: string): AdminLineMatch["status"] {
  const normalized = value.trim().toUpperCase();
  return ["SCHEDULED", "TBD", "POSTPONED", "CANCELLED", "FINISHED", "UNKNOWN"].includes(normalized)
    ? normalized as AdminLineMatch["status"]
    : "UNKNOWN";
}

async function refreshRunProgress(client: PrismaClient, runId: string) {
  const championships = await client.tLineRunChampionship.findMany({
    where: { runId },
    select: { status: true, effectiveSeverity: true },
  });
  const completed = championships.filter((item) => !["QUEUED", "RUNNING"].includes(item.status));
  const count = (severity: TLineSeverity) => championships.filter((item) => item.effectiveSeverity === severity).length;
  await client.tLineRun.update({
    where: { id: runId },
    data: {
      progressTotal: championships.length,
      progressProcessed: completed.length,
      okCount: count("OK"),
      warningCount: count("WARNING"),
      errorCount: count("ERROR"),
      criticalCount: count("CRITICAL"),
      unprocessedCount: count("UNPROCESSED"),
    },
  });
}

async function logStage(
  client: PrismaClient,
  input: {
    runId: string;
    championshipId: string;
    source: string;
    startedAt: Date;
    matchesCount?: number;
    error?: unknown;
  },
) {
  await client.parserRequestLog.create({
    data: {
      source: input.source,
      mode: "fresh",
      route: "run-championship",
      tlineRunId: input.runId,
      tlineChampionshipId: input.championshipId,
      durationMs: Date.now() - input.startedAt.getTime(),
      statusCode: input.error ? null : 200,
      matchesCount: input.matchesCount,
      errorClass: input.error instanceof Error ? input.error.name.slice(0, 128) : input.error ? "UnknownError" : null,
    },
  }).catch(() => undefined);
}

function safeErrorCode(error: unknown) {
  return error instanceof Error ? error.name.slice(0, 128) : "UnknownError";
}

function assertExecutionActive(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("TLine execution was aborted.");
}
