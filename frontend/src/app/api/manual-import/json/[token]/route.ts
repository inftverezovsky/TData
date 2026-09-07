import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { toAdminFixtPayloadEnvelope } from "@backend/adminUpload/fixtPayloadFormat";
import { getManualImportJson } from "@backend/manualImport/cache";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const payload = getManualImportJson(token);

    if (!payload) {
      return NextResponse.json({ error: "Manual import JSON expired or not found" }, { status: 404 });
    }

    return NextResponse.json(toAdminFixtPayloadEnvelope(payload as any), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logApiError("api:manual-import/json/[token]/route.ts", error);
    return apiErrorResponse(error);
  }
}
