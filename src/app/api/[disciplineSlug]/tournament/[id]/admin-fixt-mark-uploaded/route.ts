import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/adminAuth';
import { prisma } from '@/lib/db/db';
import { buildFixtPayload } from '@/lib/adminUpload/buildFixtPayload';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  const { disciplineSlug, id } = await params;

  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();
    if (body.confirmed !== true) {
      return NextResponse.json({
        ok: false,
        error: 'Подтвердите отметку выбранных матчей.',
      }, { status: 400 });
    }

    const selectedMatchIds = Array.isArray(body.selectedMatchIds)
      ? body.selectedMatchIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];

    if (selectedMatchIds.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Выберите матчи для отметки.',
      }, { status: 400 });
    }

    const buildResult = await buildFixtPayload(id, disciplineSlug, selectedMatchIds);

    if (!buildResult.payload) {
      return NextResponse.json({
        ok: false,
        error: 'Нет готовых матчей для отметки.',
        warnings: buildResult.warnings,
        skippedMatches: buildResult.skippedMatches,
      }, { status: 400 });
    }

    if (buildResult.readyMatchIds.length === 0) {
      return NextResponse.json({
        ok: true,
        markedMatchesCount: 0,
        readyMatchesCount: buildResult.readyMatchesCount,
        warnings: buildResult.warnings,
        skippedMatches: buildResult.skippedMatches,
      });
    }

    const updateResult = await prisma.tournamentMatch.updateMany({
      where: {
        id: { in: buildResult.readyMatchIds },
        tournamentId: id,
      },
      data: { syncedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      markedMatchesCount: updateResult.count,
      readyMatchesCount: buildResult.readyMatchesCount,
      warnings: buildResult.warnings,
      skippedMatches: buildResult.skippedMatches,
    });
  } catch (error: any) {
    console.error('Mark uploaded error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
