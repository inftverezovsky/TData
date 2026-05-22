import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/db';
import { buildFixtPayload } from '@/lib/adminUpload/buildFixtPayload';
import { phpSerialize } from '@/lib/adminUpload/phpSerialize';
import { resolveAdminSettings } from '@/lib/adminUpload/resolveAdminSettings';
import { sendFixtPayload } from '@/lib/adminUpload/sendFixtPayload';
import { requireAdmin } from '@/lib/auth/adminAuth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  const { disciplineSlug: routeDisciplineSlug, id } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const disciplineSlug = routeDisciplineSlug;
    const selectedMatchIds = body.selectedMatchIds;
    const force = body.force || false;
    
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

    if (!force) {
      const existingSuccessfulSend = await prisma.adminUploadLog.findFirst({
        where: {
          disciplineSlug,
          tournamentId: id,
          serializedFixt: serialized,
          status: { in: ['success', 'success_like'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, status: true },
      });

      if (existingSuccessfulSend) {
        return NextResponse.json({
          ok: false,
          error: "This payload was already sent successfully. Use force option to override.",
          previousSend: existingSuccessfulSend,
        }, { status: 409 });
      }
    }

    // 3. Send payload
    const sendResult = await sendFixtPayload(
      settings.apiUrl,
      serialized,
      settings.requestMode,
      settings.sslVerify
    );

    // 4. Log the attempt
    await prisma.adminUploadLog.create({
      data: {
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
        responseRaw: sendResult.rawResponse,
        status: sendResult.status,
        errorMessage: sendResult.errorMessage,
      },
    });

    return NextResponse.json({
      ok: sendResult.status !== 'failed',
      status: sendResult.status,
      rawResponse: sendResult.rawResponse,
      errorMessage: sendResult.errorMessage,
      error: sendResult.status === 'failed' ? (sendResult.errorMessage || "Ошибка при отправке данных в платформу") : undefined
    });
  } catch (error: any) {
    console.error('Send error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
