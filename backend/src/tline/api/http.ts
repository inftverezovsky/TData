import { NextResponse } from "next/server";

import { requireSameOriginJsonMutation, requireSameOriginMutation } from "../../auth/adminAuth";
import { TLineRunRequestError } from "../application/runs";
import { serializeTLineJson, TLineInputError } from "./contracts";
import { TLineValidationError } from "./validation";

const MAX_JSON_BODY_BYTES = 256 * 1024;

export function apiOk<T>(data: T, status = 200, meta?: Record<string, unknown>) {
  return NextResponse.json(
    serializeTLineJson({ ok: true, data, ...(meta ? { meta } : {}) }),
    { status },
  );
}

export function apiError(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    serializeTLineJson({
      ok: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
    }),
    { status },
  );
}

export async function requireTLineAccess(request: Request, mutation = false) {
  if (!mutation) return null;

  const invalidMutation = requireSameOriginJsonMutation(request);
  if (!invalidMutation) return null;
  if (invalidMutation.status === 415) {
    return apiError("INVALID_CONTENT_TYPE", "Content-Type must be application/json.", 415);
  }
  return apiError("FORBIDDEN_ORIGIN", "The request origin is not allowed.", 403);
}

export async function requireTLineFormAccess(request: Request) {
  const invalidMutation = requireSameOriginMutation(request, ["multipart/form-data"]);
  if (!invalidMutation) return null;
  return invalidMutation.status === 415
    ? apiError("INVALID_CONTENT_TYPE", "Content-Type must be multipart/form-data.", 415)
    : apiError("FORBIDDEN_ORIGIN", "The request origin is not allowed.", 403);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new TLineInputError("PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  try {
    return await request.json();
  } catch {
    throw new TLineInputError("INVALID_JSON", "Request body must be valid JSON.");
  }
}

export function tlineErrorResponse(error: unknown) {
  if (
    error instanceof TLineInputError
    || error instanceof TLineValidationError
    || error instanceof TLineRunRequestError
  ) {
    const notFound = error.code === "SPORT_NOT_FOUND" || error.code.endsWith("_NOT_FOUND");
    return apiError(error.code, error.message, notFound ? 404 : 400);
  }
  if (isPrismaNotFound(error)) {
    return apiError("NOT_FOUND", "The requested TLine resource was not found.", 404);
  }
  if (isPrismaCode(error, "P2002")) {
    return apiError("CONFLICT", "A TLine resource with these unique fields already exists.", 409);
  }
  return apiError("INTERNAL_ERROR", "TLine could not complete the request.", 500);
}

export function isTLineEnabled() {
  return process.env.TLINE_ENABLED === "1";
}

function isPrismaNotFound(error: unknown) {
  return isPrismaCode(error, "P2025");
}

function isPrismaCode(error: unknown, code: string) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}
