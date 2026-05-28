import { NextResponse } from "next/server";
import { readSheet } from "read-excel-file/node";
import { prisma } from "@/lib/db/db";
import { queueIdentitySync } from "@/lib/sync/identitySync";
import { parseAdminTeamImportRows } from "@/lib/adminTeams/importSpreadsheet";
import { runAutoMappingForDiscipline } from "@/lib/teams/mapping";
import { normalizeManualImportDisciplineId, resolveManualImportDisciplineSlug } from "@/lib/manualImport/config";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15000;

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

    if (!file && !url) {
      return NextResponse.json({ error: "No file or URL provided" }, { status: 400 });
    }

    let buffer: Buffer;
    let fileName: string;

    if (file) {
      if (file.size > MAX_IMPORT_BYTES) {
        return NextResponse.json({ error: "File is too large" }, { status: 413 });
      }

      const bytes = await file.arrayBuffer();
      buffer = Buffer.from(bytes);
      fileName = file.name;
    } else {
      const fetchUrl = toGoogleSheetsExportUrl(url);
      if (!fetchUrl) {
        return NextResponse.json({ error: "Укажите ссылку на Google Sheets таблицу." }, { status: 400 });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
      const response = await fetch(fetchUrl, { signal: controller.signal }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              response.status === 403 || response.status === 404
                ? "Google Sheets не отдаёт таблицу. Проверьте, что ссылка открыта для просмотра всем, у кого есть ссылка."
                : `Не удалось скачать Google Sheets: ${response.status} ${response.statusText}`,
          },
          { status: 400 }
        );
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
        return NextResponse.json({ error: "Remote file is too large" }, { status: 413 });
      }

      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_IMPORT_BYTES) {
        return NextResponse.json({ error: "Remote file is too large" }, { status: 413 });
      }

      buffer = Buffer.from(bytes);
      if (looksLikeHtml(buffer, response.headers.get("content-type"))) {
        return NextResponse.json(
          {
            error: "Google Sheets вернул HTML-страницу вместо Excel. Откройте доступ к таблице по ссылке или используйте прямой Excel-файл.",
          },
          { status: 400 }
        );
      }
      fileName = "remote_url";
    }

    const data = await readSheet(buffer);
    if (data.length < 1) {
      return NextResponse.json({ error: "Source has no data" }, { status: 400 });
    }

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
    console.error("Import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export function toGoogleSheetsExportUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== "docs.google.com" || !parsed.pathname.includes("/spreadsheets/")) {
      return null;
    }

    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return null;

    const gid = parsed.searchParams.get("gid") || parsed.hash.match(/gid=(\d+)/)?.[1] || "";
    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
    exportUrl.searchParams.set("format", "xlsx");
    if (gid) exportUrl.searchParams.set("gid", gid);
    return exportUrl.toString();
  } catch {
    return null;
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

function looksLikeHtml(buffer: Buffer, contentType: string | null) {
  if (contentType?.toLowerCase().includes("text/html")) return true;
  const head = buffer.subarray(0, 128).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}
