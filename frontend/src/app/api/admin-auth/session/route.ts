import { NextResponse } from "next/server";
import { hasValidAdminSession } from "@backend/auth/adminAuth";
import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      { authenticated: await hasValidAdminSession(request) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logApiError("admin-session", error);
    return apiErrorResponse(error, "Authentication is temporarily unavailable.", 503);
  }
}
