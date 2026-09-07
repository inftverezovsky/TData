import { safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { classifyParserError } from "@backend/proxy/parserErrors";
import { runVlrScraper } from "@backend/sources/tdata/vlr/scraper";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await runVlrScraper("health");
    return NextResponse.json({ ok: true, title: data.title || "VLR" });
  } catch (error: any) {
    const errorClass = classifyParserError({ message: safeErrorMessage(error) });
    return NextResponse.json({ ok: false, error: safeErrorMessage(error), errorClass }, { status: 500 });
  }
}
