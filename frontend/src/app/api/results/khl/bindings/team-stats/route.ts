import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";

import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  confirmKhlTeamStatBindings,
  KhlTargetBindingError,
  type ConfirmKhlTeamStatBindingsInput,
} from "@backend/results/khl/targetBindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const parsed = await parseBoundedJsonObject(request);
  if (parsed instanceof Response) return parsed;

  try {
    const result = await confirmKhlTeamStatBindings(prisma, {
      ...parsed,
      confirmedBy: "admin-session",
    } as ConfirmKhlTeamStatBindingsInput);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof KhlTargetBindingError) {
      const status = error.code === "TEAM_NOT_FOUND"
        ? 404
        : error.code === "INVALID_TARGET_BINDINGS" ? 400 : 409;
      return NextResponse.json({ error: safeErrorMessage(error), code: error.code }, { status });
    }
    logApiError("api:results/khl/bindings/team-stats/route.ts", error);
    return NextResponse.json({ error: "Failed to confirm KHL team statistic bindings." }, { status: 500 });
  }
}

async function parseBoundedJsonObject(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "Request body must be a valid JSON object." }, { status: 400 });
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return NextResponse.json({ error: "Request body could not be read." }, { status: 400 });
  }

  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be a valid JSON object." }, { status: 400 });
  }
}
