import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { searchTwelveNdrOevvTournaments } from "@backend/sources/tbvolley/TwelveNdr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchTwelveNdrOevvTournaments({
      season: searchParams.get("season") || searchParams.get("year"),
      gender: searchParams.get("gender"),
      query: searchParams.get("query"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? safeErrorMessage(error) : "12ndr ÖVV tournament search failed.";
    logApiError("api:tbvolley/twelvendroevv/tournaments/route.ts", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
