import { NextResponse } from "next/server";
import { readSheet } from "read-excel-file/node";
import { prisma } from "@/lib/db/db";
import { normalizeTeamName } from "@/lib/teams/teams";
import levenshtein from "fast-levenshtein";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { queueIdentitySync } from "@/lib/sync/identitySync";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15000;

function findColumns(headers: string[]) {
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

  const idCandidates = ["platformid", "id", "team_id", "teamid"];
  const nameCandidates = ["teamname", "name", "team", "название", "team name", "команда"];

  let idCol = -1;
  let nameCol = -1;

  for (let i = 0; i < normalizedHeaders.length; i++) {
    const h = normalizedHeaders[i];
    if (idCol === -1 && idCandidates.includes(h)) idCol = i;
    if (nameCol === -1 && nameCandidates.includes(h)) nameCol = i;
  }

  return { idCol, nameCol };
}

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

  for (const mapping of mappings) {
    const liqName =
      mapping.liquipediaNormalizedName ||
      normalizeTeamName(mapping.liquipediaName);
    if (!liqName) continue;

    let bestScore = 0;
    let secondBestScore = 0;
    let bestAdminTeam: any = null;
    let candidates: any[] = [];

    for (const admin of adminTeams) {
      const distance = levenshtein.get(liqName, admin.normalizedName);
      const maxLength = Math.max(liqName.length, admin.normalizedName.length);
      const score = maxLength === 0 ? 100 : (1 - distance / maxLength) * 100;

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
          data: { status: "ambiguous" },
        });
        ambiguousCount++;
      } else {
        await prisma.teamMapping.update({
          where: { id: mapping.id },
          data: {
            platformId: bestAdminTeam.platformId,
            canonicalName: bestAdminTeam.platformName,
            confidenceScore: bestScore,
            matchMethod: "levenshtein",
            status: "auto_mapped",
          },
        });
        autoMappedCount++;
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
    if (data.length < 2) {
      return NextResponse.json({ error: "Source has no data" }, { status: 400 });
    }

    const headers = data[0].map((cell) => String(cell ?? ""));
    const { idCol, nameCol } = findColumns(headers);

    if (idCol === -1 || nameCol === -1) {
      return NextResponse.json(
        {
          error: `Could not determine columns. Found headers: ${headers.join(
            ", "
          )}. Need ID and Name columns.`,
        },
        { status: 400 }
      );
    }

    let importedCount = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const id = row[idCol] ? String(row[idCol]).trim() : "";
      const name = row[nameCol] ? String(row[nameCol]).trim() : "";

      if (!id || !name) continue;

      const normalizedName = normalizeTeamName(name);

      await prisma.adminTeam.upsert({
        where: { id: `admin_${disciplineSlug}_${id}` },
        update: {
          platformName: name,
          normalizedName,
          sourceFileName: fileName,
        },
        create: {
          id: `admin_${disciplineSlug}_${id}`,
          disciplineSlug,
          platformId: id,
          platformName: name,
          normalizedName,
          sourceFileName: fileName,
        },
      });
      importedCount++;
    }

    // Run auto-mapping after import
    const mappingResult = await runAutoMapping(disciplineSlug);

    const identitySync = queueIdentitySync(`admin-teams:import:${disciplineSlug}`);

    return NextResponse.json({
      success: true,
      importedCount,
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
