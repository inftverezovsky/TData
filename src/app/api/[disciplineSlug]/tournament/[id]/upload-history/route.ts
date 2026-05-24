import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  const { disciplineSlug, id } = await params;
  try {
    const logs = await prisma.adminUploadLog.findMany({
      where: {
        disciplineSlug,
        tournamentId: id,
        status: { in: ['success', 'success_like'] }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        readyMatchesCount: true,
        skippedMatchesCount: true,
        status: true,
      }
    });

    return NextResponse.json({ ok: true, logs });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
