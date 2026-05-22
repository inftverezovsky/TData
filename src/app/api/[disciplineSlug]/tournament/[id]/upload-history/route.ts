import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/db';
import { requireAdmin } from '@/lib/auth/adminAuth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  const { disciplineSlug, id } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const logs = await prisma.adminUploadLog.findMany({
      where: {
        tournamentId: id,
        status: { in: ['success', 'success_like'] }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        phpArrayJson: true
      }
    });

    return NextResponse.json({ ok: true, logs });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
