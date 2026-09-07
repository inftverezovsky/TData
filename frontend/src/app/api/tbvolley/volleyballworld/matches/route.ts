import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import {
  fetchVolleyballWorldBeachSchedule,
  getVolleyballWorldErrorCode,
  getVolleyballWorldErrorStatus,
} from "@backend/sources/tbvolley/VolleyballWorld";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schedule = await fetchVolleyballWorldBeachSchedule({
      gender: searchParams.get("gender"),
      fromDate: searchParams.get("fromDate"),
      toDate: searchParams.get("toDate"),
      days: searchParams.get("days"),
    });

    return NextResponse.json(schedule);
  } catch (error) {
    const message = safeErrorMessage(error, "Не удалось получить данные Volleyball World.");
    logApiError("api:tbvolley/volleyballworld/matches/route.ts", error);
    return NextResponse.json(
      { ok: false, error: message, errorCode: getVolleyballWorldErrorCode(error) },
      { status: getVolleyballWorldErrorStatus(error) },
    );
  }
}
