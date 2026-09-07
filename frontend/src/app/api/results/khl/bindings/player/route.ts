import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";

import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  KhlBindingConflictError,
  confirmKhlPlayerBinding,
} from "@backend/results/khl/bindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    body = value as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be a valid JSON object." }, { status: 400 });
  }

  try {
    const result = await confirmKhlPlayerBinding(prisma, {
      khlGameId: body.khlGameId as string,
      khlPlayerId: body.khlPlayerId as string,
      adminPlayerId: body.adminPlayerId as string,
      adminMatchPlayerId: body.adminMatchPlayerId as string | null | undefined,
      confirmedBy: "admin-session",
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof KhlBindingConflictError) {
      const status = error.code === "MATCH_NOT_FOUND" || error.code === "PLAYER_NOT_FOUND"
        ? 404
        : error.code === "INVALID_BINDING" ? 400 : 409;
      return NextResponse.json({ error: safeErrorMessage(error), code: error.code }, { status });
    }
    logApiError("api:results/khl/bindings/player/route.ts", error);
    return NextResponse.json({ error: "Failed to save KHL player binding." }, { status: 500 });
  }
}
