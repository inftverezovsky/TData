import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { prisma } from "@/lib/db/db";
import { getOrCreateDiscipline } from "@/lib/config/disciplines";
import { queueIdentitySync } from "@/lib/sync/identitySync";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const slug = disciplineSlug.trim().toLowerCase();
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const discipline = await getOrCreateDiscipline(slug);
    return NextResponse.json({ platformId: discipline.platformId || "" });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch discipline" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const slug = disciplineSlug.trim().toLowerCase();
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const { platformId } = await request.json();
    const discipline = await getOrCreateDiscipline(slug);
    
    await prisma.discipline.update({
      where: { id: discipline.id },
      data: { platformId: platformId || null }
    });
    
    const identitySync = queueIdentitySync(`discipline-platform-id:${slug}`);
    return NextResponse.json({ success: true, identitySync });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update discipline" }, { status: 500 });
  }
}
