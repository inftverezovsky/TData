import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { parseManualMatchesWithAi } from "@backend/manualImport/aiParser";
import { getManualImportDiscipline } from "@backend/manualImport/config";
import { mapManualMatches } from "@backend/manualImport/buildManualFixtPayload";
import { readManualImportParseRequest } from "@backend/manualImport/parseRequest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  // API remains callable directly; password gate is UI-only for settings visibility.

  try {
    const totalStartedAt = Date.now();
    const { disciplineSlug, disciplineId, text, ocrText, imageDataUrl, imageBuffer, imageMime, mode, fast } = await readManualImportParseRequest(request);
    const discipline = getManualImportDiscipline(disciplineSlug);

    if (disciplineSlug && !discipline) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    if (!text.trim() && !ocrText.trim() && !imageBuffer?.length && !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, error: "Добавьте текст или изображение." }, { status: 400 });
    }

    const parsed = await parseManualMatchesWithAi({
      disciplineSlug: discipline?.slug || "manual",
      text,
      ocrText,
      imageDataUrl,
      imageBuffer,
      imageMime,
      mode,
      fast,
    });
    const mappingStartedAt = Date.now();
    const mappedMatches = discipline ? await mapManualMatches(parsed.matches, disciplineSlug, disciplineId) : [];
    const mappingMs = Date.now() - mappingStartedAt;

    return NextResponse.json({
      ok: parsed.ok,
      rawMatches: parsed.matches,
      mappedMatches,
      normalizedText: parsed.normalizedText,
      ocrText: parsed.ocrText,
      ocrConfidence: parsed.ocrConfidence,
      parseSource: parsed.parseSource,
      warnings: [
        ...(parsed.warnings || []),
        ...(!discipline ? ["Укажите ID дисциплины, чтобы подтянуть и сохранить ID команд."] : []),
      ],
      fallback: parsed.fallback || false,
      cacheHit: Boolean(parsed.cacheHit),
      timings: {
        ...(parsed.timings || {}),
        mappingMs,
        totalMs: Date.now() - totalStartedAt,
      },
      // Fallback возвращает результат локального разбора, но техническая диагностика AI не входит в публичный контракт.
      error: parsed.error ? "Не удалось распознать все матчи. Проверьте результат или повторите импорт." : undefined,
    });
  } catch (error) {
    logApiError("api:manual-import/parse/route.ts", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? safeErrorMessage(error) : "Manual parse failed" },
      { status: 500 }
    );
  }
}
