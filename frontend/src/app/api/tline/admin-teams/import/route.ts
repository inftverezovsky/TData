import { logApiError } from "@backend/http/apiResponse";
import { apiError, requireTLineFormAccess, tlineErrorResponse } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const denied = await requireTLineFormAccess(request);
    if (denied) return denied;
    return apiError(
      "CHAMPIONSHIP_SCOPE_REQUIRED",
      "Выберите чемпионат и используйте его Shapka-scoped endpoint импорта.",
      410,
    );
  } catch (error) {
    logApiError("api:tline/admin-teams/import/route.ts", error);
    return tlineErrorResponse(error);
  }
}
