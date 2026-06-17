import { NextResponse } from "next/server";
import { requireAdmin } from "@backend/auth/adminAuth";
import {
  deleteProxyPoolByAction,
  listProxyPool,
  upsertProxyPoolFromText,
  type ProxyPoolAction,
} from "@backend/proxy/proxyPoolService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json(
      { proxies: await listProxyPool() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("[Proxy List API Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const { proxiesText } = await request.json();
    if (!proxiesText || typeof proxiesText !== "string") {
      return NextResponse.json({ error: "Необходим параметр proxiesText" }, { status: 400 });
    }

    const inserted = await upsertProxyPoolFromText(proxiesText);
    if (inserted === 0) {
      return NextResponse.json({ error: "Не удалось распарсить ни одного прокси" }, { status: 400 });
    }

    return NextResponse.json({ success: true, inserted });
  } catch (error: any) {
    console.error("[Proxy Bulk Upload Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const { action } = await request.json().catch(() => ({}));
    if (action !== "clear-blocked" && action !== "clear-all") {
      return NextResponse.json({ error: "Неверный параметр action" }, { status: 400 });
    }

    const deleted = await deleteProxyPoolByAction(action as ProxyPoolAction);
    return NextResponse.json({ success: true, count: deleted.count });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
