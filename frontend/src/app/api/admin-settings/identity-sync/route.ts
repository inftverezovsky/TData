import { apiErrorResponse, logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import {
  exportIdentitySnapshot,
  importIdentitySnapshot,
  verifyIdentitySyncRequest,
} from "@backend/sync/identitySync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const unauthorized = await authorizeIdentitySync(request);
    if (unauthorized) return unauthorized;

    const snapshot = await exportIdentitySnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logApiError("api:admin-settings/identity-sync/route.ts", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = await authorizeIdentitySync(request, true);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const snapshot = body?.snapshot || body;
    const counts = await importIdentitySnapshot(snapshot);

    return NextResponse.json({
      ok: true,
      counts,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? safeErrorMessage(error) : "Identity sync failed" },
      { status: 400 }
    );
  }
}

async function authorizeIdentitySync(request: Request, mutation = false) {
  // Сервисный bearer-token не использует browser cookies; сессия браузера дополнительно требует Origin.
  if (verifyIdentitySyncRequest(request)) return null;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  return mutation ? requireSameOriginJsonMutation(request) : null;
}
