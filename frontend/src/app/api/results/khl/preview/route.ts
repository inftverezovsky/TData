import { logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";

import { requireAdmin } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { buildKhlAdminPreview } from "@backend/results/khl/preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const value = new URL(request.url).searchParams.get("khlGameId");
  if (!value || !/^[1-9]\d{0,127}$/.test(value)) {
    return NextResponse.json({ error: "khlGameId must be a positive decimal string." }, { status: 400 });
  }

  try {
    return NextResponse.json(await buildKhlAdminPreview(prisma, value));
  } catch (error) {
    logApiError("api:results/khl/preview/route.ts", error);
    return NextResponse.json({ error: "Failed to build KHL Admin preview." }, { status: 500 });
  }
}
