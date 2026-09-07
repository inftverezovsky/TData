import { apiErrorResponse, logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { requireAdmin, requireSameOriginJsonMutation, requireSameOriginRequest } from "@backend/auth/adminAuth";
import {
  deleteProxyPoolByAction,
  deleteProxyPoolById,
  listProxyPool,
  upsertProxyPoolFromText,
} from "@backend/proxy/proxyPoolService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    return NextResponse.json(
      { proxies: await listProxyPool() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logApiError("api:admin-settings/proxy-pool/route.ts", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  // Не читаем список прокси, пока не подтверждены сессия, origin и формат запроса.
  const unsafeMutation = requireSameOriginJsonMutation(request);
  if (unsafeMutation) return unsafeMutation;

  try {
    const { urls } = await request.json();
    if (!urls) return NextResponse.json({ error: "URLs are required" }, { status: 400 });

    const rawText = typeof urls === "string"
      ? urls
      : Array.isArray(urls) ? urls.join("\n") : "";
    const count = await upsertProxyPoolFromText(rawText);

    if (count === 0) {
      return NextResponse.json({ error: "No valid URLs found" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, count });
  } catch (error: any) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;
    // DELETE с query-параметрами не требует тела, но обязан происходить с origin приложения.
    const forbidden = requireSameOriginRequest(request);
    if (forbidden) return forbidden;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const all = searchParams.get("all") === "true";

    if (all) {
      const deleted = await deleteProxyPoolByAction("clear-all");
      return NextResponse.json({ ok: true, count: deleted.count });
    }

    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    await deleteProxyPoolById(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logApiError("api:admin-settings/proxy-pool/route.ts", error);
    return apiErrorResponse(error);
  }
}
