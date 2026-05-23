import { NextResponse } from "next/server";
import { parseManualMatchesWithAi } from "@/lib/manualImport/aiParser";
import { getManualImportDiscipline } from "@/lib/manualImport/config";
import { mapManualMatches } from "@/lib/manualImport/buildManualFixtPayload";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { readManualImportParseRequest } from "@/lib/manualImport/parseRequest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const totalStartedAt = Date.now();
    const { disciplineSlug, disciplineId, text, ocrText, imageDataUrl, imageBuffer, imageMime, mode, fast } = await readManualImportParseRequest(request);

    if (!getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    if (!text.trim() && !ocrText.trim() && !imageBuffer?.length && !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, error: "Добавьте текст или изображение." }, { status: 400 });
    }

    const parsed = await parseManualMatchesWithAi({
      disciplineSlug,
      text,
      ocrText,
      imageDataUrl,
      imageBuffer,
      imageMime,
      mode,
      fast,
    });
    const mappingStartedAt = Date.now();
    const mappedMatches = await mapManualMatches(parsed.matches, disciplineSlug, disciplineId);
    const mappingMs = Date.now() - mappingStartedAt;

    return NextResponse.json({
      ok: parsed.ok,
      rawMatches: parsed.matches,
      mappedMatches,
      normalizedText: parsed.normalizedText,
      ocrText: parsed.ocrText,
      ocrConfidence: parsed.ocrConfidence,
      parseSource: parsed.parseSource,
      warnings: parsed.warnings || [],
      fallback: parsed.fallback || false,
      cacheHit: Boolean(parsed.cacheHit),
      timings: {
        ...(parsed.timings || {}),
        mappingMs,
        totalMs: Date.now() - totalStartedAt,
      },
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
