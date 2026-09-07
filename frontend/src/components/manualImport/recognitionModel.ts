import type { ImageRecognitionStatus } from "@backend/manualImport/imageBatch";
import type { RecognitionStage } from "./types";

// Показываем только пройденные или активные ветви; AI и OCR не обязаны идти подряд.
const recognitionStages: Array<{ id: Exclude<RecognitionStage, "idle">; label: string }> = [
  { id: "preparing", label: "Подготовка" },
  { id: "ai-fallback", label: "AI распознавание" },
  { id: "ocr", label: "OCR изображения" },
  { id: "local-parser", label: "Локальный парсер" },
  { id: "mapping", label: "Маппинг" },
  { id: "done", label: "Готово" },
];

export function getParseSourceLabel(source?: string) {
  switch (source) {
    case "local-text":
      return "Локальный парсер текста";
    case "local-ocr":
      return "Локальный OCR";
    case "ocr-cache":
      return "Кэш OCR";
    case "ai":
      return "ArcCodex AI";
    case "fallback":
      return "Fallback parser";
    default:
      return "Распознавание";
  }
}

export function getVisibleRecognitionStages(
  current: RecognitionStage,
  details: Partial<Record<RecognitionStage, string>>
) {
  return recognitionStages.filter((stage) => {
    if (stage.id === "preparing" || stage.id === "mapping" || stage.id === "done") return true;
    return current === stage.id || Boolean(details[stage.id]);
  });
}

export function getRecognitionStageStatus(
  current: RecognitionStage,
  stage: Exclude<RecognitionStage, "idle">,
  stages: Array<{ id: Exclude<RecognitionStage, "idle">; label: string }>
) {
  if (current === "idle") return "pending";
  const currentIndex = stages.findIndex((item) => item.id === current);
  const stageIndex = stages.findIndex((item) => item.id === stage);
  if (currentIndex === -1 || stageIndex === -1) return "pending";
  if (stageIndex < currentIndex || current === "done") return "done";
  if (stageIndex === currentIndex) return "active";
  return "pending";
}

export function getImageStatusLabel(status: ImageRecognitionStatus) {
  switch (status) {
    case "queued":
      return "Очередь";
    case "preparing":
      return "Подготовка";
    case "ai":
      return "AI";
    case "success":
      return "Готово";
    case "empty":
      return "Пусто";
    case "error":
      return "Ошибка";
    case "ocr":
      return "OCR";
    default:
      return "Очередь";
  }
}

export function getImageStatusClass(status: ImageRecognitionStatus) {
  switch (status) {
    case "success":
    case "ocr":
      return "bg-emerald-50 text-emerald-700";
    case "ai":
    case "preparing":
      return "bg-indigo-50 text-indigo-700";
    case "empty":
      return "bg-amber-50 text-amber-700";
    case "error":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-500";
  }
}
