import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { khlSyncRunView } from "@backend/results/khl/syncQueue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return NextResponse.json({ error: "Invalid run ID." }, { status: 400 });
    const run = await prisma.khlSyncRun.findUnique({ where: { id } });
    return run ? NextResponse.json({ run: khlSyncRunView(run) })
      : NextResponse.json({ error: "KHL run not found." }, { status: 404 });
  } catch (error) {
    logApiError("api:khl/sync-status", error);
    return apiErrorResponse(error);
  }
}
