import { NextResponse } from "next/server";

import { requireAdmin } from "@backend/auth/adminAuth";
import { KhlApiClient, KhlApiError } from "@backend/sources/results/khl/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const stages = await new KhlApiClient().listStages();
    return NextResponse.json({ stages });
  } catch (error) {
    console.error("[KHL stages]", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof KhlApiError ? error.message : "Failed to load KHL stages." },
      { status: 502 }
    );
  }
}
