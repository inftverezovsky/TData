import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { APP_BUILD_INFO } from "@backend/config/buildInfo";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      app: "tdata",
      build: {
        marker: process.env.TDATA_BUILD_MARKER || APP_BUILD_INFO.marker,
        sourceRevision: process.env.TDATA_GIT_SHA || APP_BUILD_INFO.sourceRevision,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logApiError("api:health/route.ts", error);
    return apiErrorResponse(error);
  }
}
