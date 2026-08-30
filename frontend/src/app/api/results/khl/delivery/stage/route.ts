import { NextResponse } from "next/server";

import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  KhlDeliveryBlockedError,
  stageKhlAdminDelivery,
} from "@backend/results/khl/delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STAGING_ENDPOINT_VERSION = "admin-results-contract-unconfirmed";

export async function POST(request: Request) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const raw = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).khlGameId
    : null;
  const expectedRevisionIdRaw = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).expectedRevisionId
    : null;
  const expectedPayloadHashRaw = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).expectedPayloadHash
    : null;
  const khlGameId = typeof raw === "string" && /^[1-9]\d{0,127}$/.test(raw.trim())
    ? raw.trim()
    : null;
  if (!khlGameId) {
    return NextResponse.json(
      { error: "khlGameId must be a positive decimal string." },
      { status: 400 }
    );
  }
  const expectedRevisionId = typeof expectedRevisionIdRaw === "string"
    && expectedRevisionIdRaw.trim()
    && expectedRevisionIdRaw.trim().length <= 128
    ? expectedRevisionIdRaw.trim()
    : null;
  const expectedPayloadHash = typeof expectedPayloadHashRaw === "string"
    && /^[a-f0-9]{64}$/i.test(expectedPayloadHashRaw.trim())
    ? expectedPayloadHashRaw.trim().toLowerCase()
    : null;
  if (!expectedRevisionId || !expectedPayloadHash) {
    return NextResponse.json(
      { error: "expectedRevisionId and expectedPayloadHash must identify the reviewed preview." },
      { status: 400 }
    );
  }

  try {
    const result = await stageKhlAdminDelivery(prisma, {
      khlGameId,
      endpointVersion: STAGING_ENDPOINT_VERSION,
      expectedRevisionId,
      expectedPayloadHash,
    });
    return NextResponse.json({
      ok: true,
      transportExecuted: false,
      reused: result.reused,
      delivery: {
        id: result.delivery.id,
        state: result.delivery.state,
        payloadHash: result.delivery.payloadHash,
        idempotencyKey: result.delivery.idempotencyKey,
        endpointVersion: result.delivery.endpointVersion,
        createdAt: result.delivery.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof KhlDeliveryBlockedError) {
      return NextResponse.json(
        { error: error.message, issues: error.issues },
        { status: 409 }
      );
    }
    console.error("[KHL delivery staging]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to stage KHL delivery." }, { status: 500 });
  }
}
