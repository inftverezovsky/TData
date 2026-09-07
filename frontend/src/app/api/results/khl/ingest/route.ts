import { NextResponse } from "next/server";
import { ApiRequestError, apiErrorResponse, logApiError } from "@backend/http/apiResponse";

import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { enqueueKhlSync, khlSyncRunView, KhlSyncRequestError } from "@backend/results/khl/syncQueue";
import { readKhlSyncRequest } from "@backend/results/khl/syncRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const body = await readKhlSyncRequest(request);
  if (body instanceof Response) return body;
  const apiEventId = readPositiveDecimalId(body, "apiEventId");
  const stageId = readPositiveDecimalId(body, "stageId");
  if (!apiEventId || !stageId) {
    return NextResponse.json(
      { error: "apiEventId and stageId must be positive decimal strings." },
      { status: 400 }
    );
  }

  try {
    const result = await enqueueKhlSync(prisma, { apiEventId, stageId });
    return NextResponse.json({ run: khlSyncRunView(result.run), reused: result.reused }, { status: 202 });
  } catch (error) {
    if (error instanceof KhlSyncRequestError) {
      const message = error.status === 429
        ? "KHL sync queue is full. Wait for the current collection."
        : error.status === 404
          ? "Stored KHL match was not found in the supported date range."
          : "apiEventId and stageId must be positive decimal strings.";
      return apiErrorResponse(new ApiRequestError("INVALID_KHL_SYNC_REQUEST", error.status, message));
    }
    logApiError("api:khl/ingest", error);
    return apiErrorResponse(error, "Failed to queue KHL ingestion.");
  }
}

function readPositiveDecimalId(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && /^[1-9]\d{0,127}$/.test(raw.trim())
    ? raw.trim()
    : null;
}
