import type { PrismaClient } from "@prisma/client";

import { buildKhlAdminPreview } from "@backend/results/khl/preview";

const MAX_DIFF_ENTRIES = 250;

export type KhlPayloadDiffEntry = {
  path: string;
  before: unknown;
  after: unknown;
};

export type KhlAdminDeliveryDiff =
  | {
      status: "BLOCKED";
      issues: string[];
      currentPayloadHash: null;
      baseline: null;
      changes: [];
      truncated: false;
    }
  | {
      status: "NEW" | "UNCHANGED" | "CHANGED";
      issues: [];
      currentPayloadHash: string;
      baseline: null | {
        deliveryId: string;
        revisionId: string;
        payloadHash: string;
        endpointVersion: string;
        state: string;
        createdAt: string;
      };
      changes: KhlPayloadDiffEntry[];
      truncated: boolean;
    };

export async function buildKhlAdminDeliveryDiff(
  prisma: PrismaClient,
  khlGameId: string
): Promise<KhlAdminDeliveryDiff> {
  const preview = await buildKhlAdminPreview(prisma, khlGameId);
  if (!preview.ready) {
    return {
      status: "BLOCKED",
      issues: preview.issues,
      currentPayloadHash: null,
      baseline: null,
      changes: [],
      truncated: false,
    };
  }

  const latest = await prisma.khlDelivery.findFirst({
    where: {
      revision: {
        match: { khlGameId: preview.match.khlGameId },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!latest) {
    return {
      status: "NEW",
      issues: [],
      currentPayloadHash: preview.payloadHash,
      baseline: null,
      changes: [],
      truncated: false,
    };
  }

  const baseline = {
    deliveryId: latest.id,
    revisionId: latest.revisionId,
    payloadHash: latest.payloadHash,
    endpointVersion: latest.endpointVersion,
    state: latest.state,
    createdAt: latest.createdAt.toISOString(),
  };
  if (latest.payloadHash === preview.payloadHash) {
    return {
      status: "UNCHANGED",
      issues: [],
      currentPayloadHash: preview.payloadHash,
      baseline,
      changes: [],
      truncated: false,
    };
  }

  const result = diffJson(latest.payloadJson, preview.payload);
  return {
    status: "CHANGED",
    issues: [],
    currentPayloadHash: preview.payloadHash,
    baseline,
    changes: result.changes,
    truncated: result.truncated,
  };
}

function diffJson(before: unknown, after: unknown) {
  const changes: KhlPayloadDiffEntry[] = [];
  let truncated = false;

  const visit = (left: unknown, right: unknown, path: string) => {
    if (changes.length >= MAX_DIFF_ENTRIES) {
      truncated = true;
      return;
    }
    if (Object.is(left, right)) return;

    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        visit(left[index] ?? null, right[index] ?? null, `${path}/${index}`);
        if (truncated) return;
      }
      return;
    }

    if (isJsonObject(left) && isJsonObject(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        visit(
          Object.hasOwn(left, key) ? left[key] : null,
          Object.hasOwn(right, key) ? right[key] : null,
          `${path}/${escapeJsonPointer(key)}`
        );
        if (truncated) return;
      }
      return;
    }

    changes.push({ path: path || "/", before: left ?? null, after: right ?? null });
  };

  visit(before, after, "");
  return { changes, truncated };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeJsonPointer(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
