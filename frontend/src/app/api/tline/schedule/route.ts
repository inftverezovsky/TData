import { logApiError } from "@backend/http/apiResponse";
import { prisma } from "@backend/db/db";
import { getTLineScheduleView, parseScheduleSlots, updateTLineSchedule } from "@backend/tline/application/scheduleState";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalBoolean } from "@backend/tline/api/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const denied = await requireTLineAccess(request);
    if (denied) return denied;
    return apiOk(await getTLineScheduleView(prisma));
  } catch (error) {
    logApiError("api:tline/schedule/route.ts", error);
    return tlineErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const body = objectBody(await readJsonBody(request));
    const result = await updateTLineSchedule(prisma, {
      enabled: optionalBoolean(body, "enabled"),
      slotHours: body.slots === undefined ? undefined : parseScheduleSlots(body.slots),
    });
    return apiOk(result);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
