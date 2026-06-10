import { NextResponse } from "next/server";
import { searchTwelveNdrCsvpTournaments } from "@/lib/sources/tbvolley/TwelveNdr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchTwelveNdrCsvpTournaments({
      season: searchParams.get("season") || searchParams.get("year"),
      gender: searchParams.get("gender"),
      query: searchParams.get("query"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "12ndr CSVP tournament search failed.";
    console.error("[TBvolley 12ndr CSVP tournaments API] Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
