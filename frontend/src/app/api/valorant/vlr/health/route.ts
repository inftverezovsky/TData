import { NextResponse } from "next/server";
import { classifyParserError } from "@backend/proxy/parserErrors";
import { runVlrScraper } from "@backend/sources/tdata/vlr/scraper";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await runVlrScraper("health");
    return NextResponse.json({ ok: true, title: data.title || "VLR" });
  } catch (error: any) {
    const errorClass = classifyParserError({ message: error.message });
    return NextResponse.json({ ok: false, error: error.message, errorClass }, { status: 500 });
  }
}
