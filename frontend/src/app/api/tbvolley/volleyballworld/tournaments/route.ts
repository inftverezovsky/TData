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
    const tournaments = searchParams.get("gender") === "all"
      ? await searchAllVolleyballWorldBeachTournaments(sharedInput)
      : await searchVolleyballWorldBeachTournaments({
          ...sharedInput,
          gender: searchParams.get("gender"),
        });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Volleyball World tournament search failed.";
    console.error("[TBvolley VolleyballWorld tournaments API] Error:", error);
    return NextResponse.json(
      { ok: false, error: message, errorCode: getVolleyballWorldErrorCode(error) },
      { status: getVolleyballWorldErrorStatus(error) },
    );
  }
}
