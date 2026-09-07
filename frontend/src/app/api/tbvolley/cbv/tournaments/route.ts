import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { searchCBVTournaments } from "@backend/sources/tbvolley/CBV";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchCBVTournaments({
      year: searchParams.get("year"),
      gender: searchParams.get("gender"),
      query: searchParams.get("query"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? safeErrorMessage(error) : "CBV tournament search failed.";
    logApiError("api:tbvolley/cbv/tournaments/route.ts", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
