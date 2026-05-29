import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { queueIdentitySync } from "@/lib/sync/identitySync";
import { parseAdminTeamImportRows } from "@/lib/adminTeams/importSpreadsheet";
import {
  getSpreadsheetSourceErrorStatus,
  readAdminTeamRowsFromSpreadsheetSource,
  toGoogleSheetsExportUrl,
} from "@/lib/adminTeams/spreadsheetSource";
import { runAutoMappingForDiscipline } from "@/lib/teams/mapping";
import { normalizeManualImportDisciplineId, resolveManualImportDisciplineSlug } from "@/lib/manualImport/config";

export { toGoogleSheetsExportUrl };

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const url = formData.get("url") as string;
    const disciplineSlug = resolveAdminTeamsImportDisciplineSlug({
      disciplineId: formData.get("disciplineId"),
      disciplineSlug: formData.get("disciplineSlug"),
    });
    if (!disciplineSlug) {
      return NextResponse.json({ error: "Укажите дисциплину или Sport ID перед импортом команд." }, { status: 400 });
    }

    const { rows: data, fileName } = await readAdminTeamRowsFromSpreadsheetSource({ file, url });

    const { layout, records, skippedCount } = parseAdminTeamImportRows(data);
    if (!layout) {
      return NextResponse.json(
        {
          error: "Could not determine ID and Name columns in the source sheet.",
        },
        { status: 400 }
      );
    }

    if (records.length === 0) {
      return NextResponse.json({ error: "No teams with IDs were found in the source sheet." }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.adminTeam.deleteMany({
        where: {
          disciplineSlug,
          sourceFileName: fileName,
        },
      }),
      prisma.adminTeam.createMany({
        data: records.map((record) => ({
          id: `admin_${disciplineSlug}_${record.platformId}`,
          disciplineSlug,
          platformId: record.platformId,
          platformName: record.platformName,
          platformNameRu: record.platformNameRu,
          platformNameEn: record.platformNameEn,
          normalizedName: record.normalizedName,
          normalizedNameRu: record.normalizedNameRu,
          normalizedNameEn: record.normalizedNameEn,
          sourceFileName: fileName,
        })),
        skipDuplicates: true,
      }),
    ]);

    // Run auto-mapping after import
    const mappingResult = await runAutoMappingForDiscipline(disciplineSlug);

    const identitySync = queueIdentitySync(`admin-teams:import:${disciplineSlug}`);

    return NextResponse.json({
      success: true,
      importedCount: records.length,
      skippedCount,
      detectedLayout: layout,
      targetKey: disciplineSlug,
      targetType: normalizeManualImportDisciplineId(disciplineSlug) ? "id" : "discipline",
      mappingResult,
      identitySync,
    });
  } catch (error: any) {
    const status = getSpreadsheetSourceErrorStatus(error);
    if (status >= 500) {
      console.error("Import error:", error);
    }
    return NextResponse.json({ error: error.message }, { status });
  }
}

export function resolveAdminTeamsImportDisciplineSlug(input: { disciplineId?: unknown; disciplineSlug?: unknown }) {
  const knownOrId = resolveManualImportDisciplineSlug(input);
  if (knownOrId) return knownOrId;

  return normalizeAdminTeamsImportScopeSlug(input.disciplineSlug) || null;
}

export function normalizeAdminTeamsImportScopeSlug(value: unknown) {
  const slug = typeof value === "string" || typeof value === "number"
    ? String(value).trim().toLowerCase().replace(/\s+/g, "-")
    : "";

  if (!slug) return "";
  if (normalizeManualImportDisciplineId(slug)) return slug;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{1,63}$/u.test(slug)) return "";
  return slug;
}
