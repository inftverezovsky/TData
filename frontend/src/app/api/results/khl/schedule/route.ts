import { NextResponse } from "next/server";

import { requireAdmin } from "@backend/auth/adminAuth";
import { KhlApiClient, KhlApiError } from "@backend/sources/results/khl/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const stageId = positiveDecimalId(url.searchParams.get("stageId"));
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  if (!stageId || !from || !to || from >= to || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return NextResponse.json(
      { error: "stageId, from and to are required; the date range must not exceed 62 days." },
      { status: 400 }
    );
  }

  try {
    const events = await new KhlApiClient().listEvents({ stageId, from, to });
    return NextResponse.json({ stageId, from: from.toISOString(), to: to.toISOString(), events });
  } catch (error) {
    console.error("[KHL schedule]", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof KhlApiError ? error.message : "Failed to load KHL schedule." },
      { status: 502 }
    );
  }
}

function positiveDecimalId(value: string | null) {
  return value && /^[1-9]\d{0,127}$/.test(value) ? value : null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
