import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import {
  buildSandboxAutoMappingPreviewFromParsed,
  parseSandboxAdminTeamsFromRows,
  parseSourceNamesText,
} from "@backend/adminTeams/sandboxAutomap";
import {
  getSpreadsheetSourceErrorStatus,
  readAdminTeamRowsFromSpreadsheetSource,
} from "@backend/adminTeams/spreadsheetSource";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestStartedAt = performance.now();
  try {
    const formDataStartedAt = performance.now();
    const formData = await request.formData();
    const formDataMs = performance.now() - formDataStartedAt;
    const sourceNames = String(formData.get("sourceNames") ?? "");
    const teamNames = parseSourceNamesText(sourceNames);

    if (teamNames.length === 0) {
      return NextResponse.json({ error: "Добавьте source названия, по одному на строку." }, { status: 400 });
    }

    const rawFile = formData.get("file");
    const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
    const rawUrl = formData.get("url");
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    const { rows, sourceType, fileName, byteLength, cacheHit, timingsMs: sourceTimingsMs } =
      await readAdminTeamRowsFromSpreadsheetSource({ file, url });
    const parseRowsStartedAt = performance.now();
    const parsed = parseSandboxAdminTeamsFromRows(rows);
    const parseRowsMs = performance.now() - parseRowsStartedAt;
    const matchStartedAt = performance.now();
    const { layout, records, skippedCount, preview } = buildSandboxAutoMappingPreviewFromParsed(
      sourceNames,
      teamNames,
      parsed
    );
    const matchMs = performance.now() - matchStartedAt;

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

    return NextResponse.json({
      ok: true,
      sourceType,
      fileName,
      byteLength,
      cacheHit,
      sourceNamesCount: sourceNames.split(/\r?\n/).filter((name) => name.trim()).length,
      uniqueSourceNamesCount: teamNames.length,
      adminTeamsCount: records.length,
      skippedAdminRowsCount: skippedCount,
      detectedLayout: layout,
      timingsMs: {
        formData: formDataMs,
        source: sourceTimingsMs,
        parseRows: parseRowsMs,
        match: matchMs,
        total: performance.now() - requestStartedAt,
      },
      preview,
    });
  } catch (error: any) {
    const status = getSpreadsheetSourceErrorStatus(error);
    if (status >= 500) {
      logApiError("api:admin/sandbox/automap/route.ts", error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? safeErrorMessage(error) : "Не удалось выполнить dry-run автомапинга." },
      { status }
    );
  }
}
