import { NextResponse } from 'next/server';
import { getAdminFixtPayloadHead, toAdminFixtPayloadEnvelope } from '@backend/adminUpload/fixtPayloadFormat';
import { phpSerialize } from '@backend/adminUpload/phpSerialize';
import { resolveAdminSettings } from '@backend/adminUpload/resolveAdminSettings';
import { sendFixtPayload } from '@backend/adminUpload/sendFixtPayload';
import { prisma } from '@backend/db/db';

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const { payload } = await request.json();
    const payloadHead = getAdminFixtPayloadHead(payload);
    
    if (!payloadHead) {
      return NextResponse.json({ ok: false, error: "Missing payload" }, { status: 400 });
    }

    // 1. Get settings
    const settings = await resolveAdminSettings('counterstrike');

    if (!settings.apiUrl) {
      return NextResponse.json({ ok: false, error: "Admin API URL is not configured." }, { status: 400 });
    }

    // 2. Serialize
    const adminPayload = toAdminFixtPayloadEnvelope(payload);
    const serialized = phpSerialize(adminPayload);

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
        adminShapkaId: payloadHead.shapka.toString(),
        requestMode: settings.requestMode,
        timezone: settings.timezone,
        dateFormat: settings.dateFormat,
        phpArrayJson: adminPayload as any,
        serializedFixt: serialized,
        readyMatchesCount: payloadHead.match.length,
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
