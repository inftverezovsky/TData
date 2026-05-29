import { NextResponse } from "next/server";
import { toAdminFixtPayloadEnvelope } from "@/lib/adminUpload/fixtPayloadFormat";
import { phpSerialize } from "@/lib/adminUpload/phpSerialize";
import { resolveAdminSettings } from "@/lib/adminUpload/resolveAdminSettings";
import { sendFixtPayload } from "@/lib/adminUpload/sendFixtPayload";
import { prisma } from "@/lib/db/db";
import { buildManualFixtPayload } from "@/lib/manualImport/buildManualFixtPayload";
import { getManualImportDiscipline, MANUAL_IMPORT_TOURNAMENT_ID, resolveManualImportDisciplineSlug } from "@/lib/manualImport/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const body = await request.json().catch(() => ({}));
    const shapkaId = typeof body.shapkaId === "string" || typeof body.shapkaId === "number" ? String(body.shapkaId).trim() : "";
    const disciplineId = typeof body.disciplineId === "string" || typeof body.disciplineId === "number" ? String(body.disciplineId).trim() : "";
    const disciplineSlug = resolveManualImportDisciplineSlug({ disciplineId, disciplineSlug: body.disciplineSlug });
    const matches = Array.isArray(body.matches) ? body.matches : [];
    const force = Boolean(body.force);

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    const settings = await resolveAdminSettings(disciplineSlug);
    if (!settings.apiUrl) {
      return NextResponse.json({ ok: false, error: "Admin API URL is not configured." }, { status: 400 });
    }

    const buildResult = await buildManualFixtPayload({
      matches,
      disciplineSlug,
      shapkaId,
      disciplineId,
    });

    if (!buildResult.payload) {
      return NextResponse.json(
        {
          ok: false,
          error: "Payload is not ready. Check warnings and matched teams.",
          warnings: buildResult.warnings,
          skippedMatches: buildResult.skippedMatches,
        },
        { status: 400 }
      );
    }

    const adminPayload = toAdminFixtPayloadEnvelope(buildResult.payload);
    const serialized = phpSerialize(adminPayload);

    if (!force) {
      const existingSuccessfulSend = await prisma.adminUploadLog.findFirst({
        where: {
          disciplineSlug,
          tournamentId: MANUAL_IMPORT_TOURNAMENT_ID,
          serializedFixt: serialized,
          status: { in: ["success", "success_like"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, status: true },
      });

      if (existingSuccessfulSend) {
        return NextResponse.json(
          {
            ok: false,
            error: "This payload was already sent successfully. Use force option to override.",
            previousSend: existingSuccessfulSend,
          },
          { status: 409 }
        );
      }
    }

    const sendResult = await sendFixtPayload(
      settings.apiUrl,
      serialized,
      settings.requestMode,
      settings.sslVerify
    );

    await prisma.adminUploadLog.create({
      data: {
        disciplineSlug,
        tournamentId: MANUAL_IMPORT_TOURNAMENT_ID,
        apiUrl: settings.apiUrl,
        adminSportId: String(buildResult.payload.sport),
        adminMax: String(buildResult.payload.max),
        adminShapkaId: String(buildResult.payload.shapka),
        requestMode: settings.requestMode,
        timezone: settings.timezone,
        dateFormat: settings.dateFormat,
        phpArrayJson: adminPayload as any,
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
      ok: sendResult.status !== "failed",
      status: sendResult.status,
      rawResponse: sendResult.rawResponse,
      errorMessage: sendResult.errorMessage,
      error: sendResult.status === "failed" ? sendResult.errorMessage || "Ошибка при отправке данных в платформу" : undefined,
    });
  } catch (error) {
    console.error("[Manual Import Send] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual send failed" },
      { status: 500 }
    );
  }
}
