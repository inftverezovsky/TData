import { logApiError } from "@backend/http/apiResponse";
import { getAdminLineConfiguration } from "@backend/tline/admin/configuration";
import { apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const denied = await requireTLineAccess(request);
    if (denied) return denied;
    const configuration = getAdminLineConfiguration();
    return apiOk({
      configured: configuration.configured,
      connected: false,
      mode: configuration.mode,
      readOnly: true,
    });
  } catch (error) {
    logApiError("api:tline/admin-connection/status/route.ts", error);
    return tlineErrorResponse(error);
  }
}
