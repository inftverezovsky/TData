import { NextResponse } from "next/server";
import { APP_BUILD_INFO } from "@/lib/config/buildInfo";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "tcyber",
    build: {
      marker: process.env.TCYBER_BUILD_MARKER || APP_BUILD_INFO.marker,
      sourceRevision: process.env.TCYBER_GIT_SHA || APP_BUILD_INFO.sourceRevision,
    },
    timestamp: new Date().toISOString(),
  });
}
