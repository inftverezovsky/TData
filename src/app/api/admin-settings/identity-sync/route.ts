import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/adminAuth";
import {
  exportIdentitySnapshot,
  importIdentitySnapshot,
  verifyIdentitySyncRequest,
} from "@/lib/sync/identitySync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = await authorizeIdentitySync(request);
  if (unauthorized) return unauthorized;

  const snapshot = await exportIdentitySnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const unauthorized = await authorizeIdentitySync(request);
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
      { ok: false, error: error instanceof Error ? error.message : "Identity sync failed" },
      { status: 400 }
    );
  }
}

async function authorizeIdentitySync(request: Request) {
  if (verifyIdentitySyncRequest(request)) return null;
  return requireAdmin(request);
}
