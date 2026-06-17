import { NextResponse } from "next/server";
import { APP_BUILD_INFO } from "@backend/config/buildInfo";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "tdata",
    build: {
      marker: process.env.TDATA_BUILD_MARKER || APP_BUILD_INFO.marker,
      sourceRevision: process.env.TDATA_GIT_SHA || APP_BUILD_INFO.sourceRevision,
    },
    timestamp: new Date().toISOString(),
  });
}
