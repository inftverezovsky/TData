import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from 'next/server';
import { prisma } from '@backend/db/db';
import { buildFixtPayload } from '@backend/adminUpload/buildFixtPayload';
import { normalizeShapkaOverrides } from '@backend/adminUpload/shapkaOverrides';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  const { disciplineSlug, id } = await params;

  try {
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
    const shapkaIdBySelectionId = normalizeShapkaOverrides(body.shapkaIdBySelectionId);

    if (selectedMatchIds.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Выберите матчи для отметки.',
      }, { status: 400 });
    }

    const buildResult = await buildFixtPayload(id, disciplineSlug, selectedMatchIds, shapkaIdBySelectionId);

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
    logApiError("api:[disciplineSlug]/tournament/[id]/admin-fixt-mark-uploaded/route.ts", error);
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}
