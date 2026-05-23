import { NextResponse } from "next/server";
import { readSheet } from "read-excel-file/node";
import { prisma } from "@/lib/db/db";
import { normalizeTeamName } from "@/lib/teams/teams";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { queueIdentitySync } from "@/lib/sync/identitySync";
import { parseAdminTeamImportRows } from "@/lib/adminTeams/importSpreadsheet";
import { scorePlatformTeamCandidate } from "@/lib/teams/fuzzyMatch";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15000;

async function runAutoMapping(disciplineSlug: string) {
  const adminTeams = await prisma.adminTeam.findMany({
    where: { disciplineSlug },
  });

  const mappings = await prisma.teamMapping.findMany({
    where: {
      disciplineSlug,
      status: {
        in: ["unmapped", "ambiguous"],
      },
      isLockedFromAutoMapping: false,
    },
  });

  let autoMappedCount = 0;
  let ambiguousCount = 0;
  let unmappedCount = 0;
  const newlyMappedNames: string[] = [];

  for (const mapping of mappings) {
    const liqName =
      mapping.liquipediaNormalizedName ||
      normalizeTeamName(mapping.liquipediaName);
    if (!liqName) continue;

    let bestScore = 0;
    let secondBestScore = 0;
    let bestAdminTeam: any = null;
    const candidates: any[] = [];

    for (const admin of adminTeams) {
      const score = Math.max(
        scorePlatformTeamCandidate(mapping.liquipediaName, admin),
        scorePlatformTeamCandidate(liqName, admin)
      ) * 100;

      candidates.push({ admin, score });
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      bestScore = candidates[0].score;
      bestAdminTeam = candidates[0].admin;
      if (candidates.length > 1) {
        secondBestScore = candidates[1].score;
      }
    }

    if (bestScore >= 90) {
      if (bestScore - secondBestScore < 3 && secondBestScore >= 90) {
        await prisma.teamMapping.update({
          where: { id: mapping.id },
          data: { status: "ambiguous", confidenceScore: bestScore, matchMethod: "token_fuzzy" },
        });
        ambiguousCount++;
      } else {
        await prisma.teamMapping.update({
          where: { id: mapping.id },
          data: {
            platformId: bestAdminTeam.platformId,
            canonicalName: bestAdminTeam.platformName,
            confidenceScore: bestScore,
            matchMethod: "token_fuzzy",
            status: "auto_mapped",
          },
        });
        await prisma.tournamentParticipant.updateMany({
          where: {
            name: mapping.liquipediaName,
            tournament: { disciplineSlug },
          },
          data: { platformId: bestAdminTeam.platformId },
        });
        autoMappedCount++;
        newlyMappedNames.push(mapping.liquipediaName);
      }
    } else {
      unmappedCount++;
    }
  }

  return {
    adminTeamsCount: adminTeams.length,
    liquipediaTeamsFound: mappings.length,
    autoMappedCount,
    ambiguousCount,
    unmappedCount,
    newlyMappedNames,
  };
}

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
    const mappingResult = await runAutoMapping(disciplineSlug);

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
