import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";

import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  KhlBindingConflictError,
  confirmKhlMatchBinding,
} from "@backend/results/khl/bindings";
import type { AdminMatchCandidate } from "@backend/results/khl/matchResolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  try {
    const result = await confirmKhlMatchBinding(prisma, {
      khlGameId: body.khlGameId as string,
      adminMatchId: body.adminMatchId as string,
      candidates: body.candidates as AdminMatchCandidate[],
      confirmedBy: "admin-session",
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof KhlBindingConflictError) {
      return NextResponse.json(
        { error: safeErrorMessage(error), code: error.code },
        { status: error.code === "MATCH_NOT_FOUND" ? 404 : error.code === "INVALID_BINDING" ? 400 : 409 }
      );
    }
    logApiError("api:results/khl/bindings/match/route.ts", error);
    return NextResponse.json({ error: "Failed to save KHL match binding." }, { status: 500 });
  }
}

async function readBody(request: Request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
