import { NextResponse } from "next/server";
import { buildAdminServiceUrl } from "@/lib/adminUpload/adminServiceUrl";
import { toAdminFixtPayloadEnvelope } from "@/lib/adminUpload/fixtPayloadFormat";
import { resolvePublicOrigin } from "@/lib/http/publicOrigin";
import { putManualImportJson } from "@/lib/manualImport/cache";
import { buildManualFixtPayload } from "@/lib/manualImport/buildManualFixtPayload";
import { getManualImportDiscipline, resolveManualImportDisciplineSlug } from "@/lib/manualImport/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const body = await request.json().catch(() => ({}));
    const shapkaId = typeof body.shapkaId === "string" || typeof body.shapkaId === "number" ? String(body.shapkaId).trim() : "";
    const disciplineId = typeof body.disciplineId === "string" || typeof body.disciplineId === "number" ? String(body.disciplineId).trim() : "";
    const disciplineSlug = resolveManualImportDisciplineSlug({ disciplineId, disciplineSlug: body.disciplineSlug });
    const matches = Array.isArray(body.matches) ? body.matches : [];
    const publicOrigin = resolvePublicOrigin(request, body.publicOrigin);

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
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

    const token = putManualImportJson(toAdminFixtPayloadEnvelope(buildResult.payload));
    const jsonUrl = `${publicOrigin}/api/manual-import/json/${token}`;
    const serviceUrl = buildAdminServiceUrl(
      jsonUrl,
      process.env.ADMIN_SERVICE_URL || process.env.NEXT_PUBLIC_ADMIN_SERVICE_URL,
    );

    if (!serviceUrl) {
      return NextResponse.json(
        { ok: false, error: "Admin service URL is not configured." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      jsonUrl,
      serviceUrl,
      readyMatchesCount: buildResult.readyMatchesCount,
    });
  } catch (error) {
    console.error("[Manual Import Service Link] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual service link failed" },
      { status: 500 }
    );
  }
}
