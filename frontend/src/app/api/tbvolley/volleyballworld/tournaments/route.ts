import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { searchVolleyballWorldBeachTournaments } from "@backend/sources/tbvolley/VolleyballWorld";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchVolleyballWorldBeachTournaments({
      gender: searchParams.get("gender"),
      query: searchParams.get("query"),
      fromDate: searchParams.get("fromDate"),
      toDate: searchParams.get("toDate"),
      days: searchParams.get("days"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? safeErrorMessage(error) : "Volleyball World tournament search failed.";
    logApiError("api:tbvolley/volleyballworld/tournaments/route.ts", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
