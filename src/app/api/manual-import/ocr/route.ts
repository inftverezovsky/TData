import { NextResponse } from "next/server";
import { getManualImportDiscipline } from "@/lib/manualImport/config";
import { extractManualImportOcr } from "@/lib/manualImport/ocrPipeline";
import { readManualImportParseRequest } from "@/lib/manualImport/parseRequest";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const { disciplineSlug, imageDataUrl, imageBuffer, imageMime } = await readManualImportParseRequest(request);

    if (disciplineSlug && !getManualImportDiscipline(disciplineSlug)) {
      return NextResponse.json({ ok: false, error: "Unsupported discipline" }, { status: 400 });
    }

    if (!imageBuffer?.length && !imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, error: "Добавьте изображение для OCR." }, { status: 400 });
    }

    const ocr = await extractManualImportOcr({
      imageDataUrl,
      imageBuffer,
      imageMime,
    });

    return NextResponse.json({
      ok: Boolean(ocr.text.trim()),
      ocrText: ocr.text,
      ocrConfidence: ocr.confidence,
      cached: Boolean(ocr.cached),
      warnings: ocr.warnings,
      variants: ocr.variants.map((variant) => ({
        name: variant.name,
        confidence: variant.confidence,
        matchesFound: variant.matchesFound,
      })),
      error: ocr.text.trim() ? undefined : "OCR не смог извлечь текст из изображения.",
    });
  } catch (error) {
    console.error("[Manual Import OCR] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manual OCR failed" },
      { status: 500 }
    );
  }
}
