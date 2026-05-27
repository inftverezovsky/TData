import { NextResponse } from "next/server";
import {
  deleteProxyPoolByAction,
  deleteProxyPoolById,
  listProxyPool,
  upsertProxyPoolFromText,
} from "@/lib/proxy/proxyPoolService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  return NextResponse.json(
    { proxies: await listProxyPool() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

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
}
