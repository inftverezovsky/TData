import { NextResponse } from "next/server";

import { KhlApiClient, KhlApiError } from "@backend/sources/results/khl/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
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
