import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";

import { prisma } from "@backend/db/db";
import { KHL_RESULTS_CUTOFF } from "@backend/results/khl/autoSync";
import { getKhlResultsAutomationStatus } from "@backend/results/khl/automation";
import { buildKhlMatchProtocolView } from "@backend/results/khl/matchProtocol";
import type { NormalizedKhlMatch } from "@backend/sources/results/khl/normalize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const stageId = optionalExternalId(url.searchParams.get("stageId"));
    const limit = Math.min(optionalPositiveInteger(url.searchParams.get("limit")) || 50, 100);
    const offset = Math.min(optionalNonNegativeInteger(url.searchParams.get("offset")) || 0, 10_000);
    if (url.searchParams.has("stageId") && !stageId) {
      return NextResponse.json({ error: "stageId must be a positive decimal string." }, { status: 400 });
    }

    const where = {
      startsAt: { gte: KHL_RESULTS_CUTOFF },
      ...(stageId ? { stageId } : {}),
    };
    const [matches, latestSnapshot, total, automation] = await Promise.all([
      prisma.khlMatch.findMany({
        where,
        orderBy: [{ startsAt: "desc" }, { khlGameId: "desc" }],
        skip: offset,
        take: limit,
        include: {
          homeTeam: true,
          awayTeam: true,
          activeRevision: {
            select: {
              id: true,
              revisionNumber: true,
              normalizedHash: true,
              state: true,
              validationIssues: true,
              createdAt: true,
              normalizedJson: true,
            },
          },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              id: true,
              revisionNumber: true,
              normalizedHash: true,
              state: true,
              validationIssues: true,
              createdAt: true,
              normalizedJson: true,
            },
          },
          _count: { select: { revisions: true, participants: true } },
        },
      }),
      prisma.khlRawSnapshot.findFirst({
        where: { match: { is: { startsAt: { gte: KHL_RESULTS_CUTOFF } } } },
        orderBy: { lastFetchedAt: "desc" },
        select: { lastFetchedAt: true },
      }),
      prisma.khlMatch.count({ where }),
      getKhlResultsAutomationStatus(
        prisma,
        process.env.KHL_RESULTS_AUTO_SYNC_ENABLED === "1"
      ),
    ]);
    return NextResponse.json({
      automation: {
        ...automation,
        cutoff: KHL_RESULTS_CUTOFF.toISOString(),
        intervalMinutes: automaticSyncIntervalMinutes(),
        lastFetchedAt: latestSnapshot?.lastFetchedAt || null,
      },
      pagination: {
        offset,
        limit,
        total,
        hasMore: offset + matches.length < total,
      },
      matches: matches.map(buildKhlMatchResponseItem),
    });
  } catch (error) {
    logApiError("api:results/khl/matches/route.ts", error);
    return apiErrorResponse(error);
  }
}

type MatchRevisionViewInput = {
  id: string;
  revisionNumber: number;
  normalizedHash: string;
  state: string;
  validationIssues: unknown;
  createdAt: Date;
  normalizedJson: unknown;
};

type MatchViewInput = Record<string, unknown> & {
  activeRevision: MatchRevisionViewInput | null;
  revisions: MatchRevisionViewInput[];
};

export function buildKhlMatchResponseItem(match: MatchViewInput) {
  const { revisions, ...storedMatch } = match;
  const activeRevision = match.activeRevision;
  const latestRevision = revisions[0] || activeRevision || null;
  const protocolRevision = activeRevision || latestRevision;
  const source = !protocolRevision
    ? null
    : activeRevision?.state === "VALIDATED"
      ? "ACTIVE_VALIDATED"
      : protocolRevision.state === "REJECTED"
        ? "LATEST_REJECTED"
        : "LATEST_REVISION";

  return {
    ...storedMatch,
    activeRevision: revisionMetadata(activeRevision),
    latestRevision: revisionMetadata(latestRevision),
    displayRevision: protocolRevision && source
      ? { ...revisionMetadata(protocolRevision)!, source }
      : null,
    protocol: protocolRevision
      ? buildKhlMatchProtocolView(
        protocolRevision.normalizedJson as unknown as NormalizedKhlMatch
      )
      : null,
  };
}

function revisionMetadata(revision: MatchRevisionViewInput | null) {
  return revision ? {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    normalizedHash: revision.normalizedHash,
    state: revision.state,
    validationIssues: revision.validationIssues,
    createdAt: revision.createdAt.toISOString(),
  } : null;
}

function optionalPositiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalNonNegativeInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function optionalExternalId(value: string | null) {
  return value && /^[1-9]\d{0,127}$/.test(value) ? value : null;
}

function automaticSyncIntervalMinutes() {
  const value = Number(process.env.KHL_RESULTS_AUTO_SYNC_INTERVAL_MINUTES || "10");
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_440 ? value : 10;
}
