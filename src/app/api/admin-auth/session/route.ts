import { NextResponse } from "next/server";
import { hasValidAdminSession } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(
    { authenticated: await hasValidAdminSession(request) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
