import { NextResponse } from "next/server";
import { searchGermanBeachTourTournaments } from "@/lib/sources/tbvolley/GermanBeachTour";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchGermanBeachTourTournaments({
      year: searchParams.get("year"),
      gender: searchParams.get("gender"),
      query: searchParams.get("query"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "German Beach Tour tournament search failed.";
    console.error("[TBvolley German Beach Tour tournaments API] Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
