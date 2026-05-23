import { NextResponse } from "next/server";
import { parseManualMatchesWithAi } from "@/lib/manualImport/aiParser";
import { getManualImportDiscipline } from "@/lib/manualImport/config";
import { mapManualMatches } from "@/lib/manualImport/buildManualFixtPayload";
import { requireAdmin } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  disciplineSlug?: unknown;
  text?: unknown;
  imageDataUrl?: unknown;
};

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const disciplineSlug = typeof body.disciplineSlug === "string" ? body.disciplineSlug.trim().toLowerCase() : "";
    const text = typeof body.text === "string" ? body.text : "";
    const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    if (!text.trim() && !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, error: "Добавьте текст или изображение." }, { status: 400 });
    }

    const parsed = await parseManualMatchesWithAi({
      disciplineSlug,
      text,
      imageDataUrl,
    });
    const mappedMatches = await mapManualMatches(parsed.matches, disciplineSlug);

    return NextResponse.json({
      ok: parsed.ok,
      rawMatches: parsed.matches,
      mappedMatches,
      normalizedText: parsed.normalizedText,
      fallback: parsed.fallback || false,
      error: parsed.error,
    });
  } catch (error) {
    console.error("[Manual Import Parse] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual parse failed" },
      { status: 500 }
    );
  }
}
