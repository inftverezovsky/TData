"use client";

import { type ChangeEvent, useEffect } from "react";
import { MANUAL_IMPORT_MAX_IMAGES } from "@backend/manualImport/imageBatch";
import { selectManualImportImageItems } from "./imageQueueModel";
import { getImageFilesFromClipboard, getFileHash, fileExtensionFromMime } from "./browserFiles";
import type { ManualImportImageItem } from "./types";
import type { ManualImportState } from "./useManualImportState";

export function useManualImportImages(state: ManualImportState) {
  const { setBatchSummary, setOcrText, setOcrConfidence, setParseSource, setParseWarnings, setRecognitionStage, setRecognitionStepDetails, setAiFallbackAvailable, setOcrFallbackAvailable, setPreview, setMessage, setMappingConflicts, setMappingSaveSummary, setLastServiceJsonUrl, activeRecognitionController, imageItemsRef, addImageFilesRef, setImageItemsState } = state;

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    await addImageFiles(files, "file");
    event.target.value = "";
  }

  async function addImageFiles(files: File[], source: "file" | "paste") {
    // Подготовить previews и хеши → отсеять повторы/переполнение → освободить отклонённые previews → обновить очередь.
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const preparedItems = await Promise.all(
      imageFiles.map(async (file, index) => ({
        id: `${Date.now()}-${source}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || `clipboard-${new Date().toISOString().replace(/[:.]/g, "-")}.${fileExtensionFromMime(file.type)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        hash: await getFileHash(file),
        status: "queued" as const,
      }))
    );
    const selection = selectManualImportImageItems(
      imageItemsRef.current.map((item) => item.hash),
      preparedItems
    );
    const { acceptedItems, rejectedItems } = selection;
    rejectedItems.forEach((item) => URL.revokeObjectURL(item.previewUrl));

    if (acceptedItems.length === 0) {
      setMessage({
        type: "info",
        text:
          selection.duplicateCount > 0
            ? "Эти скрины уже есть в очереди."
            : `Можно добавить максимум ${MANUAL_IMPORT_MAX_IMAGES} скринов.`,
      });
      return;
    }

    const nextQueueLength = imageItemsRef.current.length + acceptedItems.length;
    setImageItemsState((current) => [...current, ...acceptedItems]);
    setOcrText("");
    setOcrConfidence(null);
    setParseSource("");
    setParseWarnings([]);
    setBatchSummary(null);
    setRecognitionStage("idle");
    setRecognitionStepDetails({});
    setAiFallbackAvailable(false);
    setOcrFallbackAvailable(false);
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
    const details = [
      selection.duplicateCount > 0 ? `дубликатов: ${selection.duplicateCount}` : "",
      selection.overflowCount > 0 ? `не влезло: ${selection.overflowCount}` : "",
    ].filter(Boolean);
    setMessage({
      type: "success",
      text: `Добавлено скринов: ${acceptedItems.length}. В очереди: ${nextQueueLength}/${MANUAL_IMPORT_MAX_IMAGES}${
        details.length ? `. ${details.join(", ")}.` : "."
      }`,
    });
  }

  useEffect(() => {
    addImageFilesRef.current = addImageFiles;
  });

  useEffect(() => {
    function handleWindowPaste(event: globalThis.ClipboardEvent) {
      const files = getImageFilesFromClipboard(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void addImageFilesRef.current(files, "paste");
    }

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [addImageFilesRef]);

  function updateImageItem(id: string, patch: Partial<ManualImportImageItem>) {
    setImageItemsState((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeImageItem(id: string) {
    const item = imageItemsRef.current.find((currentItem) => currentItem.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    setImageItemsState((current) => current.filter((currentItem) => currentItem.id !== id));
    setBatchSummary(null);
    setOcrFallbackAvailable(false);
    setPreview(null);
  }

  function clearImageItems() {
    activeRecognitionController.current?.abort();
    imageItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setImageItemsState([]);
    setBatchSummary(null);
    setOcrText("");
    setOcrConfidence(null);
    setParseSource("");
    setParseWarnings([]);
    setRecognitionStage("idle");
    setRecognitionStepDetails({});
    setAiFallbackAvailable(false);
    setOcrFallbackAvailable(false);
    setPreview(null);
  }

  return { handleImageChange, updateImageItem, removeImageItem, clearImageItems };
}
