import { logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { queueIdentitySync } from "@backend/sync/identitySync";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  const { disciplineSlug, id } = await params;
  const slug = disciplineSlug.trim().toLowerCase();
  try {
    const body = await request.json();
    const { platformId } = body;

    const tournament = await prisma.tournament.update({
      where: { id: id },
      data: { platformId: platformId || null }
    });

    const identitySync = queueIdentitySync(`tournament-platform-id:${slug}`);
    return NextResponse.json({ tournament, identitySync });
  } catch (error) {
    logApiError("api:[disciplineSlug]/tournament/[id]/platform-id/route.ts", error);
    return NextResponse.json({ error: "Failed to save platformId" }, { status: 500 });
  }
}
