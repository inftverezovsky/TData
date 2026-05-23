import { NextResponse } from "next/server";
import { mapManualMatches } from "@/lib/manualImport/buildManualFixtPayload";
import { getManualImportDiscipline } from "@/lib/manualImport/config";
import { requireAdmin } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const disciplineSlug = typeof body.disciplineSlug === "string" ? body.disciplineSlug.trim().toLowerCase() : "";
    const matches = Array.isArray(body.matches) ? body.matches : [];

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    const mappedMatches = await mapManualMatches(matches, disciplineSlug);
    const readyMatchesCount = mappedMatches.filter((match) => match.isReady).length;

    return NextResponse.json({
      ok: true,
      mappedMatches,
      readyMatchesCount,
    });
  } catch (error) {
    console.error("[Manual Import Automap] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual auto-map failed" },
      { status: 500 }
    );
  }
}
