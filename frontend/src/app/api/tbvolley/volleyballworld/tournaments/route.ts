import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import {
  getVolleyballWorldErrorCode,
  getVolleyballWorldErrorStatus,
  searchAllVolleyballWorldBeachTournaments,
  searchVolleyballWorldBeachTournaments,
} from "@backend/sources/tbvolley/VolleyballWorld";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sharedInput = {
      query: searchParams.get("query"),
      fromDate: searchParams.get("fromDate"),
      toDate: searchParams.get("toDate"),
      days: searchParams.get("days"),
    };
    const tournaments =
      searchParams.get("gender") === "all"
        ? await searchAllVolleyballWorldBeachTournaments(sharedInput)
        : await searchVolleyballWorldBeachTournaments({
            ...sharedInput,
            gender: searchParams.get("gender"),
          });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = safeErrorMessage(error, "Не удалось получить данные Volleyball World.");
    logApiError("api:tbvolley/volleyballworld/tournaments/route.ts", error);
    return NextResponse.json(
      { ok: false, error: message, errorCode: getVolleyballWorldErrorCode(error) },
      { status: getVolleyballWorldErrorStatus(error) },
    );
  }
}
