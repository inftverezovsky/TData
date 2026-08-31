import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { mergeTournamentParticipantManualFields } from "@backend/sources/participantPreservation";

const DLTV_CANONICAL_ORIGIN = "https://ru.dltv.org";
const DLTV_HOSTS = new Set(["dltv.org", "www.dltv.org", "ru.dltv.org"]);
const DLTV_STATUSES = new Set(["finished", "upcoming", "ongoing"]);

export type DltvRepairCandidate = {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  status: string | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  extractionStatus?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  matchCount: number;
  participantCount: number;
  uploadLogCount: number;
  hasAdminMapping: boolean;
  platformId: string | null;
  adminMapping: RepairAdminMappingCandidate | null;
};

export type RepairAdminMappingCandidate = {
  id: string;
  tournamentId: string;
  disciplineSlug: string;
  sourceTournamentId: string | null;
  sourceTournamentName: string;
  adminShapkaId: string | null;
  adminShapkaName: string | null;
  updatedAt: Date | string;
};

export type TournamentIdentityMergePlan = {
  platformId: string | null;
  adminMapping: {
    selectedId: string;
    obsoleteIds: string[];
    disciplineSlug: string;
    tournamentId: string;
    sourceTournamentId: string;
    sourceTournamentName: string;
    adminShapkaId: string | null;
    adminShapkaName: string | null;
  } | null;
  manualReviewReasons: string[];
};

export type DltvRepairSurvivor = {
  canonicalUrl: string;
  canonicalSourceTitle: string;
  previousSourceUrl: string;
  previousSourceTitle: string;
  primaryId: string;
  secondaryIds: string[];
  startDate: Date | null;
  endDate: Date | null;
  previousStatus: string | null;
  nextStatus: "finished" | "upcoming" | "ongoing" | null;
  platformId: string | null;
  adminMapping: TournamentIdentityMergePlan["adminMapping"];
  manualReviewReasons: string[];
};

export type DltvRepairPlan = {
  candidatesScanned: number;
  skippedIds: string[];
  survivors: DltvRepairSurvivor[];
  duplicateGroups: DltvRepairSurvivor[];
  manualReviewGroups: DltvRepairSurvivor[];
  statusChanges: Array<{
    tournamentId: string;
    canonicalUrl: string;
    previousStatus: string | null;
    nextStatus: "finished" | "upcoming" | "ongoing";
  }>;
};

export type DltvUploadLogCandidate = {
  id: string;
  tournamentId: string;
  disciplineSlug: string;
  payloadHash: string | null;
  status: string;
  createdAt: Date | string;
};

export function canonicalDltvEventUrl(value: string): string | null {
  try {
    const raw = String(value || "").trim();
    const parsed = new URL(raw);
    if (!DLTV_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    if (parsed.username || parsed.password || parsed.port || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return null;

    const pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    if (!/^\/events\/[^/]+(?:\/[^/]+)*$/i.test(pathname)) return null;
    return `${DLTV_CANONICAL_ORIGIN}${pathname}`;
  } catch {
    return null;
  }
}

export function canonicalDltvSourceTitle(canonicalUrl: string): string | null {
  const normalizedUrl = canonicalDltvEventUrl(canonicalUrl);
  if (!normalizedUrl) return null;
  try {
    const pathname = new URL(normalizedUrl).pathname.replace(/^\/events\//i, "");
    const decodedPath = pathname.split("/").map((segment) => decodeURIComponent(segment)).join("/");
    return decodedPath ? `dltv:${decodedPath}` : null;
  } catch {
    return null;
  }
}

export function derivePersistedDltvStatus(
  startValue: Date | string | null | undefined,
  endValue: Date | string | null | undefined,
  nowValue: Date | string = new Date(),
): "finished" | "upcoming" | "ongoing" | null {
  const startDate = validDate(startValue);
  const endDate = validDate(endValue);
  const now = validDate(nowValue);
  if (!now || (!startDate && !endDate)) return null;
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) return null;
  const nowDay = moscowCalendarDay(now);
  if (endDate && moscowCalendarDay(endDate) < nowDay) return "finished";
  if (startDate && moscowCalendarDay(startDate) > nowDay) return "upcoming";
  return "ongoing";
}

export function planTournamentIdentityMerge(input: {
  tournaments: ReadonlyArray<{ id: string; platformId: string | null }>;
  mappings: readonly RepairAdminMappingCandidate[];
  primaryId: string;
  disciplineSlug: string;
  sourceTournamentId: string;
  sourceTournamentName: string;
}): TournamentIdentityMergePlan {
  const platformIds = uniqueNonBlank(input.tournaments.map((row) => row.platformId));
  const adminShapkaIds = uniqueNonBlank(input.mappings.map((mapping) => mapping.adminShapkaId));
  const manualReviewReasons: string[] = [];
  if (platformIds.length > 1) {
    manualReviewReasons.push(`Conflicting Tournament.platformId values: ${platformIds.join(", ")}`);
  }
  if (adminShapkaIds.length > 1) {
    manualReviewReasons.push(
      `Conflicting TournamentAdminMapping.adminShapkaId values: ${adminShapkaIds.join(", ")}`,
    );
  }
  if (manualReviewReasons.length > 0) {
    return { platformId: null, adminMapping: null, manualReviewReasons };
  }

  const orderedMappings = [...input.mappings].sort((left, right) => (
    mappingCompleteness(right) - mappingCompleteness(left)
    || Number(right.tournamentId === input.primaryId) - Number(left.tournamentId === input.primaryId)
    || dateEpoch(right.updatedAt) - dateEpoch(left.updatedAt)
    || compareText(left.id, right.id)
  ));
  const selected = orderedMappings[0];
  const adminShapkaName = orderedMappings
    .map((mapping) => cleanIdentifier(mapping.adminShapkaName))
    .find(Boolean) ?? null;

  return {
    platformId: platformIds[0] ?? null,
    adminMapping: selected
      ? {
        selectedId: selected.id,
        obsoleteIds: orderedMappings
          .filter((mapping) => mapping.id !== selected.id)
          .map((mapping) => mapping.id)
          .sort(compareText),
        disciplineSlug: input.disciplineSlug,
        tournamentId: input.primaryId,
        sourceTournamentId: input.sourceTournamentId,
        sourceTournamentName: input.sourceTournamentName,
        adminShapkaId: adminShapkaIds[0] ?? null,
        adminShapkaName,
      }
      : null,
    manualReviewReasons,
  };
}

export function buildDltvRepairPlan(
  candidates: readonly DltvRepairCandidate[],
  now: Date | string = new Date(),
): DltvRepairPlan {
  const skippedIds = candidates
    .filter((candidate) => !canonicalDltvEventUrl(candidate.sourceUrl))
    .map((candidate) => candidate.id)
    .sort(compareText);
  const grouped = new Map<string, DltvRepairCandidate[]>();

  for (const candidate of candidates) {
    const canonicalUrl = canonicalDltvEventUrl(candidate.sourceUrl);
    if (!canonicalUrl) continue;
    grouped.set(canonicalUrl, [...(grouped.get(canonicalUrl) ?? []), candidate]);
  }

  const survivors: DltvRepairSurvivor[] = Array.from(grouped.entries())
    .sort(([left], [right]) => compareText(left, right))
    .map(([canonicalUrl, group]): DltvRepairSurvivor => {
      const ordered = [...group].sort(compareRepairCandidates);
      const primary = ordered[0];
      const canonicalSourceTitle = canonicalDltvSourceTitle(canonicalUrl);
      if (!canonicalSourceTitle) throw new Error(`Unable to build canonical DLTV source title for ${canonicalUrl}`);
      const { startDate, endDate, manualReviewReason: dateRangeManualReviewReason } = selectPersistedDateRange(ordered);
      const nextStatus = derivePersistedDltvStatus(startDate, endDate, now);
      const identityPlan = planTournamentIdentityMerge({
        tournaments: ordered.map((candidate) => ({ id: candidate.id, platformId: candidate.platformId })),
        mappings: ordered
          .map((candidate) => candidate.adminMapping)
          .filter((mapping): mapping is RepairAdminMappingCandidate => Boolean(mapping)),
        primaryId: primary.id,
        disciplineSlug: "dota2",
        sourceTournamentId: canonicalUrl,
        sourceTournamentName: canonicalSourceTitle,
      });
      return {
        canonicalUrl,
        canonicalSourceTitle,
        previousSourceUrl: primary.sourceUrl,
        previousSourceTitle: primary.sourceTitle,
        primaryId: primary.id,
        secondaryIds: ordered.slice(1).map((candidate) => candidate.id).sort(compareText),
        startDate,
        endDate,
        previousStatus: primary.status,
        nextStatus,
        platformId: identityPlan.platformId,
        adminMapping: identityPlan.adminMapping,
        manualReviewReasons: [
          ...identityPlan.manualReviewReasons,
          ...(dateRangeManualReviewReason ? [dateRangeManualReviewReason] : []),
        ],
      };
    });

  return {
    candidatesScanned: candidates.length,
    skippedIds,
    survivors,
    duplicateGroups: survivors.filter((survivor) => survivor.secondaryIds.length > 0),
    manualReviewGroups: survivors.filter((survivor) => survivor.manualReviewReasons.length > 0),
    statusChanges: survivors
      .filter((survivor): survivor is DltvRepairSurvivor & { nextStatus: "finished" | "upcoming" | "ongoing" } => (
        survivor.manualReviewReasons.length === 0
        && survivor.nextStatus !== null
        && survivor.previousStatus !== survivor.nextStatus
      ))
      .map((survivor) => ({
        tournamentId: survivor.primaryId,
        canonicalUrl: survivor.canonicalUrl,
        previousStatus: survivor.previousStatus,
        nextStatus: survivor.nextStatus,
      })),
  };
}

export function planDltvUploadLogTransfer(
  logs: readonly DltvUploadLogCandidate[],
  primaryId: string,
): { deleteIds: string[]; moveIds: string[]; keepIds: string[] } {
  const grouped = new Map<string, DltvUploadLogCandidate[]>();
  for (const log of logs) {
    const key = log.payloadHash === null
      ? `no-hash:${log.id}`
      : `hash:${log.disciplineSlug}\u0000${log.payloadHash}`;
    grouped.set(key, [...(grouped.get(key) ?? []), log]);
  }

  const keepers = Array.from(grouped.values()).map((group) => [...group].sort(compareUploadLogs)[0]);
  const keepIds = keepers.map((log) => log.id).sort(compareText);
  const keepIdSet = new Set(keepIds);
  return {
    deleteIds: logs.filter((log) => !keepIdSet.has(log.id)).map((log) => log.id).sort(compareText),
    moveIds: keepers.filter((log) => log.tournamentId !== primaryId).map((log) => log.id).sort(compareText),
    keepIds,
  };
}

export function parseDltvRepairArguments(values: readonly string[]) {
  const allowed = new Set(["--apply", "--backup-confirmed"]);
  const flags = new Set<string>();
  for (const value of values) {
    if (!allowed.has(value)) throw new Error(`Unknown argument: ${value}`);
    flags.add(value);
  }

  const applyFlag = flags.has("--apply");
  const backupFlag = flags.has("--backup-confirmed");
  if (applyFlag !== backupFlag) {
    throw new Error("Mutation requires both --apply and --backup-confirmed");
  }
  return { apply: applyFlag && backupFlag, backupConfirmed: backupFlag };
}

type RepairDb = Pick<
  Prisma.TransactionClient,
  "tournament" | "tournamentAdminMapping" | "adminUploadLog"
>;

async function loadDltvRepairPlan(db: RepairDb, now: Date) {
  const rows = await db.tournament.findMany({
    where: { disciplineSlug: "dota2" },
    select: {
      id: true,
      sourceUrl: true,
      sourceTitle: true,
      status: true,
      startDate: true,
      endDate: true,
      platformId: true,
      extractionStatus: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { matches: true, participants: true } },
    },
  });
  const relevantRows = rows.filter((row) => canonicalDltvEventUrl(row.sourceUrl));
  const ids = relevantRows.map((row) => row.id);
  if (ids.length === 0) return buildDltvRepairPlan([], now);

  const [mappings, logs] = await Promise.all([
    db.tournamentAdminMapping.findMany({
      where: { tournamentId: { in: ids } },
      select: {
        id: true,
        tournamentId: true,
        disciplineSlug: true,
        sourceTournamentId: true,
        sourceTournamentName: true,
        adminShapkaId: true,
        adminShapkaName: true,
        updatedAt: true,
      },
    }),
    db.adminUploadLog.findMany({
      where: { tournamentId: { in: ids } },
      select: { tournamentId: true },
    }),
  ]);
  const mappedIds = new Set(mappings.map((mapping) => mapping.tournamentId));
  const mappingByTournamentId = new Map(mappings.map((mapping) => [mapping.tournamentId, mapping]));
  const uploadCounts = logs.reduce((counts, log) => (
    new Map(counts).set(log.tournamentId, (counts.get(log.tournamentId) ?? 0) + 1)
  ), new Map<string, number>());

  return buildDltvRepairPlan(relevantRows.map((row) => ({
    id: row.id,
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    platformId: row.platformId,
    adminMapping: mappingByTournamentId.get(row.id) ?? null,
    extractionStatus: row.extractionStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    matchCount: row._count.matches,
    participantCount: row._count.participants,
    uploadLogCount: uploadCounts.get(row.id) ?? 0,
    hasAdminMapping: mappedIds.has(row.id),
  })), now);
}

async function applyDltvRepair(now: Date) {
  return prisma.$transaction(async (tx) => {
    const plan = await loadDltvRepairPlan(tx, now);
    const counters = {
      duplicateGroupsMerged: 0,
      tournamentsDeleted: 0,
      matchesMoved: 0,
      participantsMoved: 0,
      participantsDeduplicated: 0,
      uploadLogsMoved: 0,
      uploadLogsDeduplicated: 0,
      adminMappingsMoved: 0,
      statusesUpdated: 0,
      manualReviewGroups: 0,
    };

    for (const group of plan.manualReviewGroups) {
      await tx.tournament.updateMany({
        where: { id: { in: [group.primaryId, ...group.secondaryIds] } },
        data: { extractionStatus: "MANUAL_REVIEW" },
      });
      counters.manualReviewGroups += 1;
    }

    for (const group of plan.duplicateGroups.filter((candidate) => candidate.manualReviewReasons.length === 0)) {
      const groupIds = [group.primaryId, ...group.secondaryIds];
      const [tournaments, participants, mappings, uploadLogs] = await Promise.all([
        tx.tournament.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, platformId: true },
        }),
        tx.tournamentParticipant.findMany({
          where: { tournamentId: { in: groupIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        tx.tournamentAdminMapping.findMany({
          where: { tournamentId: { in: groupIds } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        }),
        tx.adminUploadLog.findMany({
          where: { tournamentId: { in: groupIds } },
          select: {
            id: true,
            tournamentId: true,
            disciplineSlug: true,
            payloadHash: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

      const identityPlan = planTournamentIdentityMerge({
        tournaments,
        mappings,
        primaryId: group.primaryId,
        disciplineSlug: "dota2",
        sourceTournamentId: group.canonicalUrl,
        sourceTournamentName: group.canonicalSourceTitle,
      });
      if (identityPlan.manualReviewReasons.length > 0) {
        throw new Error(`DLTV identity changed during repair: ${identityPlan.manualReviewReasons.join("; ")}`);
      }

      const participantPlan = planDltvParticipantTransfer(participants, group.primaryId);
      for (const update of participantPlan.updates) {
        await tx.tournamentParticipant.update({
          where: { id: update.id },
          data: update.data,
        });
      }
      if (participantPlan.deleteIds.length > 0) {
        await tx.tournamentParticipant.deleteMany({ where: { id: { in: participantPlan.deleteIds } } });
      }
      if (participantPlan.moveIds.length > 0) {
        const result = await tx.tournamentParticipant.updateMany({
          where: { id: { in: participantPlan.moveIds } },
          data: { tournamentId: group.primaryId },
        });
        counters.participantsMoved += result.count;
      }
      counters.participantsDeduplicated += participantPlan.deleteIds.length;

      const uploadPlan = planDltvUploadLogTransfer(uploadLogs, group.primaryId);
      if (uploadPlan.deleteIds.length > 0) {
        await tx.adminUploadLog.deleteMany({ where: { id: { in: uploadPlan.deleteIds } } });
      }
      if (uploadPlan.moveIds.length > 0) {
        const result = await tx.adminUploadLog.updateMany({
          where: { id: { in: uploadPlan.moveIds } },
          data: { tournamentId: group.primaryId },
        });
        counters.uploadLogsMoved += result.count;
      }
      counters.uploadLogsDeduplicated += uploadPlan.deleteIds.length;

      if (identityPlan.adminMapping) {
        if (identityPlan.adminMapping.obsoleteIds.length > 0) {
          await tx.tournamentAdminMapping.deleteMany({
            where: { id: { in: identityPlan.adminMapping.obsoleteIds } },
          });
        }
        await tx.tournamentAdminMapping.update({
          where: { id: identityPlan.adminMapping.selectedId },
          data: {
            tournamentId: identityPlan.adminMapping.tournamentId,
            disciplineSlug: identityPlan.adminMapping.disciplineSlug,
            sourceTournamentId: identityPlan.adminMapping.sourceTournamentId,
            sourceTournamentName: identityPlan.adminMapping.sourceTournamentName,
            adminShapkaId: identityPlan.adminMapping.adminShapkaId,
            adminShapkaName: identityPlan.adminMapping.adminShapkaName,
          },
        });
        const selectedBefore = mappings.find((mapping) => mapping.id === identityPlan.adminMapping?.selectedId);
        counters.adminMappingsMoved += selectedBefore?.tournamentId === group.primaryId ? 0 : 1;
      }

      const movedMatches = await tx.tournamentMatch.updateMany({
        where: { tournamentId: { in: group.secondaryIds } },
        data: { tournamentId: group.primaryId },
      });
      counters.matchesMoved += movedMatches.count;

      const deleted = await tx.tournament.deleteMany({ where: { id: { in: group.secondaryIds } } });
      counters.tournamentsDeleted += deleted.count;
      counters.duplicateGroupsMerged += 1;
    }

    const safeSurvivors = plan.survivors.filter((survivor) => survivor.manualReviewReasons.length === 0);
    for (const survivor of safeSurvivors) {
      await tx.tournament.update({
        where: { id: survivor.primaryId },
        data: { sourceTitle: `__dltv_identity_repair__:${survivor.primaryId}` },
      });
    }

    for (const survivor of safeSurvivors) {
      const nextStatus = survivor.nextStatus;
      await tx.tournament.update({
        where: { id: survivor.primaryId },
        data: {
          sourceTitle: survivor.canonicalSourceTitle,
          sourceUrl: survivor.canonicalUrl,
          platformId: survivor.platformId,
          ...(survivor.startDate ? { startDate: survivor.startDate } : {}),
          ...(survivor.endDate ? { endDate: survivor.endDate } : {}),
          ...(nextStatus && DLTV_STATUSES.has(nextStatus) ? { status: nextStatus } : {}),
        },
      });
      if (nextStatus && survivor.previousStatus !== nextStatus) counters.statusesUpdated += 1;
    }

    return { plan, counters };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 120_000,
  });
}

async function main() {
  const arguments_ = parseDltvRepairArguments(process.argv.slice(2));
  const now = new Date();

  if (!arguments_.apply) {
    const plan = await loadDltvRepairPlan(prisma, now);
    console.log(JSON.stringify({ mode: "dry-run", generatedAt: now.toISOString(), ...plan }, null, 2));
    console.log("Dry-run complete. Re-run with --apply --backup-confirmed after a verified database backup.");
    return;
  }

  const result = await applyDltvRepair(now);
  console.log(JSON.stringify({
    mode: "apply",
    generatedAt: now.toISOString(),
    duplicateGroups: result.plan.duplicateGroups.map((group) => ({
      canonicalUrl: group.canonicalUrl,
      canonicalSourceTitle: group.canonicalSourceTitle,
      primaryId: group.primaryId,
      secondaryIds: group.secondaryIds,
    })),
    manualReviewGroups: result.plan.manualReviewGroups.map((group) => ({
      canonicalUrl: group.canonicalUrl,
      tournamentIds: [group.primaryId, ...group.secondaryIds],
      reasons: group.manualReviewReasons,
    })),
    counters: result.counters,
  }, null, 2));
}

function compareRepairCandidates(left: DltvRepairCandidate, right: DltvRepairCandidate) {
  const numericComparisons = [
    Number(right.extractionStatus === "SUCCESS") - Number(left.extractionStatus === "SUCCESS"),
    right.matchCount - left.matchCount,
    right.participantCount - left.participantCount,
    Number(right.hasAdminMapping) - Number(left.hasAdminMapping),
    right.uploadLogCount - left.uploadLogCount,
    Number(Boolean(validDate(right.startDate))) - Number(Boolean(validDate(left.startDate))),
    Number(Boolean(validDate(right.endDate))) - Number(Boolean(validDate(left.endDate))),
    dateEpoch(right.updatedAt) - dateEpoch(left.updatedAt),
    dateEpoch(left.createdAt) - dateEpoch(right.createdAt),
  ];
  return numericComparisons.find((comparison) => comparison !== 0) ?? compareText(left.id, right.id);
}

function compareUploadLogs(left: DltvUploadLogCandidate, right: DltvUploadLogCandidate) {
  const statusRank = (status: string) => ({ success: 4, success_like: 3, failed: 2, pending: 1 }[status] ?? 0);
  return statusRank(right.status) - statusRank(left.status)
    || dateEpoch(right.createdAt) - dateEpoch(left.createdAt)
    || compareText(left.id, right.id);
}

function mappingCompleteness(mapping: RepairAdminMappingCandidate) {
  return Number(Boolean(cleanIdentifier(mapping.adminShapkaId))) * 8
    + Number(Boolean(cleanIdentifier(mapping.adminShapkaName))) * 4
    + Number(Boolean(cleanIdentifier(mapping.sourceTournamentId))) * 2
    + Number(Boolean(cleanIdentifier(mapping.sourceTournamentName)));
}

function uniqueNonBlank(values: ReadonlyArray<string | null | undefined>) {
  return Array.from(new Set(values.map(cleanIdentifier).filter((value): value is string => Boolean(value))))
    .sort(compareText);
}

function cleanIdentifier(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function planDltvParticipantTransfer<T extends {
  id: string;
  tournamentId: string;
  name: string;
  platformId: string | null;
  seed: string | null;
  region: string | null;
  status: string | null;
  logoUrl: string | null;
  rawText: string | null;
  createdAt: Date;
}>(participants: readonly T[], primaryId: string) {
  const grouped = new Map<string, T[]>();
  for (const participant of participants) {
    const normalizedName = participant.name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const key = normalizedName || `empty:${participant.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), participant]);
  }
  const selections = Array.from(grouped.values()).map((group) => {
    const preferred = [...group].sort((left, right) => {
    const richness = (participant: T) => [
      participant.platformId,
      participant.seed,
      participant.region,
      participant.status,
      participant.logoUrl,
      participant.rawText,
    ].filter(Boolean).length;
    return richness(right) - richness(left)
      || Number(right.tournamentId === primaryId) - Number(left.tournamentId === primaryId)
      || left.createdAt.getTime() - right.createdAt.getTime()
      || compareText(left.id, right.id);
    })[0];
    const merged = group
      .filter((participant) => participant.id !== preferred.id)
      .reduce(
        (current, participant) => mergeTournamentParticipantManualFields({
          existing: current,
          incoming: participant,
        }),
        mergeTournamentParticipantManualFields({ existing: preferred }),
      );
    return { preferred, merged };
  });
  const preferred = selections.map((selection) => selection.preferred);
  const keepIds = new Set(preferred.map((participant) => participant.id));
  return {
    deleteIds: participants.filter((participant) => !keepIds.has(participant.id)).map((participant) => participant.id),
    moveIds: preferred
      .filter((participant) => participant.tournamentId !== primaryId)
      .map((participant) => participant.id),
    updates: selections.map(({ preferred: participant, merged }) => ({
      id: participant.id,
      data: merged,
    })),
  };
}

function selectPersistedDateRange(candidates: readonly DltvRepairCandidate[]) {
  const startDates = candidates
    .map((candidate) => validDate(candidate.startDate))
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());
  const endDates = candidates
    .map((candidate) => validDate(candidate.endDate))
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime());
  const startDate = startDates[0] ?? null;
  const endDate = endDates[0] ?? null;
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    return {
      startDate,
      endDate,
      manualReviewReason: `DLTV date range end ${endDate.toISOString()} precedes aggregate start ${startDate.toISOString()}`,
    };
  }
  return {
    startDate,
    endDate,
    manualReviewReason: null,
  };
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function dateEpoch(value: Date | string) {
  return validDate(value)?.getTime() ?? 0;
}

function moscowCalendarDay(value: Date) {
  return Math.floor((value.getTime() + 3 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}

if (isDirectExecution()) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      if (process.env.DATABASE_URL) await prisma.$disconnect().catch(() => undefined);
    });
}
