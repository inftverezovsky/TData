import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/db';
import { buildFixtPayload } from '@/lib/adminUpload/buildFixtPayload';
import { phpSerialize } from '@/lib/adminUpload/phpSerialize';
import { resolveAdminSettings } from '@/lib/adminUpload/resolveAdminSettings';
import { sendFixtPayload } from '@/lib/adminUpload/sendFixtPayload';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  const { disciplineSlug: routeDisciplineSlug, id } = await params;
  try {
    const body = await request.json();
    const disciplineSlug = routeDisciplineSlug;
    const selectedMatchIds = Array.isArray(body.selectedMatchIds)
      ? body.selectedMatchIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    const force = body.force === true;

    if (selectedMatchIds.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "Select at least one match before sending.",
      }, { status: 400 });
    }
    
    // 1. Get settings
    const settings = await resolveAdminSettings(disciplineSlug);

    if (!settings.apiUrl) {
      return NextResponse.json({ ok: false, error: "Admin API URL is not configured." }, { status: 400 });
    }

    // 2. Build payload
    const buildResult = await buildFixtPayload(id, disciplineSlug, selectedMatchIds);
    
    if (!buildResult.payload) {
      return NextResponse.json({ 
        ok: false, 
        error: "Payload is not ready. Check warnings and matched teams.",
        warnings: buildResult.warnings,
        skippedMatches: buildResult.skippedMatches
      }, { status: 400 });
    }

    const serialized = phpSerialize(buildResult.payload);
    const payloadHash = createHash('sha256').update(serialized).digest('hex');

    const uploadLogData = {
      disciplineSlug,
      tournamentId: id,
      apiUrl: settings.apiUrl,
      adminSportId: settings.adminSportId,
      adminMax: settings.adminMax,
      adminShapkaId: buildResult.payload.shapka.toString(),
      requestMode: settings.requestMode,
      timezone: settings.timezone,
      dateFormat: settings.dateFormat,
      phpArrayJson: buildResult.payload as any,
      serializedFixt: serialized,
      readyMatchesCount: buildResult.readyMatchesCount,
      skippedMatchesCount: buildResult.skippedMatches.length,
      skippedMatchesJson: buildResult.skippedMatches as any,
    };

    let uploadLogId: string | null = null;
    if (!force) {
      try {
        const pendingLog = await prisma.adminUploadLog.create({
          data: {
            ...uploadLogData,
            payloadHash,
            status: 'pending',
          },
          select: { id: true },
        });
        uploadLogId = pendingLog.id;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }

        const previousSend = await prisma.adminUploadLog.findFirst({
          where: {
            disciplineSlug,
            tournamentId: id,
            payloadHash,
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true, status: true },
        });

        if (previousSend?.status === 'failed') {
          await prisma.adminUploadLog.update({
            where: { id: previousSend.id },
            data: {
              ...uploadLogData,
              status: 'pending',
              responseRaw: null,
              errorMessage: null,
            },
          });
          uploadLogId = previousSend.id;
        } else {
          return NextResponse.json({
            ok: false,
            error: "This payload was already sent or is currently being sent. Use force option to override.",
            previousSend,
          }, { status: 409 });
        }
      }
    }

    // 3. Send payload
    const sendResult = await sendFixtPayload(
      settings.apiUrl,
      serialized,
      settings.requestMode,
      settings.sslVerify
    );

    if (uploadLogId) {
      await prisma.adminUploadLog.update({
        where: { id: uploadLogId },
        data: {
          responseRaw: sendResult.rawResponse,
          status: sendResult.status,
          errorMessage: sendResult.errorMessage,
        },
      });
    } else {
      await prisma.adminUploadLog.create({
        data: {
          ...uploadLogData,
          payloadHash: null,
          responseRaw: sendResult.rawResponse,
          status: sendResult.status,
          errorMessage: sendResult.errorMessage,
        },
      });
    }

    let markedMatchesCount = 0;
    if (sendResult.status === 'success_like' && buildResult.readyMatchIds.length > 0) {
      const updateResult = await prisma.tournamentMatch.updateMany({
        where: {
          id: { in: buildResult.readyMatchIds },
          tournamentId: id,
        },
        data: { syncedAt: new Date() },
      });
      markedMatchesCount = updateResult.count;
    }

    return NextResponse.json({
      ok: sendResult.status !== 'failed',
      status: sendResult.status,
      markedMatchesCount,
      rawResponse: sendResult.rawResponse,
      errorMessage: sendResult.errorMessage,
      error: sendResult.status === 'failed' ? (sendResult.errorMessage || "Ошибка при отправке данных в платформу") : undefined
    });
  } catch (error: any) {
    console.error('Send error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
