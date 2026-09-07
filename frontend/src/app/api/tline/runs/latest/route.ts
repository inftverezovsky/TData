import { logApiError } from "@backend/http/apiResponse";
import { prisma } from "@backend/db/db";
import { findLatestTLineRunView } from "@backend/tline/application/runViews";
import { apiError, apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const denied = await requireTLineAccess(request);
    if (denied) return denied;
    const sportId = new URL(request.url).searchParams.get("sportId")?.trim();
    if (!sportId) return apiError("SPORT_REQUIRED", "sportId is required.", 400);
    return apiOk(await findLatestTLineRunView(prisma, sportId));
  } catch (error) {
    logApiError("api:tline/runs/latest/route.ts", error);
    return tlineErrorResponse(error);
  }
}
