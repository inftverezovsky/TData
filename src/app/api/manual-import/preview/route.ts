import { NextResponse } from "next/server";
import { phpSerialize } from "@/lib/adminUpload/phpSerialize";
import { toPhpString } from "@/lib/adminUpload/utils";
import { buildManualFixtPayload } from "@/lib/manualImport/buildManualFixtPayload";
import { getManualImportDiscipline, resolveManualImportDisciplineSlug } from "@/lib/manualImport/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const shapkaId = typeof body.shapkaId === "string" || typeof body.shapkaId === "number" ? String(body.shapkaId).trim() : "";
    const disciplineId = typeof body.disciplineId === "string" || typeof body.disciplineId === "number" ? String(body.disciplineId).trim() : "";
    const disciplineSlug = resolveManualImportDisciplineSlug({ disciplineId, disciplineSlug: body.disciplineSlug });
    const matches = Array.isArray(body.matches) ? body.matches : [];

    const discipline = getManualImportDiscipline(disciplineSlug);
    if (!discipline) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    const buildResult = await buildManualFixtPayload({
      matches,
      disciplineSlug,
      shapkaId,
      disciplineId,
    });

    const serialized = buildResult.payload ? phpSerialize(buildResult.payload) : "";
    const phpArrayText = buildResult.payload ? toPhpString(buildResult.payload) : "";

    return NextResponse.json({
      ok: true,
      discipline,
      phpArray: buildResult.payload,
      phpArrayText,
      serialized,
      postBody: serialized ? `fixt=${serialized}` : "",
      readyMatchesCount: buildResult.readyMatchesCount,
      skippedMatches: buildResult.skippedMatches,
      warnings: buildResult.warnings,
      mappedMatches: buildResult.mappedMatches,
    });
  } catch (error) {
    console.error("[Manual Import Preview] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual preview failed" },
      { status: 500 }
    );
  }
}
