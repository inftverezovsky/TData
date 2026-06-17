import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";

export type SourceFetchCacheMode = "cache-first" | "force" | "balanced" | string;

export type SourceFetchCacheKey = {
  source: string;
  disciplineSlug?: string | null;
  resourceType: string;
  resourceKey: string;
  mode?: SourceFetchCacheMode;
};

export type SourceFetchCacheRecord = {
  id: string;
  source: string;
  disciplineSlug: string;
  resourceType: string;
  resourceKey: string;
  mode: string;
  revisionId: number | null;
  revisionTimestamp: Date | null;
  contentHash: string | null;
  lastGoodAt: Date | null;
  lastAttemptAt: Date | null;
  lastErrorClass: string | null;
  qualityScore: number | null;
  cacheUntil: Date | null;
  staleUntil: Date | null;
  externalRequests: number;
  bytesIn: number | null;
  bytesOut: number | null;
  cacheLayer: string | null;
  rawSnapshotId: string | null;
  metadata: Prisma.JsonValue | null;
};

const DEFAULT_DISCIPLINE = "global";
const DEFAULT_MODE = "cache-first";

export const SOURCE_CACHE_TTL_MS = {
  liquipediaImport: 60 * 60 * 1000,
  liquipediaStale: 24 * 60 * 60 * 1000,
};

export function normalizeSourceFetchCacheKey(input: SourceFetchCacheKey) {
  return {
    source: normalizeKeyPart(input.source),
    disciplineSlug: normalizeKeyPart(input.disciplineSlug || DEFAULT_DISCIPLINE),
    resourceType: normalizeKeyPart(input.resourceType),
    resourceKey: normalizeResourceKey(input.resourceKey),
    mode: normalizeKeyPart(input.mode || DEFAULT_MODE),
  };
}

export function buildSourceFetchCacheKey(input: SourceFetchCacheKey) {
  const key = normalizeSourceFetchCacheKey(input);
  return `${key.source}:${key.disciplineSlug}:${key.resourceType}:${key.mode}:${key.resourceKey}`;
}

export async function findSourceFetchCache(input: SourceFetchCacheKey): Promise<SourceFetchCacheRecord | null> {
  const key = normalizeSourceFetchCacheKey(input);
  return (prisma as any).sourceFetchCache.findUnique({
    where: { source_disciplineSlug_resourceType_resourceKey_mode: key },
  });
}

export async function clearSourceFetchCache(input: SourceFetchCacheKey) {
  const key = normalizeSourceFetchCacheKey(input);
  const where: Record<string, string> = {
    source: key.source,
    disciplineSlug: key.disciplineSlug,
    resourceType: key.resourceType,
    resourceKey: key.resourceKey,
  };

  if (input.mode !== undefined) {
    where.mode = key.mode;
  }

  return (prisma as any).sourceFetchCache.deleteMany({ where });
}

export async function markSourceFetchAttempt(input: SourceFetchCacheKey) {
  const key = normalizeSourceFetchCacheKey(input);
  const now = new Date();
  return (prisma as any).sourceFetchCache.upsert({
    where: { source_disciplineSlug_resourceType_resourceKey_mode: key },
    update: { lastAttemptAt: now },
    create: {
      ...key,
      lastAttemptAt: now,
    },
  });
}

export async function markSourceFetchSuccess(input: SourceFetchCacheKey, data: {
  revisionId?: number | null;
  revisionTimestamp?: Date | null;
  contentHash?: string | null;
  qualityScore?: number | null;
  rawSnapshotId?: string | null;
  externalRequests?: number;
  bytesIn?: number | null;
  bytesOut?: number | null;
  cacheLayer?: string | null;
  metadata?: Prisma.InputJsonValue;
  cacheTtlMs?: number;
  staleTtlMs?: number;
}) {
  const key = normalizeSourceFetchCacheKey(input);
  const now = new Date();
  const cacheUntil = new Date(now.getTime() + (data.cacheTtlMs ?? SOURCE_CACHE_TTL_MS.liquipediaImport));
  const staleUntil = new Date(now.getTime() + (data.staleTtlMs ?? SOURCE_CACHE_TTL_MS.liquipediaStale));

  return (prisma as any).sourceFetchCache.upsert({
    where: { source_disciplineSlug_resourceType_resourceKey_mode: key },
    update: {
      revisionId: data.revisionId ?? null,
      revisionTimestamp: data.revisionTimestamp ?? null,
      contentHash: data.contentHash ?? null,
      qualityScore: data.qualityScore ?? undefined,
      rawSnapshotId: data.rawSnapshotId ?? undefined,
      lastGoodAt: now,
      lastAttemptAt: now,
      lastErrorClass: null,
      cacheUntil,
      staleUntil,
      bytesIn: data.bytesIn ?? undefined,
      bytesOut: data.bytesOut ?? undefined,
      cacheLayer: data.cacheLayer ?? "source-fetch-cache",
      metadata: data.metadata ?? undefined,
      externalRequests: { increment: data.externalRequests ?? 0 },
    },
    create: {
      ...key,
      revisionId: data.revisionId ?? null,
      revisionTimestamp: data.revisionTimestamp ?? null,
      contentHash: data.contentHash ?? null,
      qualityScore: data.qualityScore ?? null,
      rawSnapshotId: data.rawSnapshotId ?? null,
      lastGoodAt: now,
      lastAttemptAt: now,
      cacheUntil,
      staleUntil,
      bytesIn: data.bytesIn ?? null,
      bytesOut: data.bytesOut ?? null,
      cacheLayer: data.cacheLayer ?? "source-fetch-cache",
      metadata: data.metadata ?? Prisma.JsonNull,
      externalRequests: data.externalRequests ?? 0,
    },
  });
}

export async function markSourceFetchFailure(input: SourceFetchCacheKey, data: {
  errorClass: string;
  externalRequests?: number;
  bytesIn?: number | null;
  bytesOut?: number | null;
}) {
  const key = normalizeSourceFetchCacheKey(input);
  const now = new Date();
  return (prisma as any).sourceFetchCache.upsert({
    where: { source_disciplineSlug_resourceType_resourceKey_mode: key },
    update: {
      lastAttemptAt: now,
      lastErrorClass: data.errorClass,
      bytesIn: data.bytesIn ?? undefined,
      bytesOut: data.bytesOut ?? undefined,
      externalRequests: { increment: data.externalRequests ?? 0 },
    },
    create: {
      ...key,
      lastAttemptAt: now,
      lastErrorClass: data.errorClass,
      bytesIn: data.bytesIn ?? null,
      bytesOut: data.bytesOut ?? null,
      externalRequests: data.externalRequests ?? 0,
    },
  });
}

export function isSourceCacheFresh(cache: SourceFetchCacheRecord | null | undefined, now = new Date()) {
  return Boolean(cache?.cacheUntil && cache.cacheUntil.getTime() > now.getTime());
}

export function isSourceCacheStaleUsable(cache: SourceFetchCacheRecord | null | undefined, now = new Date()) {
  return Boolean(cache?.staleUntil && cache.staleUntil.getTime() > now.getTime());
}

function normalizeResourceKey(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeKeyPart(value: string) {
  return String(value || "")
    .replace(/\s+/g, "-")
    .trim()
    .toLowerCase();
}
