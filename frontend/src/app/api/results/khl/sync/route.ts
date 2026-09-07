import { NextResponse } from "next/server";
import { ApiRequestError, apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { enqueueKhlSync, khlSyncRunView, KhlSyncRequestError } from "@backend/results/khl/syncQueue";
import { readKhlSyncRequest } from "@backend/results/khl/syncRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unsafe = requireSameOriginJsonMutation(request);
  if (unsafe) return unsafe;
  const body = await readKhlSyncRequest(request);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "khlGameId")) {
    return NextResponse.json({ error: "Expected an object with optional khlGameId." }, { status: 400 });
  }
  const id = (body as Record<string, unknown>).khlGameId;
  if (id !== undefined && (typeof id !== "string" || !/^[1-9]\d{0,127}$/.test(id))) {
    return NextResponse.json({ error: "khlGameId must be a positive decimal string." }, { status: 400 });
  }
  try {
    const result = await enqueueKhlSync(prisma, { khlGameId: id as string | undefined });
    return NextResponse.json({ run: khlSyncRunView(result.run), reused: result.reused }, { status: 202 });
  } catch (cause) {
    if (cause instanceof KhlSyncRequestError) {
      const message = cause.status === 429
        ? "KHL sync queue is full. Wait for the current collection."
        : cause.status === 404
          ? "Stored KHL match was not found in the supported date range."
          : "khlGameId must be a positive decimal string.";
      return apiErrorResponse(new ApiRequestError("INVALID_KHL_SYNC_REQUEST", cause.status, message));
    }
    logApiError("api:khl/sync", cause);
    return apiErrorResponse(cause, "Unable to queue KHL collection.", 503);
  }
}
