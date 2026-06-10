import { NextResponse } from "next/server";
import { searchWttTournaments } from "@/lib/sources/tablet/WTT";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchWttTournaments({
      query: searchParams.get("query"),
      fromDate: searchParams.get("fromDate"),
      toDate: searchParams.get("toDate"),
      days: searchParams.get("days"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "WTT tournament search failed.";
    console.error("[TableT WTT tournaments API] Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
