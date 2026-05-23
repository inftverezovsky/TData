import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { getManualImportDiscipline } from "@/lib/manualImport/config";
import { normalizeAdminSportId, saveManualImportTeamMappings } from "@/lib/manualImport/teamMappings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const disciplineSlug = typeof body.disciplineSlug === "string" ? body.disciplineSlug.trim().toLowerCase() : "";
    const disciplineId = normalizeAdminSportId(body.disciplineId);
    const matches = Array.isArray(body.matches) ? body.matches : [];
    const overwriteConflicts = Boolean(body.overwriteConflicts);

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    if (!disciplineId) {
      return NextResponse.json({ ok: false, error: "ID дисциплины должен быть положительным числом." }, { status: 400 });
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
