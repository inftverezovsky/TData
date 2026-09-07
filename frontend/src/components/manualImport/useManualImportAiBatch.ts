"use client";

import { decodeManualMatch } from "./response";

import { buildManualImportBatchSummary, dedupeManualImportBatchMatches, MANUAL_IMPORT_IMAGE_BATCH_CONCURRENCY } from "@backend/manualImport/imageBatch";
import { mergeLockedTeamCellsFromSavedMappings } from "./matchModel";
import { resizeImageForAi, getClientAiImageCacheKey } from "./browserFiles";
import { runImageBatchPool, getClientAiImageCache, setClientAiImageCache, throwIfAborted, isAbortError } from "./recognitionRuntime";
import type { ManualMatch, ManualImportImageItem } from "./types";
import type { ManualImportState } from "./useManualImportState";
import type { ManualImportApi } from "./api";
import type { useManualImportImages } from "./useManualImportImages";

export function useManualImportAiBatch(state: ManualImportState, api: ManualImportApi, images: ReturnType<typeof useManualImportImages>) {
  const { disciplineId, rawText, setBatchSummary, ocrText, setOcrText, parseSource, setParseSource, setParseWarnings, setAiFallbackAvailable, setOcrFallbackAvailable, matches, mappedMatches, message, setMessage, setMappingSaveSummary, setLockedTeamCells, imageItemsRef, hasValidDisciplineId, setImageItemsState, setRecognitionStep, applyParsedData } = state;
  const { postManualParse, postManualAutomap } = api;
  const { updateImageItem } = images;

  async function parseImageBatchWithAiFirst(controller: AbortController) {
    // Сбросить статусы → обработать снимок очереди с ограничением параллелизма → объединить результаты.
    const queuedItems = imageItemsRef.current;
    if (queuedItems.length === 0) {
      setMessage({ type: "error", text: "Добавьте скрины через Ctrl+V или выбор файла." });
      return;
    }

    setBatchSummary(null);
    setRecognitionStep("preparing", `Готовлю скрины: ${queuedItems.length}.`);
    setImageItemsState((current) =>
      current.map((item) => ({
        ...item,
        status: "queued",
        error: undefined,
        rawMatches: undefined,
        normalizedText: undefined,
        parseSource: undefined,
        timings: undefined,
        warnings: undefined,
      }))
    );

    setRecognitionStep(
      "ai-fallback",
      `Отправляю скрины в ArcCodex AI, параллельно до ${MANUAL_IMPORT_IMAGE_BATCH_CONCURRENCY}.`
    );
    await runImageBatchPool(queuedItems, MANUAL_IMPORT_IMAGE_BATCH_CONCURRENCY, (item) =>
      processImageItemWithAi(item, controller.signal)
    );
    throwIfAborted(controller.signal);
    await finalizeBatchRecognition(controller.signal);
  }

  async function processImageItemWithAi(item: ManualImportImageItem, signal: AbortSignal) {
    // Уменьшить файл → проверить кэш всех входов AI → распознать → записать результат только этого скрина.
    updateImageItem(item.id, { status: "preparing", error: undefined });
    const preparedImage = await resizeImageForAi(item.file);
    throwIfAborted(signal);
    const cacheKey = await getClientAiImageCacheKey(disciplineId, preparedImage, "", rawText);
    const cached = cacheKey ? getClientAiImageCache(cacheKey) : null;

    if (cached) {
      updateImageItem(item.id, {
        status: cached.rawMatches.length > 0 ? "success" : "empty",
        rawMatches: cached.rawMatches,
        normalizedText: cached.normalizedText,
        parseSource: "ai",
        timings: { aiMs: 0 },
      });
      return;
    }

    updateImageItem(item.id, { status: "ai" });

    try {
      const data = await postManualParse({
        mode: "ai",
        text: rawText,
        image: preparedImage,
        fast: true,
        signal,
      });
      const rawMatches = Array.isArray(data.rawMatches) ? data.rawMatches : [];
      if (cacheKey) {
        setClientAiImageCache(cacheKey, {
          rawMatches,
          normalizedText: data.normalizedText || "",
        });
      }
      updateImageItem(item.id, {
        status: rawMatches.length > 0 ? "success" : "empty",
        rawMatches,
        normalizedText: data.normalizedText || "",
        parseSource: data.parseSource || "ai",
        timings: data.timings || {},
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      updateImageItem(item.id, {
        status: "error",
        error: error instanceof Error ? error.message : "AI не смог собрать матчи.",
        rawMatches: [],
        parseSource: "ai",
      });
    }
  }

  async function finalizeBatchRecognition(signal: AbortSignal) {
    // Объединить матчи всех скринов → убрать дубли → разрешить ID команд → показать итог и доступный OCR-резерв.
    const currentItems = imageItemsRef.current;
    const allRawMatches = currentItems.flatMap((item) => item.rawMatches || []);
    const batch = dedupeManualImportBatchMatches(allRawMatches);
    const deduped = { ...batch, matches: batch.matches.map((match) => decodeManualMatch(match)) };
    const warnings = currentItems.flatMap((item) => item.warnings || []);
    const failedItems = currentItems.filter((item) => item.status === "error" || item.status === "empty");
    const combinedText = currentItems.map((item) => item.normalizedText || item.ocrText || "").filter(Boolean).join("\n\n");
    const hasOcrResult = currentItems.some((item) => item.parseSource === "local-ocr" || item.parseSource === "ocr-cache");

    setRecognitionStep("mapping", "Объединяю результаты и подтягиваю ID команд.");

    if (deduped.matches.length > 0) {
      if (hasValidDisciplineId) {
        const mapped = await postManualAutomap(deduped.matches as ManualMatch[], signal);
        applyParsedData({
          rawMatches: deduped.matches,
          mappedMatches: mapped.mappedMatches || [],
          normalizedText: combinedText,
          parseSource: hasOcrResult ? "local-ocr" : "ai",
          warnings,
        });
        setLockedTeamCells((current) =>
          mergeLockedTeamCellsFromSavedMappings(current, deduped.matches as ManualMatch[], mapped.mappedMatches || [], mapped.savedMappings || [])
        );
        if (typeof mapped.savedCount === "number") {
          setMappingSaveSummary({
            savedCount: mapped.savedCount || 0,
            skippedCount: mapped.skippedCount || 0,
            conflictCount: mapped.conflictCount || 0,
            overwrittenCount: mapped.overwrittenCount || 0,
          });
        }
      } else {
        applyParsedData({
          rawMatches: deduped.matches,
          mappedMatches: [],
          normalizedText: combinedText,
          parseSource: hasOcrResult ? "local-ocr" : "ai",
          warnings: [...warnings, "Укажите ID дисциплины, чтобы подтянуть и сохранить ID команд."],
        });
      }
    } else {
      applyParsedData({
        rawMatches: [],
        mappedMatches: [],
        normalizedText: combinedText,
        parseSource: hasOcrResult ? "local-ocr" : "ai",
        warnings,
      });
    }

    const summary = buildManualImportBatchSummary(imageItemsRef.current, deduped.matches.length, deduped.duplicatesRemoved);
    setBatchSummary(summary);
    setAiFallbackAvailable(false);
    setOcrFallbackAvailable(failedItems.length > 0);
    if (combinedText && hasOcrResult) setOcrText(combinedText);
    setParseSource(hasOcrResult ? "local-ocr" : "ai");
    setParseWarnings([
      ...warnings,
      ...failedItems.map((item) => `${item.name}: ${item.error || "матчи не найдены"}`),
      ...(deduped.duplicatesRemoved > 0 ? [`Удалено дублей: ${deduped.duplicatesRemoved}.`] : []),
    ]);
    setRecognitionStep("done", `Готово: матчей ${summary.matches}, ошибок ${summary.error}, без матчей ${summary.empty}.`);
    setMessage({
      type: summary.matches > 0 ? "success" : "error",
      text: `Батч готов: скринов ${summary.total}, успешно ${summary.success}, без матчей ${summary.empty}, ошибок ${
        summary.error
      }, матчей ${summary.matches}.${failedItems.length > 0 ? " OCR fallback доступен вручную." : ""}`,
    });
  }

  return { parseImageBatchWithAiFirst, finalizeBatchRecognition };
}
