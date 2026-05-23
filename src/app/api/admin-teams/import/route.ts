import { NextResponse } from "next/server";
import { readSheet } from "read-excel-file/node";
import { prisma } from "@/lib/db/db";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { queueIdentitySync } from "@/lib/sync/identitySync";
import { parseAdminTeamImportRows } from "@/lib/adminTeams/importSpreadsheet";
import { runAutoMappingForDiscipline } from "@/lib/teams/mapping";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15000;

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const url = formData.get("url") as string;
    const disciplineSlug = (formData.get("disciplineSlug") as string) || "dota2";

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
        return NextResponse.json({ error: "Only Google Sheets spreadsheet URLs are allowed" }, { status: 400 });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
      const response = await fetch(fetchUrl, { signal: controller.signal }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        throw new Error(`Failed to fetch from URL: ${response.statusText}`);
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
          normalizedName: record.normalizedName,
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
      mappingResult,
      identitySync,
    });
  } catch (error: any) {
    console.error("Import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function toGoogleSheetsExportUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== "docs.google.com" || !parsed.pathname.includes("/spreadsheets/")) {
      return null;
    }

    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return null;

    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
  } catch {
    return null;
  }
}
