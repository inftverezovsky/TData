import { NextResponse } from "next/server";
import { fetchVolleyballWorldBeachSchedule } from "@backend/sources/tbvolley/VolleyballWorld";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schedule = await fetchVolleyballWorldBeachSchedule({
      gender: searchParams.get("gender"),
      fromDate: searchParams.get("fromDate"),
      toDate: searchParams.get("toDate"),
      days: searchParams.get("days"),
    });

    return NextResponse.json(schedule);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Volleyball World request failed.";
    console.error("[TBvolley VolleyballWorld API] Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
