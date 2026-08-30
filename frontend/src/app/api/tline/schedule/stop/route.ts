import { prisma } from "@backend/db/db";
import { stopTLineSchedule } from "@backend/tline/application/scheduleState";
import { apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    return apiOk(await stopTLineSchedule(prisma));
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
