import { createConfiguredAdminLineAdapter } from "@backend/tline/admin/configuration";
import { TLineAdminConfigurationError } from "@backend/tline/admin/factory";
import { apiError, apiOk, requireTLineAccess } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const result = await createConfiguredAdminLineAdapter().testConnection();
    return apiOk({ ...result, configured: true, connected: result.ok, readOnly: true });
  } catch (error) {
    if (error instanceof TLineAdminConfigurationError) {
      return apiError(error.code, "The read-only Admin line adapter is not configured.", 503);
    }
    return apiError("ADMIN_CONNECTION_FAILED", "The read-only Admin connection check failed.", 502);
  }
}
