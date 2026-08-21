import { NextResponse } from "next/server";

import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { setKhlResultsAutoSyncPaused } from "@backend/results/khl/automation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const invalidMutation = requireSameOriginJsonMutation(request);
  if (invalidMutation) return invalidMutation;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isPauseRequest(body)) {
    return NextResponse.json({ error: "paused must be a boolean." }, { status: 400 });
  }

  const automation = await setKhlResultsAutoSyncPaused(
    prisma,
    body.paused,
    process.env.KHL_RESULTS_AUTO_SYNC_ENABLED === "1"
  );
  return NextResponse.json({ automation });
}

function isPauseRequest(value: unknown): value is { paused: boolean } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { paused?: unknown }).paused === "boolean";
}
