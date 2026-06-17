import { NextResponse } from "next/server";
import { searchFedervolleyTournaments } from "@backend/sources/tbvolley/Federvolley";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchFedervolleyTournaments({
      year: searchParams.get("year"),
      gender: searchParams.get("gender"),
      category: searchParams.get("category"),
      query: searchParams.get("query"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Federvolley tournament search failed.";
    console.error("[TBvolley Federvolley tournaments API] Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
