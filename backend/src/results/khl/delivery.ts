import { createHash } from "node:crypto";

import {
  KhlDeliveryState,
  KhlRevisionState,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { buildKhlAdminPreview } from "@backend/results/khl/preview";

export class KhlDeliveryBlockedError extends Error {
  constructor(public readonly issues: string[]) {
    super(`KHL delivery staging is blocked: ${issues.join("; ")}`);
    this.name = "KhlDeliveryBlockedError";
  }
}

export async function stageKhlAdminDelivery(
  prisma: PrismaClient,
  input: {
    khlGameId: string;
    endpointVersion: string;
    expectedRevisionId: string;
    expectedPayloadHash: string;
  }
) {
  const endpointVersion = validateEndpointVersion(input.endpointVersion);
  const expectedRevisionId = validateExpectedRevisionId(input.expectedRevisionId);
  const expectedPayloadHash = validateExpectedPayloadHash(input.expectedPayloadHash);
  const preview = await buildKhlAdminPreview(prisma, input.khlGameId);
  if (!preview.ready) throw new KhlDeliveryBlockedError(preview.issues);
  assertReviewedPreview(preview, expectedRevisionId, expectedPayloadHash);

  const idempotencyKey = createHash("sha256").update([
    "khl-results",
    preview.payload.schemaVersion,
    preview.payload.match.adminMatchId,
    endpointVersion,
    preview.payloadHash,
  ].join("\u0000")).digest("hex");

  const MAX_STAGE_ATTEMPTS = 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_STAGE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "KhlMatch"
          WHERE "khlGameId" = ${input.khlGameId}
          FOR UPDATE
        `);
        const match = await tx.khlMatch.findUnique({
          where: { khlGameId: input.khlGameId },
          select: { id: true, activeRevisionId: true, adminMatchId: true },
        });
        if (
          !match
          || match.activeRevisionId !== expectedRevisionId
          || match.activeRevisionId !== preview.payload.source.revisionId
          || match.adminMatchId !== preview.payload.match.adminMatchId
        ) {
          throw new KhlDeliveryBlockedError([
            "KHL active revision or Admin match mapping changed while staging delivery.",
          ]);
        }
        const latestRevision = await tx.khlMatchRevision.findFirst({
          where: { matchId: match.id },
          orderBy: { revisionNumber: "desc" },
          select: { id: true, state: true },
        });
        if (
          !latestRevision
          || latestRevision.id !== match.activeRevisionId
          || latestRevision.state !== KhlRevisionState.VALIDATED
        ) {
          throw new KhlDeliveryBlockedError([
            "KHL latest revision is not the active validated revision while staging delivery.",
          ]);
        }
        const existing = await tx.khlDelivery.findUnique({ where: { idempotencyKey } });
        if (existing) return { delivery: existing, reused: true };

        const delivery = await tx.khlDelivery.create({
          data: {
            revisionId: preview.payload.source.revisionId,
            adminMatchId: preview.payload.match.adminMatchId,
            endpointVersion,
            payloadHash: preview.payloadHash,
            idempotencyKey,
            payloadJson: preview.payload as unknown as Prisma.InputJsonValue,
            state: KhlDeliveryState.PENDING,
          },
        });
        return { delivery, reused: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      lastError = error;
      if (!isRetryableStageConflict(error)) throw error;
      const winner = await prisma.khlDelivery.findUnique({ where: { idempotencyKey } });
      if (winner) {
        await assertReviewedPreviewCurrent(
          prisma,
          input.khlGameId,
          expectedRevisionId,
          expectedPayloadHash
        );
        return { delivery: winner, reused: true };
      }
      if (attempt >= MAX_STAGE_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw lastError;
}

function assertReviewedPreview(
  preview: Extract<Awaited<ReturnType<typeof buildKhlAdminPreview>>, { ready: true }>,
  expectedRevisionId: string,
  expectedPayloadHash: string
) {
  if (
    preview.revisionId !== expectedRevisionId
    || preview.payloadHash !== expectedPayloadHash
  ) {
    throw new KhlDeliveryBlockedError([
      "The reviewed preview no longer matches the active revision or payload hash.",
    ]);
  }
}

async function assertReviewedPreviewCurrent(
  prisma: PrismaClient,
  khlGameId: string,
  expectedRevisionId: string,
  expectedPayloadHash: string
) {
  const current = await buildKhlAdminPreview(prisma, khlGameId);
  if (!current.ready) throw new KhlDeliveryBlockedError(current.issues);
  assertReviewedPreview(current, expectedRevisionId, expectedPayloadHash);
}

function isRetryableStageConflict(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const databaseCode = String(
    (error as { meta?: { code?: string } })?.meta?.code || ""
  );
  return code === "P2002"
    || code === "P2034"
    || databaseCode === "40001"
    || databaseCode === "40P01";
}

function validateEndpointVersion(value: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new KhlDeliveryBlockedError([
      "Admin result endpoint version must contain between 1 and 128 characters.",
    ]);
  }
  return value.trim();
}

function validateExpectedRevisionId(value: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new KhlDeliveryBlockedError(["Expected KHL revision id is invalid."]);
  }
  return value.trim();
}

function validateExpectedPayloadHash(value: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value.trim())) {
    throw new KhlDeliveryBlockedError(["Expected KHL payload hash must be a SHA-256 hex string."]);
  }
  return value.trim().toLowerCase();
}
