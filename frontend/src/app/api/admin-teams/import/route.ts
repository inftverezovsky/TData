import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { queueIdentitySync } from "@backend/sync/identitySync";
import { parseAdminTeamImportRows } from "@backend/adminTeams/importSpreadsheet";
import { invalidateAdminTeamSuggestCache } from "@backend/adminTeams/suggestCache";
import {
  getSpreadsheetSourceErrorStatus,
  readAdminTeamRowsFromSpreadsheetSource,
  toGoogleSheetsExportUrl,
} from "@backend/adminTeams/spreadsheetSource";
import { runAutoMappingForDiscipline } from "@backend/teams/mapping";
import { normalizeManualImportDisciplineId, resolveManualImportDisciplineSlug } from "@backend/manualImport/config";

export { toGoogleSheetsExportUrl };

export async function POST(request: Request) {
  // Открытый рабочий сценарий: доступность без сессии закреплена API-контрактом проекта.

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

    // Проверяем источник и размер, читаем Excel, определяем ID/имена команд по заголовкам или данным.
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

    // Заменяем команды данного источника атомарно: ошибка вставки откатывает и удаление старых строк.
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
    invalidateAdminTeamSuggestCache(disciplineSlug);

    // После успешной записи обновляем сопоставления и ставим синхронизацию идентификаторов в очередь.
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
  } catch (error: unknown) {
    // Ошибки источника объясняем пользователю, а внутренние детали сохраняем только как класс ошибки.
    const status = getSpreadsheetSourceErrorStatus(error);
    if (status >= 500) {
      logApiError("api:admin-teams/import/route.ts", error);
    }
    return NextResponse.json({
      error: status >= 500
        ? "Admin team import failed."
        : error instanceof Error ? safeErrorMessage(error) : "Invalid import request.",
    }, { status });
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
