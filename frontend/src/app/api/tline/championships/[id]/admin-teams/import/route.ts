import { parseAdminTeamImportRows } from "@backend/adminTeams/importSpreadsheet";
import {
  getSpreadsheetSourceErrorStatus,
  readAdminTeamRowsFromSpreadsheetSource,
} from "@backend/adminTeams/spreadsheetSource";
import { prisma } from "@backend/db/db";
import { importTLineAdminDirectory } from "@backend/tline/admin/directory";
import { apiError, apiOk, requireTLineFormAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { parseId } from "@backend/tline/api/parsers";
import { TLineValidationError } from "@backend/tline/api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const denied = await requireTLineFormAccess(request);
  if (denied) return denied;
  try {
    const formData = await request.formData();
    const fileValue = formData.get("file");
    const urlValue = formData.get("url");
    const file = fileValue instanceof File ? fileValue : undefined;
    if (file && !/\.xlsx$/i.test(file.name)) {
      throw new TLineValidationError("INVALID_TEAM_TABLE", "Для импорта файла используйте формат XLSX.");
    }
    const url = typeof urlValue === "string" ? urlValue : "";
    const { rows, fileName } = await readAdminTeamRowsFromSpreadsheetSource({ file, url });
    const { layout, records, skippedCount } = parseAdminTeamImportRows(rows);
    if (!layout) {
      throw new TLineValidationError("INVALID_TEAM_TABLE", "Не удалось определить колонки Team ID и названия команды.");
    }
    if (records.length === 0) {
      throw new TLineValidationError("EMPTY_TEAM_TABLE", "В таблице не найдены команды с положительными Team ID.");
    }
    const result = await importTLineAdminDirectory(prisma, {
      championshipId: parseId((await context.params).id),
      records,
      sourceFileName: fileName,
      skippedCount,
    });
    return apiOk({ ...result, detectedLayout: layout });
  } catch (error) {
    if (error instanceof TLineValidationError) return tlineErrorResponse(error);
    const status = getSpreadsheetSourceErrorStatus(error);
    return apiError(
      status >= 500 ? "IMPORT_FAILED" : "INVALID_IMPORT_SOURCE",
      status >= 500
        ? "Не удалось импортировать справочник команд."
        : error instanceof Error ? error.message : "Некорректный источник импорта.",
      status,
    );
  }
}
