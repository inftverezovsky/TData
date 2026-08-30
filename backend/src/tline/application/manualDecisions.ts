import type { Prisma, PrismaClient, TLineEffectiveStatus, TLineManualDecisionType, TLineSeverity } from "@prisma/client";

import { TLineValidationError } from "../api/validation";

export interface ManualDecisionInput {
  decisionType: TLineManualDecisionType;
  note: string | null;
  persistent: boolean;
  expiresAt: Date | null;
  adminMatchId?: string | null;
}

export async function applyComparisonDecision(
  client: PrismaClient,
  comparisonId: string,
  input: ManualDecisionInput,
) {
  return client.$transaction(async (transaction) => {
    const comparison = await transaction.tLineComparison.findUniqueOrThrow({
      where: { id: comparisonId },
      select: {
        automaticStatus: true,
        severity: true,
        runChampionshipId: true,
        runChampionship: { select: { championshipId: true } },
        sourceSnapshot: { select: { sourceKey: true } },
        adminSnapshot: { select: { adminMatchId: true } },
      },
    });
    const overlay = decisionOverlay(input.decisionType, comparison.automaticStatus, comparison.severity);
    await updatePersistentMatchLink(transaction, {
      championshipId: comparison.runChampionship.championshipId,
      runChampionshipId: comparison.runChampionshipId,
      sourceMatchKey: comparison.sourceSnapshot?.sourceKey ?? null,
      input,
    });
    await updatePersistentException(transaction, {
      championshipId: comparison.runChampionship.championshipId,
      sourceMatchKey: comparison.sourceSnapshot?.sourceKey ?? null,
      adminMatchId: comparison.adminSnapshot?.adminMatchId ?? null,
      input,
    });
    const decision = await transaction.tLineManualDecision.create({
      data: {
        comparisonId,
        decisionType: input.decisionType,
        effectiveStatus: overlay.manualStatus,
        note: input.note,
        persistent: input.persistent,
        expiresAt: input.expiresAt,
      },
    });
    const updated = await transaction.tLineComparison.update({
      where: { id: comparisonId },
      data: overlay,
    });
    return { decision, comparison: updated };
  });
}

async function updatePersistentMatchLink(
  transaction: Prisma.TransactionClient,
  target: {
    championshipId: string;
    runChampionshipId: string;
    sourceMatchKey: string | null;
    input: ManualDecisionInput;
  },
) {
  if (target.input.decisionType === "RESET") {
    if (target.sourceMatchKey) {
      await transaction.tLinePersistentMatchLink.updateMany({
        where: { championshipId: target.championshipId, sourceMatchKey: target.sourceMatchKey, active: true },
        data: { active: false },
      });
    }
    return;
  }
  if (target.input.decisionType !== "MANUAL_LINK") return;
  if (!target.sourceMatchKey || !target.input.adminMatchId) {
    throw new TLineValidationError("MATCH_LINK_EVIDENCE_REQUIRED", "A manual link requires source and Admin match evidence.");
  }
  const targetAdminSnapshot = await transaction.tLineAdminMatchSnapshot.findFirst({
    where: { runChampionshipId: target.runChampionshipId, adminMatchId: target.input.adminMatchId },
    select: { id: true },
  });
  if (!targetAdminSnapshot) {
    throw new TLineValidationError("ADMIN_MATCH_NOT_FOUND", "The selected Admin match is not part of this championship run.");
  }
  await transaction.tLinePersistentMatchLink.upsert({
    where: {
      championshipId_sourceMatchKey: {
        championshipId: target.championshipId,
        sourceMatchKey: target.sourceMatchKey,
      },
    },
    update: { adminMatchId: target.input.adminMatchId, active: true },
    create: {
      championshipId: target.championshipId,
      sourceMatchKey: target.sourceMatchKey,
      adminMatchId: target.input.adminMatchId,
      active: true,
    },
  });
}

async function updatePersistentException(
  transaction: Prisma.TransactionClient,
  target: {
    championshipId: string;
    sourceMatchKey: string | null;
    adminMatchId: string | null;
    input: ManualDecisionInput;
  },
) {
  const targetFilter = [
    ...(target.sourceMatchKey ? [{ sourceMatchKey: target.sourceMatchKey }] : []),
    ...(target.adminMatchId ? [{ adminMatchId: target.adminMatchId }] : []),
  ];
  if (target.input.decisionType === "RESET") {
    if (targetFilter.length > 0) {
      await transaction.tLineException.updateMany({
        where: { championshipId: target.championshipId, active: true, OR: targetFilter },
        data: { active: false },
      });
    }
    return;
  }
  if (!target.input.persistent || (target.input.decisionType !== "IGNORE_UNTIL" && target.input.decisionType !== "EXCLUDE")) return;
  if (targetFilter.length === 0) {
    throw new TLineValidationError("EXCEPTION_TARGET_REQUIRED", "A persistent exception requires source or Admin match evidence.");
  }
  await transaction.tLineException.updateMany({
    where: { championshipId: target.championshipId, active: true, OR: targetFilter },
    data: { active: false },
  });
  await transaction.tLineException.create({
    data: {
      championshipId: target.championshipId,
      type: target.input.decisionType,
      sourceMatchKey: target.sourceMatchKey,
      adminMatchId: target.adminMatchId,
      reason: target.input.note,
      expiresAt: target.input.expiresAt,
      active: true,
    },
  });
}

export async function applyRunChampionshipDecision(
  client: PrismaClient,
  runChampionshipId: string,
  input: ManualDecisionInput,
) {
  return client.$transaction(async (transaction) => {
    const championship = await transaction.tLineRunChampionship.findUniqueOrThrow({
      where: { id: runChampionshipId },
      select: { automaticStatus: true, severity: true },
    });
    const overlay = decisionOverlay(input.decisionType, championship.automaticStatus, championship.severity);
    const decision = await transaction.tLineManualDecision.create({
      data: {
        runChampionshipId,
        decisionType: input.decisionType,
        effectiveStatus: overlay.manualStatus,
        note: input.note,
        persistent: input.persistent,
        expiresAt: input.expiresAt,
      },
    });
    const updated = await transaction.tLineRunChampionship.update({
      where: { id: runChampionshipId },
      data: overlay,
    });
    return { decision, championship: updated };
  });
}

function decisionOverlay(
  decisionType: TLineManualDecisionType,
  automaticStatus: TLineEffectiveStatus,
  automaticSeverity: TLineSeverity,
) {
  if (decisionType === "RESET") {
    return {
      manualStatus: null,
      effectiveStatus: automaticStatus,
      effectiveSeverity: automaticSeverity,
    };
  }
  if (decisionType === "MANUAL_OK" || decisionType === "CONFIRM_CHAMPIONSHIP") {
    return {
      manualStatus: "MANUAL_OK" as const,
      effectiveStatus: "MANUAL_OK" as const,
      effectiveSeverity: "OK" as const,
    };
  }
  if (decisionType === "MANUAL_LINK") {
    return {
      manualStatus: automaticStatus,
      effectiveStatus: automaticStatus,
      effectiveSeverity: automaticSeverity,
    };
  }
  if (decisionType === "MANUAL_ERROR") {
    return {
      manualStatus: "MANUAL_ERROR" as const,
      effectiveStatus: "MANUAL_ERROR" as const,
      effectiveSeverity: "ERROR" as const,
    };
  }
  if (decisionType === "EXCLUDE" || decisionType === "IGNORE_UNTIL") {
    return {
      manualStatus: "IGNORED" as const,
      effectiveStatus: "IGNORED" as const,
      effectiveSeverity: "UNPROCESSED" as const,
    };
  }
  throw new TLineValidationError("INVALID_DECISION", "This manual decision is not valid for a status overlay.");
}
