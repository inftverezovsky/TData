import { createAdminSessionResponse, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { verifyAdminCredential } from "@backend/auth/credentials";
import { clearLoginAttempts, reserveLoginAttempt } from "@backend/auth/loginRateLimit";
import { getClientRateLimitKey } from "@backend/http/clientIp";
import { apiErrorResponse, ApiRequestError, logApiError } from "@backend/http/apiResponse";
import { readJsonRequest } from "@backend/http/requestBody";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;
  try {
    // Резервируем попытку в общей БД до разбора тела и дорогой проверки пароля.
    const key = getClientRateLimitKey(request, "admin-login");
    const limit = await reserveLoginAttempt(key);
    if (!limit.allowed) {
      const response = apiErrorResponse(new ApiRequestError("RATE_LIMITED", 429, "Too many login attempts"));
      response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      return response;
    }
    const body = await readJsonRequest(request, 4096);
    const password = body && typeof body === "object" && "password" in body && typeof body.password === "string"
      ? body.password : "";
    const credential = await verifyAdminCredential(password);
    if (!credential) return apiErrorResponse(new ApiRequestError("INVALID_CREDENTIALS", 401, "Invalid password"));
    await clearLoginAttempts(key);
    return createAdminSessionResponse({ ok: true }, credential.sessionBinding);
  } catch (error) {
    if (!(error instanceof ApiRequestError)) logApiError("admin-login", error);
    return apiErrorResponse(error, "Authentication is temporarily unavailable.", 503);
  }
}
