import { logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";

import { requireAdmin } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { getKhlSettingsDirectory } from "@backend/results/khl/settingsDirectory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json(await getKhlSettingsDirectory(prisma));
  } catch (error) {
    logApiError("api:results/khl/settings/route.ts", error);
    return NextResponse.json({ error: "Failed to load KHL settings." }, { status: 500 });
  }
}
