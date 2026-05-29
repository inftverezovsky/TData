import { NextResponse } from "next/server";
import { searchBeachVolleyRuTournaments } from "@/lib/sources/tbvolley/beach.volley.ru";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournaments = await searchBeachVolleyRuTournaments({
      year: searchParams.get("year"),
      gender: searchParams.get("gender"),
      kind: searchParams.get("kind"),
      query: searchParams.get("query"),
    });

    return NextResponse.json(tournaments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "beach.volley.ru tournament search failed.";
    console.error("[TBvolley beach.volley.ru tournaments API] Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
