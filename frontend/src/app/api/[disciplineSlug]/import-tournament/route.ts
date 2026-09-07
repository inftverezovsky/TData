import { NextResponse } from "next/server";
import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import {
  dispatchTournamentImport,
  type ImportTournamentRequestBody,
} from "@backend/imports/dispatcher";
import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { BoundedBodyReadError, readBoundedBodyJson } from "@backend/http/boundedResponse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const { disciplineSlug } = await params;
  let body: ImportTournamentRequestBody;
  try {
    body = await readImportTournamentRequestBody(request);
  } catch (error) {
    if (error instanceof BoundedBodyReadError && error.code === "body_too_large") {
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  try {
    const result = await dispatchTournamentImport(disciplineSlug, body);
    return NextResponse.json(result.body, { status: result.status ?? inferTournamentImportStatus(result.body) });
  } catch (error) {
    logApiError("api:[disciplineSlug]/import-tournament/route.ts", error);
    return apiErrorResponse(error);
  }
}

export async function readImportTournamentRequestBody(request: Request): Promise<ImportTournamentRequestBody> {
  const value = await readBoundedBodyJson(request, {
    maxBytes: 64 * 1024,
    signal: request.signal,
    label: "Tournament import request body",
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoundedBodyReadError("Tournament import request body must be a JSON object.", "invalid_json");
  }
  return value as ImportTournamentRequestBody;
}

export function inferTournamentImportStatus(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 200;
  const normalized = (body as { normalized?: unknown }).normalized;
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return 200;
  const status = (normalized as { status?: unknown }).status;
  return status === "SUCCESS" ? 200 : status === "PARTIAL" || status === "FAILED" ? 502 : 200;
}
