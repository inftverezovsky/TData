import { createHash } from "node:crypto";

import {
  KhlBindingStatus,
  KhlMatchState,
  KhlRevisionState,
  KhlSnapshotResource,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  inspectKhlEventHeader,
  normalizeKhlEventDetail,
  requireResolvedKhlPlayers,
  type KhlMatchStatus,
  type NormalizedKhlMatch,
} from "@backend/sources/results/khl/normalize";

export const KHL_PARSER_VERSION = "khl-mobile-event-v4";
export const KHL_RULES_VERSION = "khl-admin-regulation-v1";

const MAX_RAW_BODY_BYTES = 5 * 1024 * 1024;
const MAX_TRANSACTION_ATTEMPTS = 3;
const APPROVED_SOURCE_HOSTS = new Set([
  "khl.api.webcaster.pro",
  "api-video.khl.ru",
]);

export type KhlIngestInput = {
  rawBody: string;
  rawBytes?: Uint8Array;
  sourceUrl: string;
  fetchedAt?: Date;
  contentType?: string;
  parserVersion?: string;
  rulesVersion?: string;
  expectedIdentity?: { khlGameId?: string; apiEventId: string; stageId: string };
  allowedDateRange?: { from: Date; to?: Date };
  requireFinished?: boolean;
  assertCanWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
};

type IngestInput = KhlIngestInput;

type IngestResult = {
  match: Awaited<ReturnType<Prisma.TransactionClient["khlMatch"]["findUniqueOrThrow"]>>;
  revision: Awaited<ReturnType<Prisma.TransactionClient["khlMatchRevision"]["findUniqueOrThrow"]>>;
  snapshot: Awaited<ReturnType<Prisma.TransactionClient["khlRawSnapshot"]["findUniqueOrThrow"]>>;
  normalized: NormalizedKhlMatch;
  contentHash: string;
  normalizedHash: string;
  reusedSnapshot: boolean;
  reusedRevision: boolean;
  activated: boolean;
};

export class KhlRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KhlRepositoryError";
  }
}

/**
 * Разобрать и проверить протокол → вычислить хеши сырого и нормализованного содержимого →
 * сохранить снимок, ревизию и проекцию матча в одной транзакции.
 * Повторный тот же ответ переиспользуется; версия парсера и правил входит в историю обработки.
 */
export async function ingestKhlEventDetail(
  prisma: PrismaClient,
  input: IngestInput
): Promise<IngestResult> {
  validateInput(input);
  const fetchedAt = input.fetchedAt || new Date();
  if (!Number.isFinite(fetchedAt.getTime())) {
    throw new KhlRepositoryError("KHL fetchedAt must be a valid date.");
  }

  let detail: unknown;
  let normalized: NormalizedKhlMatch;
  let verifiedGameId: string | undefined;
  try {
    if (input.rawBytes) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(input.rawBytes);
      } catch {
        throw new KhlRepositoryError("KHL raw response is not valid UTF-8.");
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody) as unknown;
    } catch {
      throw new KhlRepositoryError("KHL raw event body is not valid JSON.");
    }
    detail = unwrapEvent(parsed);
    const header = inspectKhlEventHeader(detail);
    assertExpectedIdentity(input, header);
    verifiedGameId = header.identity.khlGameId;
    assertResultScope(input, header);
    normalized = normalizeKhlEventDetail(detail);
  } catch (error) {
    await persistFailedEvidence(prisma, input, fetchedAt, verifiedGameId);
    throw error;
  }
  const rawRecord = detail as Record<string, unknown>;
  const parserVersion = input.parserVersion || KHL_PARSER_VERSION;
  const rulesVersion = input.rulesVersion || KHL_RULES_VERSION;
  const contentHash = sha256(input.rawBytes || input.rawBody);
  const normalizedJson = toJsonValue(normalized);
  const normalizedHash = sha256(canonicalStringify(normalizedJson));

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => ingestTransaction(tx, {
          input,
          fetchedAt,
          rawRecord,
          normalized,
          normalizedJson,
          contentHash,
          normalizedHash,
          parserVersion,
          rulesVersion,
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_TRANSACTION_ATTEMPTS || !isRetryableWriteConflict(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function ingestTransaction(
  tx: Prisma.TransactionClient,
  context: {
    input: IngestInput;
    fetchedAt: Date;
    rawRecord: Record<string, unknown>;
    normalized: NormalizedKhlMatch;
    normalizedJson: Prisma.InputJsonValue;
    contentHash: string;
    normalizedHash: string;
    parserVersion: string;
    rulesVersion: string;
  }
): Promise<IngestResult> {
  await context.input.assertCanWrite?.(tx);
  const {
    input,
    fetchedAt,
    rawRecord,
    normalized,
    normalizedJson,
    contentHash,
    normalizedHash,
    parserVersion,
    rulesVersion,
  } = context;

  const homeTeam = await upsertTeam(tx, normalized, "home", fetchedAt);
  const awayTeam = await upsertTeam(tx, normalized, "away", fetchedAt);
  const matchData = {
    apiEventId: normalized.identity.apiEventId,
    sourceMatchId: normalized.identity.matchId,
    stageId: String(normalized.identity.stageId),
    khlStageId: String(normalized.identity.khlStageId),
    stageName: optionalString(rawRecord.stage_name),
    season: normalized.identity.season,
    startsAt: new Date(normalized.startsAt),
    status: toDatabaseMatchState(normalized.status),
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    officialHomeScore: normalized.scores.official.home,
    officialAwayScore: normalized.scores.official.away,
    regulationHomeScore: normalized.scores.regulation.home,
    regulationAwayScore: normalized.scores.regulation.away,
  };
  let match = await tx.khlMatch.findUnique({
    where: { khlGameId: normalized.identity.khlGameId },
  });
  if (!match) {
    match = await tx.khlMatch.create({
      data: {
        khlGameId: normalized.identity.khlGameId,
        ...matchData,
      },
    });
  }
  // При смене идентичности матча старые привязки Admin нужно подтвердить заново.
  const bindingIdentityChanged = !match.activeRevisionId
    || match.apiEventId !== matchData.apiEventId
    || match.sourceMatchId !== matchData.sourceMatchId
    || match.stageId !== matchData.stageId
    || match.khlStageId !== matchData.khlStageId
    || match.season !== matchData.season
    || match.startsAt.getTime() !== matchData.startsAt.getTime()
    || match.homeTeamId !== matchData.homeTeamId
    || match.awayTeamId !== matchData.awayTeamId;
  const invalidatedMatchBinding = bindingIdentityChanged
    ? {
        adminMatchId: null,
        adminBindingStatus: KhlBindingStatus.UNMAPPED,
        adminBindingMode: null,
        adminConfirmedAt: null,
        adminConfirmedBy: null,
      }
    : {};

  const snapshotKey = {
    resourceType: KhlSnapshotResource.EVENT_DETAIL,
    externalKey: normalized.identity.khlGameId,
    contentHash,
  };
  const existingSnapshot = await tx.khlRawSnapshot.findUnique({
    where: { resourceType_externalKey_contentHash: snapshotKey },
  });
  const reusedSnapshot = Boolean(existingSnapshot);
  const snapshot = existingSnapshot
    ? await tx.khlRawSnapshot.update({
        where: { id: existingSnapshot.id },
        data: {
          matchId: match.id,
          sourceUrl: input.sourceUrl,
          contentType: input.contentType || "application/json",
          lastFetchedAt: fetchedAt,
          fetchCount: { increment: 1 },
        },
      })
    : await tx.khlRawSnapshot.create({
        data: {
          matchId: match.id,
          ...snapshotKey,
          sourceUrl: input.sourceUrl,
          contentType: input.contentType || "application/json",
          rawBody: rawBytesFor(input),
          firstFetchedAt: fetchedAt,
          lastFetchedAt: fetchedAt,
        },
      });

  const existingRevision = await tx.khlMatchRevision.findUnique({
    where: {
      matchId_normalizedHash_parserVersion_rulesVersion: {
        matchId: match.id,
        normalizedHash,
        parserVersion,
        rulesVersion,
      },
    },
  });
  let revision = existingRevision;
  let reusedRevision = Boolean(existingRevision);
  let activated = false;

  if (!revision) {
    const latest = await tx.khlMatchRevision.aggregate({
      where: { matchId: match.id },
      _max: { revisionNumber: true },
    });
    const revisionNumber = (latest._max.revisionNumber || 0) + 1;
    const valid = normalized.validation.ok;
    revision = await tx.khlMatchRevision.create({
      data: {
        matchId: match.id,
        snapshotId: snapshot.id,
        revisionNumber,
        normalizedHash,
        parserVersion,
        rulesVersion,
        state: valid ? KhlRevisionState.VALIDATED : KhlRevisionState.REJECTED,
        normalizedJson,
        validationIssues: toJsonValue(normalized.validation.issues),
        validatedAt: valid ? fetchedAt : null,
      },
    });

    if (valid) {
      if (bindingIdentityChanged) {
        await invalidateMatchScopedBindings(tx, match.id);
      }
      await activateRoster(tx, match.id, homeTeam.id, awayTeam.id, normalized, revisionNumber, fetchedAt);
      match = await tx.khlMatch.update({
        where: { id: match.id },
        data: { ...matchData, ...invalidatedMatchBinding, activeRevisionId: revision.id },
      });
      activated = true;
    }
  } else if (
    revision.state === KhlRevisionState.VALIDATED &&
    match.activeRevisionId !== revision.id
  ) {
    if (bindingIdentityChanged) {
      await invalidateMatchScopedBindings(tx, match.id);
    }
    await activateRoster(
      tx,
      match.id,
      homeTeam.id,
      awayTeam.id,
      normalized,
      revision.revisionNumber,
      fetchedAt
    );
    match = await tx.khlMatch.update({
      where: { id: match.id },
      data: { ...matchData, ...invalidatedMatchBinding, activeRevisionId: revision.id },
    });
    activated = true;
  }

  if (!activated) {
    if (
      revision.state === KhlRevisionState.VALIDATED
      && match.activeRevisionId === revision.id
    ) {
      if (bindingIdentityChanged) {
        await invalidateMatchScopedBindings(tx, match.id);
      }
      match = await tx.khlMatch.update({
        where: { id: match.id },
        data: { ...matchData, ...invalidatedMatchBinding },
      });
    } else {
      match = await tx.khlMatch.findUniqueOrThrow({ where: { id: match.id } });
    }
  }
  revision = await tx.khlMatchRevision.findUniqueOrThrow({ where: { id: revision.id } });
  const storedSnapshot = await tx.khlRawSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });

  return {
    match,
    revision,
    snapshot: storedSnapshot,
    normalized,
    contentHash,
    normalizedHash,
    reusedSnapshot,
    reusedRevision,
    activated,
  };
}

async function upsertTeam(
  tx: Prisma.TransactionClient,
  match: NormalizedKhlMatch,
  side: "home" | "away",
  fetchedAt: Date
) {
  const team = match.teams[side];
  return tx.khlTeam.upsert({
    where: { khlTeamId: String(team.khlTeamId) },
    create: {
      khlTeamId: String(team.khlTeamId),
      apiTeamId: String(team.apiTeamId),
      name: team.name,
      location: team.location,
      firstSeenAt: fetchedAt,
      lastSeenAt: fetchedAt,
    },
    update: {
      apiTeamId: String(team.apiTeamId),
      name: team.name,
      location: team.location,
      lastSeenAt: fetchedAt,
    },
  });
}

async function invalidateMatchScopedBindings(
  tx: Prisma.TransactionClient,
  matchId: string
) {
  const participants = await tx.khlMatchParticipant.findMany({
    where: { matchId },
    select: { id: true },
  });
  const participantIds = participants.map((participant) => participant.id);
  if (participantIds.length > 0) {
    await tx.khlPlayerStatTarget.updateMany({
      where: { participantId: { in: participantIds } },
      data: {
        adminPlayerStatId: null,
        adminBindingStatus: KhlBindingStatus.UNMAPPED,
        adminConfirmedAt: null,
        adminConfirmedBy: null,
      },
    });
  }
  await tx.khlTeamStatTarget.updateMany({
    where: { matchId },
    data: {
      adminMatchStatId: null,
      adminBindingStatus: KhlBindingStatus.UNMAPPED,
      adminConfirmedAt: null,
      adminConfirmedBy: null,
    },
  });
  await tx.khlMatchParticipant.updateMany({
    where: { matchId },
    data: {
      adminMatchPlayerId: null,
      adminBindingStatus: KhlBindingStatus.UNMAPPED,
      adminConfirmedAt: null,
      adminConfirmedBy: null,
    },
  });
}

async function activateRoster(
  tx: Prisma.TransactionClient,
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
  normalized: NormalizedKhlMatch,
  revisionNumber: number,
  fetchedAt: Date
) {
  const players = requireResolvedKhlPlayers(normalized.players);
  await tx.khlMatchParticipant.updateMany({
    where: { matchId },
    data: { isListed: false },
  });

  for (const player of players) {
    const storedPlayer = await tx.khlPlayer.upsert({
      where: { khlPlayerId: player.khlPlayerId },
      create: {
        khlPlayerId: player.khlPlayerId,
        apiPlayerId: player.apiPlayerId,
        name: player.name,
        role: player.role,
        firstSeenAt: fetchedAt,
        lastSeenAt: fetchedAt,
      },
      update: {
        apiPlayerId: player.apiPlayerId,
        name: player.name,
        role: player.role,
        lastSeenAt: fetchedAt,
      },
    });
    await tx.khlMatchParticipant.upsert({
      where: {
        matchId_playerId: {
          matchId,
          playerId: storedPlayer.id,
        },
      },
      create: {
        matchId,
        teamId: player.teamSide === "home" ? homeTeamId : awayTeamId,
        playerId: storedPlayer.id,
        shirtNumber: player.shirtNumber,
        role: player.role,
        isListed: true,
        firstSeenRevisionNumber: revisionNumber,
        lastSeenRevisionNumber: revisionNumber,
      },
      update: {
        teamId: player.teamSide === "home" ? homeTeamId : awayTeamId,
        shirtNumber: player.shirtNumber,
        role: player.role,
        isListed: true,
        lastSeenRevisionNumber: revisionNumber,
      },
    });
  }
}

function validateInput(input: IngestInput) {
  if (typeof input.rawBody !== "string" || (!input.rawBody.trim() && input.rawBytes === undefined)) {
    throw new KhlRepositoryError("KHL raw event body is required.");
  }
  if (input.rawBytes !== undefined && (!(input.rawBytes instanceof Uint8Array)
    || Buffer.from(input.rawBytes).toString("utf8") !== input.rawBody)) {
    throw new KhlRepositoryError("KHL raw text and bytes do not match.");
  }
  if ((input.rawBytes?.byteLength ?? Buffer.byteLength(input.rawBody, "utf8")) > MAX_RAW_BODY_BYTES) {
    throw new KhlRepositoryError("KHL raw event body exceeds the size limit.");
  }
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(input.sourceUrl);
  } catch {
    throw new KhlRepositoryError("KHL source URL is invalid.");
  }
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username ||
    sourceUrl.password ||
    !APPROVED_SOURCE_HOSTS.has(sourceUrl.hostname.toLowerCase())
  ) {
    throw new KhlRepositoryError("KHL source URL is not approved.");
  }
  if (input.expectedIdentity) {
    const expected = input.expectedIdentity;
    for (const id of [expected.apiEventId, expected.stageId, ...(expected.khlGameId === undefined ? [] : [expected.khlGameId])]) {
      if (typeof id !== "string" || !/^[1-9]\d{0,127}$/.test(id)) {
        throw new KhlRepositoryError("KHL expected identity must contain positive decimal strings.");
      }
    }
    if (sourceUrl.searchParams.get("id") !== expected.apiEventId
      || sourceUrl.searchParams.get("stage_id") !== expected.stageId) {
      throw new KhlRepositoryError("KHL source URL does not match the requested identity.");
    }
  }
  if (input.allowedDateRange) {
    const { from, to } = input.allowedDateRange;
    if (!(from instanceof Date) || !Number.isFinite(from.getTime())
      || (to !== undefined && (!(to instanceof Date) || !Number.isFinite(to.getTime()) || to <= from))) {
      throw new KhlRepositoryError("KHL allowed date range is invalid.");
    }
  }
}

function assertExpectedIdentity(input: IngestInput, header: ReturnType<typeof inspectKhlEventHeader>) {
  const expected = input.expectedIdentity;
  if (expected && (header.identity.apiEventId !== expected.apiEventId
    || header.identity.stageId !== expected.stageId
    || (expected.khlGameId !== undefined && header.identity.khlGameId !== expected.khlGameId))) {
    throw new KhlRepositoryError("KHL detail identity does not match the requested result.");
  }
}

function assertResultScope(input: IngestInput, header: ReturnType<typeof inspectKhlEventHeader>) {
  if (input.requireFinished && header.status !== "finished") {
    throw new KhlRepositoryError("KHL match must be finished before result ingestion.");
  }
  const range = input.allowedDateRange;
  const startsAt = new Date(header.startsAt);
  if (range && (startsAt < range.from || (range.to && startsAt >= range.to))) {
    throw new KhlRepositoryError("KHL detail date is outside the requested result range.");
  }
}

async function persistFailedEvidence(
  prisma: PrismaClient,
  input: IngestInput,
  fetchedAt: Date,
  verifiedGameId?: string
) {
  const contentHash = sha256(input.rawBytes || input.rawBody);
  const requestedEventId = input.expectedIdentity?.apiEventId || new URL(input.sourceUrl).searchParams.get("id");
  // Unverified response identities must never attach an error snapshot to a match.
  const externalKey = verifiedGameId || (requestedEventId && /^[1-9]\d*$/.test(requestedEventId)
    ? `api-event:${requestedEventId}` : `unidentified-response:${contentHash}`);
  const key = { resourceType: KhlSnapshotResource.EVENT_DETAIL, externalKey, contentHash };
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        await input.assertCanWrite?.(tx);
        await tx.khlRawSnapshot.upsert({
          where: { resourceType_externalKey_contentHash: key },
          create: {
            ...key, sourceUrl: input.sourceUrl, contentType: input.contentType || "application/json",
            rawBody: rawBytesFor(input), firstFetchedAt: fetchedAt, lastFetchedAt: fetchedAt,
          },
          update: { lastFetchedAt: fetchedAt, fetchCount: { increment: 1 } },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (attempt >= MAX_TRANSACTION_ATTEMPTS || !isRetryableWriteConflict(error)) throw error;
    }
  }
}

function unwrapEvent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  return object.event && typeof object.event === "object" ? object.event : value;
}

function toDatabaseMatchState(status: KhlMatchStatus): KhlMatchState {
  if (status === "scheduled") return KhlMatchState.SCHEDULED;
  if (status === "live") return KhlMatchState.LIVE;
  if (status === "finished") return KhlMatchState.FINISHED;
  if (status === "cancelled") return KhlMatchState.CANCELLED;
  return KhlMatchState.UNKNOWN;
}


function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortRecursively(nested)])
  );
}

function rawBytesFor(input: IngestInput) {
  return input.rawBytes ? Buffer.from(input.rawBytes) : Buffer.from(input.rawBody, "utf8");
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function isRetryableWriteConflict(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  return code === "P2034" || code === "P2002";
}
