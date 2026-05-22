import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { queueIdentitySync } from "@/lib/sync/identitySync";
import { requireAdmin } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  const { disciplineSlug, id } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

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
    console.error(error);
    return NextResponse.json({ error: "Failed to save platformId" }, { status: 500 });
  }
}
