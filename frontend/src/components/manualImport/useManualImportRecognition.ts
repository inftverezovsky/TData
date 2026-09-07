"use client";

import { readJsonResponse } from "@/services/responseSchema";
import { decodeManualResponse } from "./response";
import { getParseSourceLabel } from "./recognitionModel";
import { resizeImageForAi, resizeImageForOcr } from "./browserFiles";
import { throwIfAborted, isAbortError } from "./recognitionRuntime";
import type { ManualImportImageItem } from "./types";
import type { ManualImportState } from "./useManualImportState";
import type { ManualImportApi } from "./api";
import type { useManualImportImages } from "./useManualImportImages";
import type { useManualImportAiBatch } from "./useManualImportAiBatch";

export function useManualImportRecognition(state: ManualImportState, api: ManualImportApi, images: ReturnType<typeof useManualImportImages>, batch: ReturnType<typeof useManualImportAiBatch>) {
  const { disciplineId, rawText, imageItems, ocrText, ocrConfidence, parseSource, setAiFallbackAvailable, setOcrFallbackAvailable, message, setMessage, imageItemsRef, beginRecognition, finishRecognition, setRecognitionStep, applyParsedData } = state;
  const { postManualParse } = api;
  const { updateImageItem } = images;
  const { parseImageBatchWithAiFirst, finalizeBatchRecognition } = batch;

  async function parseMatches(options: { useOcrText?: boolean } = {}) {
    // Скриншоты направляем в пакетный AI-процесс; текст и повтор OCR проходят текстовый парсер.
    const textForParse = options.useOcrText ? ocrText : rawText;
    const shouldUploadImage = !options.useOcrText && imageItems.length > 0;

    if (!textForParse.trim() && !shouldUploadImage) {
      setMessage({ type: "error", text: "Добавьте текст или скрины для распознавания." });
      return;
    }

    const controller = beginRecognition();

    try {
      if (shouldUploadImage) {
        await parseImageBatchWithAiFirst(controller);
        return;
      }

      setRecognitionStep("local-parser", "Разбираю текст без OCR и AI.");
      const data = await postManualParse({ mode: "text", text: textForParse, signal: controller.signal });
      applyParsedData(data);
      setRecognitionStep("done", `Найдено матчей: ${(data.rawMatches || []).length}.`);
      setMessage({
        type: "info",
        text: `${getParseSourceLabel(data.parseSource)}. Найдено матчей: ${(data.rawMatches || []).length}.`,
      });
    } catch (error) {
      if (isAbortError(error)) {
        setRecognitionStep("done", "Распознавание отменено.");
        setMessage({ type: "info", text: "Распознавание отменено." });
      } else {
        setRecognitionStep("done", "Распознавание остановлено.");
        setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка распознавания" });
      }
    } finally {
      finishRecognition(controller);
    }
  }

  async function parseImageItemWithFastOcr(item: ManualImportImageItem, controller: AbortController) {
    updateImageItem(item.id, { status: "preparing", error: undefined });
    setRecognitionStep("preparing", `Готовлю OCR: ${item.name}.`);
    const preparedImage = await resizeImageForOcr(item.file);
    throwIfAborted(controller.signal);
    const ocrFormData = new FormData();
    ocrFormData.append("disciplineId", disciplineId);
    ocrFormData.append("image", preparedImage);

    updateImageItem(item.id, { status: "ocr" });
    setRecognitionStep("ocr", `Извлекаю текст локальным OCR: ${item.name}.`);
    const ocrResponse = await fetch("/api/manual-import/ocr", {
      method: "POST",
      body: ocrFormData,
      signal: controller.signal,
    });
    const ocrData = await readJsonResponse(ocrResponse, decodeManualResponse, "Ошибка OCR");
    if (!ocrResponse.ok || !ocrData.ok) {
      throw new Error(ocrData.error || "OCR не смог извлечь текст.");
    }

    const extractedText = typeof ocrData.ocrText === "string" ? ocrData.ocrText : "";
    const ocrConfidence = typeof ocrData.ocrConfidence === "number" ? ocrData.ocrConfidence : null;
    setRecognitionStep(
      "ocr",
      `${ocrData.cached ? "Взято из кэша OCR" : "OCR завершён"}${
        ocrConfidence !== null ? `, confidence ${Math.round(ocrConfidence)}%` : ""
      }.`
    );

    setRecognitionStep("local-parser", `Собираю матчи из OCR-текста: ${item.name}.`);
    try {
      const data = await postManualParse({ mode: "text", text: extractedText, signal: controller.signal });
      const rawMatches = Array.isArray(data.rawMatches) ? data.rawMatches : [];
      updateImageItem(item.id, {
        status: rawMatches.length > 0 ? "ocr" : "empty",
        rawMatches,
        normalizedText: data.normalizedText || extractedText,
        parseSource: ocrData.cached ? "ocr-cache" : "local-ocr",
        ocrText: extractedText,
        ocrConfidence,
        warnings: [...(ocrData.warnings || []), ...(data.warnings || [])],
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      updateImageItem(item.id, {
        status: "error",
        error: error instanceof Error ? error.message : "Локальный парсер не смог собрать матчи.",
        ocrText: extractedText,
        ocrConfidence,
        warnings: Array.isArray(ocrData.warnings) ? ocrData.warnings : [],
      });
    }
  }

  async function runAiFallback() {
    try {
      await runAiFallbackParse({ resetProgress: true });
    } catch (error) {
      if (isAbortError(error)) {
        setRecognitionStep("done", "AI fallback отменён.");
        setMessage({ type: "info", text: "AI fallback отменён." });
      }
    }
  }

  async function runOcrFallback() {
    const fallbackItems = imageItemsRef.current.filter((item) => item.status === "error" || item.status === "empty");
    if (fallbackItems.length === 0) {
      setMessage({ type: "error", text: "Нет скринов для OCR fallback." });
      return;
    }

    const controller = beginRecognition();
    try {
      for (const item of fallbackItems) {
        throwIfAborted(controller.signal);
        await parseImageItemWithFastOcr(item, controller);
      }
      await finalizeBatchRecognition(controller.signal);
    } catch (error) {
      if (isAbortError(error)) {
        setRecognitionStep("done", "OCR fallback отменён.");
        setMessage({ type: "info", text: "OCR fallback отменён." });
      } else {
        setRecognitionStep("done", "OCR fallback не смог собрать матчи.");
        setOcrFallbackAvailable(true);
        setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка OCR fallback" });
      }
    } finally {
      finishRecognition(controller);
    }
  }

  async function runAiFallbackParse({
    resetProgress = false,
    ocrTextOverride,
    imageFallback = true,
    introDetail = "Отправляю OCR-текст в ArcCodex AI.",
    signal,
  }: {
    resetProgress?: boolean;
    ocrTextOverride?: string;
    imageFallback?: boolean;
    introDetail?: string;
    signal?: AbortSignal;
  } = {}) {
    const resetController = resetProgress ? beginRecognition() : null;
    const requestSignal = signal || resetController?.signal;
    const nextOcrText = ocrTextOverride ?? ocrText;
    const fallbackImageItems = imageFallback ? imageItemsRef.current : [];
    const fallbackImageItem = fallbackImageItems[0] || null;
    if (!nextOcrText.trim() && !rawText.trim() && !fallbackImageItem) {
      setMessage({ type: "error", text: "Нет текста или фото для AI fallback." });
      if (resetController) finishRecognition(resetController);
      return;
    }

    setRecognitionStep("ai-fallback", introDetail);

    try {
      if (!nextOcrText.trim() && fallbackImageItems.length > 1 && resetController) {
        await parseImageBatchWithAiFirst(resetController);
        return;
      }

      const data = await postManualParse({
        mode: "ai",
        text: rawText,
        ocrText: nextOcrText,
        image: fallbackImageItem && !nextOcrText.trim() ? await resizeImageForAi(fallbackImageItem.file) : undefined,
        fast: true,
        signal: requestSignal,
      });
      applyParsedData(data);
      setAiFallbackAvailable(false);
      setOcrFallbackAvailable(false);
      setRecognitionStep("mapping", "ID команд подтянуты из справочников.");
      setRecognitionStep("done", `Найдено матчей: ${(data.rawMatches || []).length}.`);
      setMessage({
        type: "success",
        text: `${getParseSourceLabel(data.parseSource)}. Найдено матчей: ${(data.rawMatches || []).length}.`,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      setAiFallbackAvailable(true);
      setRecognitionStep("done", "AI fallback не смог собрать матчи.");
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка AI fallback" });
    } finally {
      if (resetController) {
        finishRecognition(resetController);
      }
    }
  }

  return { parseMatches, runAiFallback, runOcrFallback };
}
