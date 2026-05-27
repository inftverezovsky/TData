import { NextResponse } from "next/server";
import { getManualImportDiscipline, resolveManualImportDisciplineSlug } from "@/lib/manualImport/config";
import {
  normalizeAdminSportId,
  saveManualImportSingleTeamMapping,
  saveManualImportTeamMappings,
} from "@/lib/manualImport/teamMappings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const body = await request.json().catch(() => ({}));
    const disciplineId = normalizeAdminSportId(body.disciplineId);
    const disciplineSlug = resolveManualImportDisciplineSlug({ disciplineId, disciplineSlug: body.disciplineSlug });
    const matches = Array.isArray(body.matches) ? body.matches : [];
    const overwriteConflicts = Boolean(body.overwriteConflicts);

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    if (!disciplineId) {
      return NextResponse.json({ ok: false, error: "ID дисциплины должен быть положительным числом." }, { status: 400 });
    }

    const isSingleSave = "teamName" in body || "platformId" in body;
    if (isSingleSave) {
      const result = await saveManualImportSingleTeamMapping({
        disciplineSlug,
        adminSportId: disciplineId,
        teamName: typeof body.teamName === "string" || typeof body.teamName === "number" ? String(body.teamName) : "",
        platformId: typeof body.platformId === "string" || typeof body.platformId === "number" ? String(body.platformId) : "",
        canonicalName:
          typeof body.canonicalName === "string" || typeof body.canonicalName === "number"
            ? String(body.canonicalName)
            : "",
        overwriteConflict: Boolean(body.overwriteConflict || body.overwriteConflicts),
      });

      return NextResponse.json({
        ok: true,
        ...result,
        savedMapping: result.savedMappings[0] || null,
      });
    }

    const result = await saveManualImportTeamMappings({
      disciplineSlug,
      adminSportId: disciplineId,
      matches,
      overwriteConflicts,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("[Manual Import Team Mappings] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual team mappings save failed" },
      { status: 500 }
    );
  }
}
