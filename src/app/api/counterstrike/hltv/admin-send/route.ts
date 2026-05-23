import { NextResponse } from 'next/server';
import { phpSerialize } from '@/lib/adminUpload/phpSerialize';
import { resolveAdminSettings } from '@/lib/adminUpload/resolveAdminSettings';
import { sendFixtPayload } from '@/lib/adminUpload/sendFixtPayload';
import { requireAdmin } from '@/lib/auth/adminAuth';
import { prisma } from '@/lib/db/db';

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const { payload } = await request.json();
    
    if (!payload) {
      return NextResponse.json({ ok: false, error: "Missing payload" }, { status: 400 });
    }

    // 1. Get settings
    const settings = await resolveAdminSettings('counterstrike');

    if (!settings.apiUrl) {
      return NextResponse.json({ ok: false, error: "Admin API URL is not configured." }, { status: 400 });
    }

    // 2. Serialize
    const serialized = phpSerialize(payload);

    const existingSuccessfulSend = await prisma.adminUploadLog.findFirst({
      where: {
        disciplineSlug: 'counterstrike',
        tournamentId: 'hltv-manual',
        serializedFixt: serialized,
        status: { in: ['success', 'success_like'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, status: true },
    });

    if (existingSuccessfulSend) {
      return NextResponse.json({
        ok: false,
        error: "This payload was already sent successfully.",
        previousSend: existingSuccessfulSend,
      }, { status: 409 });
    }

    // 3. Send
    const sendResult = await sendFixtPayload(
      settings.apiUrl,
      serialized,
      settings.requestMode,
      settings.sslVerify
    );

    // 4. Log the attempt
    await prisma.adminUploadLog.create({
      data: {
        disciplineSlug: 'counterstrike',
        tournamentId: 'hltv-manual',
        apiUrl: settings.apiUrl,
        adminSportId: settings.adminSportId,
        adminMax: settings.adminMax,
        adminShapkaId: payload.shapka.toString(),
        requestMode: settings.requestMode,
        timezone: settings.timezone,
        dateFormat: settings.dateFormat,
        phpArrayJson: payload as any,
        serializedFixt: serialized,
        readyMatchesCount: payload.match.length,
        skippedMatchesCount: 0,
        skippedMatchesJson: [] as any,
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
    console.error('[HLTV Admin Send] Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
