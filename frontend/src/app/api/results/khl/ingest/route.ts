import { NextResponse } from "next/server";

import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { KhlRepositoryError, ingestKhlEventDetail } from "@backend/results/khl/repository";
import { KhlApiClient, KhlApiError } from "@backend/sources/results/khl/client";
import { KhlSchemaError } from "@backend/sources/results/khl/normalize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const apiEventId = readPositiveDecimalId(body, "apiEventId");
  const stageId = readPositiveDecimalId(body, "stageId");
  if (!apiEventId || !stageId) {
    return NextResponse.json(
      { error: "apiEventId and stageId must be positive decimal strings." },
      { status: 400 }
    );
  }

  try {
    const envelope = await new KhlApiClient().getEventDetailEnvelope({ apiEventId, stageId });
    const result = await ingestKhlEventDetail(prisma, {
      rawBody: envelope.rawBody,
      sourceUrl: envelope.sourceUrl,
      fetchedAt: envelope.fetchedAt,
      contentType: envelope.contentType || undefined,
    });
    return NextResponse.json({
      match: {
        id: result.match.id,
        khlGameId: result.match.khlGameId,
        status: result.match.status,
        activeRevisionId: result.match.activeRevisionId,
        adminBindingStatus: result.match.adminBindingStatus,
      },
      revision: {
        id: result.revision.id,
        revisionNumber: result.revision.revisionNumber,
        state: result.revision.state,
        normalizedHash: result.revision.normalizedHash,
      },
      idempotency: {
        reusedSnapshot: result.reusedSnapshot,
        reusedRevision: result.reusedRevision,
        activated: result.activated,
      },
      validation: result.normalized.validation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[KHL ingest]", message);
    if (error instanceof KhlRepositoryError || error instanceof KhlSchemaError) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    if (error instanceof KhlApiError) {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return NextResponse.json({ error: "KHL ingestion failed." }, { status: 500 });
  }
}

function readPositiveDecimalId(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && /^[1-9]\d{0,127}$/.test(raw.trim())
    ? raw.trim()
    : null;
}
