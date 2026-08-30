import { NextResponse } from "next/server";

import { prisma } from "@backend/db/db";
import { getKhlSettingsDirectory } from "@backend/results/khl/settingsDirectory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getKhlSettingsDirectory(prisma));
  } catch (error) {
    console.error("[KHL settings directory]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to load KHL settings." }, { status: 500 });
  }
}
