import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { createAdminLogoutResponse, requireSameOriginRequest } from "@backend/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const forbidden = requireSameOriginRequest(request);
    if (forbidden) return forbidden;
    return createAdminLogoutResponse();
  } catch (error) {
    logApiError("api:admin-auth/logout/route.ts", error);
    return apiErrorResponse(error);
  }
}
