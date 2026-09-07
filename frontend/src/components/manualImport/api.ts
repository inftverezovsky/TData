"use client";

import { readJsonResponse } from "@/services/responseSchema";
import { decodeManualResponse } from "./response";
import type { ManualMatch, ParseMode } from "./types";

export function createManualImportApi(disciplineId: string) {
  async function postManualParse({
    mode,
    text = "",
    ocrText: nextOcrText = "",
    image,
    imageDataUrl: nextImageDataUrl = "",
    fast = false,
    signal,
  }: {
    mode: ParseMode;
    text?: string;
    ocrText?: string;
    image?: File;
    imageDataUrl?: string;
    fast?: boolean;
    signal?: AbortSignal;
  }) {
    const formData = new FormData();
    formData.append("disciplineId", disciplineId);
    formData.append("mode", mode);
    if (fast) formData.append("fast", "true");
    formData.append("text", text);
    formData.append("ocrText", nextOcrText);
    if (image) {
      formData.append("image", image);
    } else if (nextImageDataUrl) {
      formData.append("imageDataUrl", nextImageDataUrl);
    }

    const response = await fetch("/api/manual-import/parse", {
      method: "POST",
      body: formData,
      signal,
    });
    const data = await readJsonResponse(response, decodeManualResponse, "Ошибка запроса ручного импорта");
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Матчи не распознаны");
    }
    return data;
  }

  async function postManualAutomap(rawMatches: ManualMatch[], signal?: AbortSignal) {
    const response = await fetch("/api/manual-import/automap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disciplineId, matches: rawMatches }),
      signal,
    });
    const data = await readJsonResponse(response, decodeManualResponse, "Ошибка запроса ручного импорта");
    if (!response.ok || !data.ok) throw new Error(data.error || "Автомапинг не выполнен");
    return data;
  }

  return { postManualParse, postManualAutomap };
}
export type ManualImportApi = ReturnType<typeof createManualImportApi>;
