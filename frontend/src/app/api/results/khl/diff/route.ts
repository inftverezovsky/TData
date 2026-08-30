import { NextResponse } from "next/server";

import { requireAdmin } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { buildKhlAdminDeliveryDiff } from "@backend/results/khl/diff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const raw = new URL(request.url).searchParams.get("khlGameId");
  const khlGameId = raw && /^[1-9]\d{0,127}$/.test(raw) ? raw : null;
  if (!khlGameId) {
    return NextResponse.json(
      { error: "khlGameId must be a positive decimal string." },
      { status: 400 }
    );
  }

  const diff = await buildKhlAdminDeliveryDiff(prisma, khlGameId);
  return NextResponse.json(diff);
}
