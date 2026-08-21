import { NextResponse } from "next/server";

import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  KhlBindingConflictError,
  confirmKhlTeamBinding,
} from "@backend/results/khl/bindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  try {
    const team = await confirmKhlTeamBinding(prisma, {
      khlTeamId: body.khlTeamId as string,
      adminTeamId: body.adminTeamId as string,
      confirmedBy: "admin-session",
    });
    return NextResponse.json({ team });
  } catch (error) {
    if (error instanceof KhlBindingConflictError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "TEAM_NOT_FOUND" ? 404 : error.code === "INVALID_BINDING" ? 400 : 409 }
      );
    }
    console.error("[KHL team binding]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save KHL team binding." }, { status: 500 });
  }
}

async function readBody(request: Request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
