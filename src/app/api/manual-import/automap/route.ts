import { NextResponse } from "next/server";
import { mapManualMatches } from "@/lib/manualImport/buildManualFixtPayload";
import { getManualImportDiscipline, resolveManualImportDisciplineSlug } from "@/lib/manualImport/config";
import { normalizeAdminSportId, saveManualImportTeamMappings } from "@/lib/manualImport/teamMappings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const body = await request.json().catch(() => ({}));
    const disciplineId = typeof body.disciplineId === "string" || typeof body.disciplineId === "number" ? String(body.disciplineId).trim() : "";
    const disciplineSlug = resolveManualImportDisciplineSlug({ disciplineId, disciplineSlug: body.disciplineSlug });
    const matches = Array.isArray(body.matches) ? body.matches : [];

    if (!normalizeAdminSportId(disciplineId)) {
      return NextResponse.json(
        { ok: false, error: "Укажите ID дисциплины, чтобы сохранить привязки команд." },
        { status: 400 }
      );
    }

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    const mappedMatches = await mapManualMatches(matches, disciplineSlug, disciplineId);
    const readyMatchesCount = mappedMatches.filter((match) => match.isReady).length;
    const saveResult = await saveManualImportTeamMappings({
      disciplineSlug,
      adminSportId: disciplineId,
      matches: mappedMatches.map((match) => ({
        team1: match.team1.name,
        team1PlatformId: match.team1.platformId || "",
        team2: match.team2.name,
        team2PlatformId: match.team2.platformId || "",
      })),
      overwriteConflicts: false,
    });

    return NextResponse.json({
      ok: true,
      mappedMatches,
      readyMatchesCount,
      savedCount: saveResult.savedCount,
      skippedCount: saveResult.skippedCount,
      conflictCount: saveResult.conflictCount,
      overwrittenCount: saveResult.overwrittenCount,
      conflicts: saveResult.conflicts,
      savedMappings: saveResult.savedMappings,
    });
  } catch (error) {
    console.error("[Manual Import Automap] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual auto-map failed" },
      { status: 500 }
    );
  }
}
