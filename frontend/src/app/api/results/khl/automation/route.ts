import { NextResponse } from "next/server";

import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { setKhlSyncPaused } from "@backend/results/khl/syncQueue";
import { readKhlSyncRequest } from "@backend/results/khl/syncRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const invalidMutation = requireSameOriginJsonMutation(request);
  if (invalidMutation) return invalidMutation;

  const body = await readKhlSyncRequest(request);
  if (body instanceof Response) return body;
  if (!isPauseRequest(body)) {
    return NextResponse.json({ error: "paused must be a boolean." }, { status: 400 });
  }

  const result = await setKhlSyncPaused(
    prisma,
    body.paused,
    process.env.KHL_RESULTS_AUTO_SYNC_ENABLED === "1"
  );
  return NextResponse.json(result);
}

function isPauseRequest(value: unknown): value is { paused: boolean } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { paused?: unknown }).paused === "boolean";
}
