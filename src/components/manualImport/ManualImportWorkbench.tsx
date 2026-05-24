"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clipboard,
  Clock,
  FileJson,
  FileUp,
  Images,
  ImageUp,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScanText,
  Send,
  Sparkles,
  Table2,
  UploadCloud,
  X,
} from "lucide-react";
import { shiftManualImportMatchDates } from "@/lib/manualImport/timeShift";
import {
  buildManualImportBatchSummary,
  dedupeManualImportBatchMatches,
  type BatchRecognitionSummary,
  type ImageRecognitionStatus,
  MANUAL_IMPORT_IMAGE_BATCH_CONCURRENCY,
  MANUAL_IMPORT_MAX_IMAGES,
  selectManualImportImageHashes,
} from "@/lib/manualImport/imageBatch";

type ManualMatch = {
  id?: string;
  tournament?: string;
  team1: string;
  team2: string;
  team1PlatformId?: string;
  team2PlatformId?: string;
  date: string;
};

type MappedMatch = {
  id: string;
  tournament: string;
  team1: { name: string; platformId: string | null; source?: TeamPlatformIdSource };
  team2: { name: string; platformId: string | null; source?: TeamPlatformIdSource };
  date: string;
  isReady: boolean;
};

type TeamSide = "team1" | "team2";
type TeamPlatformIdSource = "explicit" | "manual" | "team_mapping" | "admin_team" | "embedded" | null;

type PreviewData = {
  phpArray: any;
  phpArrayText: string;
  serialized: string;
  postBody: string;
  readyMatchesCount: number;
  skippedMatches: any[];
  warnings: string[];
  mappedMatches: MappedMatch[];
};

type ResultMessage = {
  type: "success" | "error" | "info";
  text: string;
  raw?: string;
};

type ParseSource = "local-text" | "local-ocr" | "ocr-cache" | "ai" | "fallback" | "";
type ParseMode = "auto" | "text" | "ai";
type RecognitionStage = "idle" | "preparing" | "ocr" | "local-parser" | "ai-fallback" | "mapping" | "done";

const recognitionStages: Array<{ id: Exclude<RecognitionStage, "idle">; label: string }> = [
  { id: "preparing", label: "Подготовка" },
  { id: "ai-fallback", label: "AI распознавание" },
  { id: "ocr", label: "OCR изображения" },
  { id: "local-parser", label: "Локальный парсер" },
  { id: "mapping", label: "Маппинг" },
  { id: "done", label: "Готово" },
];

type TeamImportResult = {
  success: boolean;
  importedCount: number;
  skippedCount?: number;
  detectedLayout?: {
    headerRowIndex: number;
    dataStartRow: number;
    idCol: number;
    nameCol: number;
    source: "header" | "data";
  };
  mappingResult?: {
    adminTeamsCount: number;
    liquipediaTeamsFound: number;
    autoMappedCount: number;
    ambiguousCount: number;
    unmappedCount: number;
    newlyMappedNames?: string[];
  };
};

type ManualMappingConflict = {
  teamName: string;
  normalizedTeamName: string;
  existingPlatformId: string;
  incomingPlatformId: string;
};

type ManualMappingSaveSummary = {
  savedCount: number;
  skippedCount: number;
  conflictCount: number;
  overwrittenCount: number;
};

type ClientAiImageCacheEntry = {
  rawMatches: ManualMatch[];
  normalizedText: string;
  expiresAt: number;
};

type ManualImportImageItem = {
  id: string;
  name: string;
  file: File;
  previewUrl: string;
  hash: string;
  status: ImageRecognitionStatus;
  error?: string;
  rawMatches?: ManualMatch[];
  normalizedText?: string;
  parseSource?: ParseSource;
  timings?: Record<string, number>;
  ocrText?: string;
  ocrConfidence?: number | null;
  warnings?: string[];
};

const CLIENT_AI_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const clientAiImageCache = new Map<string, ClientAiImageCacheEntry>();

export default function ManualImportWorkbench() {
  const [disciplineId, setDisciplineId] = useState("73");
  const [shapkaId, setShapkaId] = useState("");
  const [rawText, setRawText] = useState("");
  const [imageItems, setImageItems] = useState<ManualImportImageItem[]>([]);
  const [batchSummary, setBatchSummary] = useState<BatchRecognitionSummary | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [parseSource, setParseSource] = useState<ParseSource>("");
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [recognitionStage, setRecognitionStage] = useState<RecognitionStage>("idle");
  const [recognitionStepDetails, setRecognitionStepDetails] = useState<Partial<Record<RecognitionStage, string>>>({});
  const [aiFallbackAvailable, setAiFallbackAvailable] = useState(false);
  const [ocrFallbackAvailable, setOcrFallbackAvailable] = useState(false);
  const [matches, setMatches] = useState<ManualMatch[]>([]);
  const [mappedMatches, setMappedMatches] = useState<MappedMatch[]>([]);
  const [selectedMatchIndexes, setSelectedMatchIndexes] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [message, setMessage] = useState<ResultMessage | null>(null);
  const [parsing, setParsing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingConflicts, setMappingConflicts] = useState<ManualMappingConflict[]>([]);
  const [mappingSaveSummary, setMappingSaveSummary] = useState<ManualMappingSaveSummary | null>(null);
  const [lastServiceJsonUrl, setLastServiceJsonUrl] = useState("");
  const [timeShiftMinutes, setTimeShiftMinutes] = useState("60");
  const [lockedTeamCells, setLockedTeamCells] = useState<Set<string>>(new Set());
  const [editingTeamCells, setEditingTeamCells] = useState<Set<string>>(new Set());
  const [savingTeamCells, setSavingTeamCells] = useState<Set<string>>(new Set());

  const [teamImportMode, setTeamImportMode] = useState<"file" | "url">("file");
  const [teamFile, setTeamFile] = useState<File | null>(null);
  const [teamUrl, setTeamUrl] = useState("");
  const [teamImporting, setTeamImporting] = useState(false);
  const [teamImportResult, setTeamImportResult] = useState<TeamImportResult | null>(null);
  const [teamImportMessage, setTeamImportMessage] = useState<ResultMessage | null>(null);
  const activeRecognitionController = useRef<AbortController | null>(null);
  const imageItemsRef = useRef<ManualImportImageItem[]>([]);
  const addImageFilesRef = useRef<(files: File[], source: "file" | "paste") => Promise<void>>(async () => undefined);

  useEffect(() => {
    imageItemsRef.current = imageItems;
  }, [imageItems]);

  useEffect(() => {
    return () => {
      imageItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  function setImageItemsState(
    updater: ManualImportImageItem[] | ((current: ManualImportImageItem[]) => ManualImportImageItem[])
  ) {
    const current = imageItemsRef.current;
    const next =
      typeof updater === "function"
        ? (updater as (current: ManualImportImageItem[]) => ManualImportImageItem[])(current)
        : updater;
    imageItemsRef.current = next;
    setImageItems(next);
  }

  const selectedMatches = getSelectedMatches(matches, selectedMatchIndexes);
  const selectedCount = selectedMatchIndexes.size;
  const allMatchesSelected = matches.length > 0 && selectedMatchIndexes.size === matches.length;
  const selectedReadyCount =
    preview?.readyMatchesCount ??
    matches.filter((match, index) => {
      if (!selectedMatchIndexes.has(index)) return false;
      const mapped = mappedMatches[index];
      return Boolean(
        (match.team1PlatformId || mapped?.team1.platformId) &&
          (match.team2PlatformId || mapped?.team2.platformId)
      );
    }).length;
  const totalReadyCount = matches.filter((match, index) => {
    const mapped = mappedMatches[index];
    return Boolean(
      (match.team1PlatformId || mapped?.team1.platformId) &&
        (match.team2PlatformId || mapped?.team2.platformId)
    );
  }).length;
  const hasValidDisciplineId = isValidManualAdminId(disciplineId);
  const hasValidShapkaId = isValidManualAdminId(shapkaId);

  async function handleTeamFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setTeamFile(file);
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    await addImageFiles(files, "file");
    event.target.value = "";
  }

  async function addImageFiles(files: File[], source: "file" | "paste") {
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
    const selection = selectManualImportImageHashes(
      imageItemsRef.current.map((item) => item.hash),
      preparedItems.map((item) => item.hash)
    );
    const acceptedHashes = new Set(selection.acceptedHashes);
    const acceptedItems = preparedItems.filter((item) => acceptedHashes.has(item.hash));
    preparedItems
      .filter((item) => !acceptedHashes.has(item.hash))
      .forEach((item) => URL.revokeObjectURL(item.previewUrl));

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
  }, []);

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

  async function importTeams() {
    if (teamImportMode === "file" && !teamFile) return;
    if (teamImportMode === "url" && !teamUrl.trim()) return;
    if (!hasValidDisciplineId) {
      const errorMessage = { type: "error", text: "Укажите ID дисциплины перед импортом команд." } as const;
      setTeamImportMessage(errorMessage);
      setMessage(errorMessage);
      return;
    }

    setTeamImporting(true);
    setTeamImportResult(null);
    setTeamImportMessage(null);
    setMessage(null);

    const formData = new FormData();
    formData.append("disciplineId", disciplineId);
    if (teamImportMode === "file" && teamFile) {
      formData.append("file", teamFile);
    } else {
      formData.append("url", teamUrl.trim());
    }

    try {
      const response = await fetch("/api/admin-teams/import", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось импортировать команды");

      setTeamImportResult(data);
      const successMessage = {
        type: "success",
        text: `Источник обновлен: ${data.importedCount || 0} записей. Автомапинг: ${data.mappingResult?.autoMappedCount || 0}.`,
      } as const;
      setTeamImportMessage(successMessage);
      setMessage(successMessage);
    } catch (error) {
      const errorMessage = { type: "error", text: error instanceof Error ? error.message : "Ошибка импорта команд" } as const;
      setTeamImportMessage(errorMessage);
      setMessage(errorMessage);
    } finally {
      setTeamImporting(false);
    }
  }

  async function parseMatches(options: { useOcrText?: boolean } = {}) {
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

  async function parseImageBatchWithAiFirst(controller: AbortController) {
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
    updateImageItem(item.id, { status: "preparing", error: undefined });
    const preparedImage = await resizeImageForAi(item.file);
    throwIfAborted(signal);
    const cacheKey = await getClientAiImageCacheKey(disciplineId, preparedImage, "");
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
    const currentItems = imageItemsRef.current;
    const allRawMatches = currentItems.flatMap((item) => item.rawMatches || []);
    const deduped = dedupeManualImportBatchMatches(allRawMatches);
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
    const ocrData = await ocrResponse.json();
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

  function beginRecognition() {
    activeRecognitionController.current?.abort();
    const controller = new AbortController();
    activeRecognitionController.current = controller;
    setParsing(true);
    setMessage(null);
    setPreview(null);
    setParseWarnings([]);
    setRecognitionStage("preparing");
    setRecognitionStepDetails({});
    setAiFallbackAvailable(false);
    setOcrFallbackAvailable(false);
    return controller;
  }

  function finishRecognition(controller: AbortController) {
    if (activeRecognitionController.current === controller) {
      activeRecognitionController.current = null;
    }
    setParsing(false);
  }

  function abortRecognition() {
    activeRecognitionController.current?.abort();
    activeRecognitionController.current = null;
    setParsing(false);
    setRecognitionStep("done", "Распознавание отменено.");
    setMessage({ type: "info", text: "Распознавание отменено." });
  }

  function setRecognitionStep(stage: RecognitionStage, detail?: string) {
    setRecognitionStage(stage);
    if (detail) {
      setRecognitionStepDetails((current) => ({ ...current, [stage]: detail }));
    }
  }

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
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Матчи не распознаны");
    }
    return data;
  }

  function applyParsedData(data: any) {
    const nextMappedMatches = data.mappedMatches || [];
    const nextMatches = mergeMatchesWithMappedIds(data.rawMatches || [], nextMappedMatches);
    setMatches(nextMatches);
    setMappedMatches(nextMappedMatches);
    setLockedTeamCells(createLockedTeamCellsFromMappedMatches(nextMappedMatches));
    setEditingTeamCells(new Set());
    setSavingTeamCells(new Set());
    setSelectedMatchIndexes(createAllSelectedIndexes(nextMatches.length));
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setAiFallbackAvailable(false);
    setParseSource(data.parseSource || "");
    setParseWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    setOcrConfidence(typeof data.ocrConfidence === "number" ? data.ocrConfidence : null);
    if (typeof data.ocrText === "string" && data.ocrText.trim()) {
      setOcrText(data.ocrText);
    } else if ((data.parseSource === "local-ocr" || data.parseSource === "ocr-cache") && typeof data.normalizedText === "string") {
      setOcrText(data.normalizedText);
    }
    if (data.normalizedText && !rawText.trim() && !data.ocrText && data.parseSource !== "local-ocr" && data.parseSource !== "ocr-cache") {
      setRawText(data.normalizedText);
    }
  }

  async function postManualAutomap(rawMatches: ManualMatch[], signal?: AbortSignal) {
    const response = await fetch("/api/manual-import/automap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disciplineId, matches: rawMatches }),
      signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Автомапинг не выполнен");
    return data;
  }

  async function runPreview() {
    if (selectedMatches.length === 0) {
      setMessage({
        type: "error",
        text: matches.length === 0 ? "Сначала распознайте или добавьте матчи." : "Выберите матчи для заливки.",
      });
      return;
    }

    setPreviewing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, shapkaId, matches: selectedMatches }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Ошибка превью");

      setPreview(data);
      setMappedMatches((current) => mergeSelectedMappedMatches(current, selectedMatchIndexes, data.mappedMatches || []));
      setMatches((current) => mergeSelectedMatchesWithMappedIds(current, selectedMatchIndexes, data.mappedMatches || []));
      setMessage({ type: "success", text: `Готово к заливке: ${data.readyMatchesCount} выбранных матчей.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка превью" });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendToAdmin() {
    if (selectedMatches.length === 0) {
      setMessage({ type: "error", text: "Выберите матчи для заливки." });
      return;
    }
    if (!confirm(`Залить выбранные матчи в API? Количество: ${selectedMatches.length}`)) return;

    setSending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, shapkaId, matches: selectedMatches }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Ошибка при заливке");
      }

      setMessage({
        type: "success",
        text: `Данные успешно залиты. Статус: ${data.status}`,
        raw: data.rawResponse,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка отправки" });
    } finally {
      setSending(false);
    }
  }

  async function runAutoMap() {
    if (matches.length === 0) {
      setMessage({ type: "error", text: "Сначала добавьте или распознайте матчи." });
      return;
    }
    if (!hasValidDisciplineId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины, чтобы сохранить привязки команд." });
      return;
    }

    setAutoMapping(true);
    setMessage(null);
    setPreview(null);

    try {
      const response = await fetch("/api/manual-import/automap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, matches }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Автомапинг не выполнен");

      const nextMappedMatches = data.mappedMatches || [];
      setMappedMatches(nextMappedMatches);
      setMatches((current) => mergeMatchesWithMappedIds(current, nextMappedMatches));
      const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
      setMappingConflicts(conflicts);
      setMappingSaveSummary({
        savedCount: data.savedCount || 0,
        skippedCount: data.skippedCount || 0,
        conflictCount: data.conflictCount || conflicts.length,
        overwrittenCount: data.overwrittenCount || 0,
      });
      setLockedTeamCells((current) =>
        mergeLockedTeamCellsFromSavedMappings(current, matches, nextMappedMatches, data.savedMappings || [])
      );
      setEditingTeamCells(new Set());
      setMessage({
        type: conflicts.length > 0 ? "info" : "success",
        text: `Автомапинг готов: ${data.readyMatchesCount || 0} строк с ID. Сохранено привязок: ${
          data.savedCount || 0
        }. Конфликты: ${conflicts.length}.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка автомапинга" });
    } finally {
      setAutoMapping(false);
    }
  }

  async function saveManualTeamMappings(overwriteConflicts = false) {
    if (matches.length === 0) {
      setMessage({ type: "error", text: "Сначала добавьте или распознайте матчи." });
      return;
    }
    if (!hasValidDisciplineId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины перед сохранением ID команд." });
      return;
    }

    setMappingSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/team-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, matches, overwriteConflicts }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось сохранить ID команд");

      const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
      setMappingConflicts(conflicts);
      setMappingSaveSummary({
        savedCount: data.savedCount || 0,
        skippedCount: data.skippedCount || 0,
        conflictCount: data.conflictCount || conflicts.length,
        overwrittenCount: data.overwrittenCount || 0,
      });
      setLockedTeamCells((current) =>
        mergeLockedTeamCellsFromSavedMappings(current, matches, mappedMatches, data.savedMappings || [])
      );
      if (!conflicts.length) setEditingTeamCells(new Set());

      if (conflicts.length > 0) {
        setMessage({
          type: "info",
          text: `Есть конфликты ID: ${conflicts.length}. Без отдельного подтверждения они не перезаписаны.`,
        });
      } else {
        setMessage({
          type: "success",
          text: `ID сохранены: ${data.savedCount || 0}. Пропущено: ${data.skippedCount || 0}.`,
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка сохранения ID команд" });
    } finally {
      setMappingSaving(false);
    }
  }

  async function saveSingleTeamMapping(index: number, side: TeamSide, overwriteConflict = false) {
    const team = getTeamCellData(matches, mappedMatches, index, side);
    const cellKey = getTeamCellKey(index, side);

    if (!hasValidDisciplineId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины, чтобы сохранить привязки команд." });
      return;
    }
    if (!team.name.trim() || !team.platformId.trim()) {
      setMessage({ type: "error", text: "Укажите название команды и ID перед сохранением." });
      return;
    }

    setSavingTeamCells((current) => new Set(current).add(cellKey));
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/team-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disciplineId,
          teamName: team.name,
          platformId: team.platformId,
          canonicalName: team.name,
          overwriteConflict,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось сохранить ID команды");

      const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
      setMappingConflicts(conflicts);
      setMappingSaveSummary({
        savedCount: data.savedCount || 0,
        skippedCount: data.skippedCount || 0,
        conflictCount: data.conflictCount || conflicts.length,
        overwrittenCount: data.overwrittenCount || 0,
      });

      if (conflicts.length > 0 && !overwriteConflict) {
        const conflict = conflicts[0];
        const shouldOverwrite = window.confirm(
          `${conflict.teamName}: уже сохранён ID ${conflict.existingPlatformId}, введён ${conflict.incomingPlatformId}. Заменить сохранённый ID?`
        );
        if (shouldOverwrite) {
          await saveSingleTeamMapping(index, side, true);
          return;
        }

        setMessage({ type: "info", text: "Конфликт ID не перезаписан." });
        return;
      }

      if ((data.savedCount || 0) > 0) {
        setLockedTeamCells((current) => new Set(current).add(cellKey));
        setEditingTeamCells((current) => removeFromSet(current, cellKey));
        setMessage({ type: "success", text: `${team.name}: ID ${team.platformId} сохранён для дисциплины ${disciplineId}.` });
      } else {
        setMessage({ type: "info", text: `${team.name}: нечего сохранять. Проверьте название и ID.` });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка сохранения ID команды" });
    } finally {
      setSavingTeamCells((current) => removeFromSet(current, cellKey));
    }
  }

  async function openServiceUpload() {
    if (selectedMatches.length === 0) {
      setMessage({ type: "error", text: "Выберите матчи для заливки через сервис." });
      return;
    }

    const openedWindow = window.open("", "_blank");
    if (!openedWindow) {
      setMessage({ type: "error", text: "Не удалось открыть сервис. Разрешите всплывающие окна для этого сайта." });
      return;
    }
    openedWindow.opener = null;

    setSending(true);
    setMessage(null);
    setLastServiceJsonUrl("");

    try {
      const response = await fetch("/api/manual-import/service-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, shapkaId, matches: selectedMatches, publicOrigin: window.location.origin }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Не удалось создать ссылку для сервиса");
      }

      const jsonUrl = typeof data.jsonUrl === "string" ? data.jsonUrl : "";
      if (!jsonUrl) throw new Error("Сервис не вернул JSON-ссылку.");

      setLastServiceJsonUrl(jsonUrl);
      const copied = await copyToClipboard(jsonUrl);
      openedWindow.location.href = data.serviceUrl;
      setMessage({
        type: copied ? "success" : "info",
        text: copied
          ? `Сервис открыт, JSON-ссылка скопирована. Выбрано матчей: ${selectedMatches.length}.`
          : "Сервис открыт, но браузер запретил автокопирование. Скопируйте JSON-ссылку из поля ниже.",
        raw: copied ? undefined : jsonUrl,
      });
    } catch (error) {
      if (!openedWindow.closed) openedWindow.close();
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка сервиса" });
    } finally {
      setSending(false);
    }
  }

  function addEmptyMatch() {
    setMatches((current) => [
      ...current,
      {
        tournament: "Manual Import",
        team1: "",
        team2: "",
        team1PlatformId: "",
        team2PlatformId: "",
        date: "",
      },
    ]);
    setSelectedMatchIndexes((current) => new Set([...current, matches.length]));
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
  }

  function updateMatch(index: number, field: keyof ManualMatch, value: string) {
    setMatches((current) => current.map((match, i) => (i === index ? { ...match, [field]: value } : match)));
    const side = getTeamSideFromMatchField(field);
    if (side) {
      const cellKey = getTeamCellKey(index, side);
      setLockedTeamCells((current) => removeFromSet(current, cellKey));
    }
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
  }

  function removeMatch(index: number) {
    setMatches((current) => current.filter((_, i) => i !== index));
    setMappedMatches((current) => current.filter((_, i) => i !== index));
    setSelectedMatchIndexes((current) => {
      const next = new Set<number>();
      for (const selectedIndex of current) {
        if (selectedIndex < index) next.add(selectedIndex);
        if (selectedIndex > index) next.add(selectedIndex - 1);
      }
      return next;
    });
    setLockedTeamCells((current) => shiftTeamCellSetAfterRemove(current, index));
    setEditingTeamCells((current) => shiftTeamCellSetAfterRemove(current, index));
    setSavingTeamCells((current) => shiftTeamCellSetAfterRemove(current, index));
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
  }

  function toggleMatchSelection(index: number) {
    setSelectedMatchIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
    setPreview(null);
    setLastServiceJsonUrl("");
  }

  function toggleAllMatchesSelection() {
    setSelectedMatchIndexes((current) =>
      current.size === matches.length ? new Set() : createAllSelectedIndexes(matches.length)
    );
    setPreview(null);
    setLastServiceJsonUrl("");
  }

  function applyTimeShift(direction: -1 | 1) {
    const minutes = Math.trunc(Number(timeShiftMinutes.replace(",", ".")));
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setMessage({ type: "error", text: "Введите количество минут больше нуля." });
      return;
    }
    if (matches.length === 0) {
      setMessage({ type: "error", text: "Сначала распознайте или добавьте матчи." });
      return;
    }

    const result = shiftManualImportMatchDates(matches, minutes * direction);
    if (result.changedCount === 0) {
      setMessage({ type: "error", text: "Не удалось сдвинуть время: в матчах нет распознанных дат." });
      return;
    }

    setMatches(result.matches);
    setMappedMatches((current) =>
      current.map((mapped, index) => ({
        ...mapped,
        date: result.matches[index]?.date || mapped.date,
      }))
    );
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setLastServiceJsonUrl("");
    setMessage({
      type: "success",
      text: `Время ${direction > 0 ? "увеличено" : "уменьшено"} на ${minutes} мин. Изменено: ${
        result.changedCount
      }, пропущено: ${result.skippedCount}.`,
    });
  }

  function renderTeamPlatformIdCell(index: number, side: TeamSide, value: string) {
    const cellKey = getTeamCellKey(index, side);
    const isLocked = lockedTeamCells.has(cellKey);
    const isEditing = editingTeamCells.has(cellKey);
    const isSaving = savingTeamCells.has(cellKey);
    const team = getTeamCellData(matches, mappedMatches, index, side);
    const field: keyof ManualMatch = side === "team1" ? "team1PlatformId" : "team2PlatformId";
    const inputDisabled = isLocked && !isEditing;

    return (
      <div className="flex min-w-[150px] flex-col gap-1">
        <input
          value={value}
          onChange={(event) => updateMatch(index, field, event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="НЕТ ID"
          disabled={inputDisabled}
          className={`h-9 w-32 rounded-lg border px-3 text-xs font-black outline-none transition focus:border-indigo-400 ${
            inputDisabled
              ? "border-emerald-100 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-white text-slate-900"
          }`}
        />
        {isLocked && !isEditing ? (
          <button
            type="button"
            onClick={() => setEditingTeamCells((current) => new Set(current).add(cellKey))}
            className="flex h-7 w-32 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-[9px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-slate-50"
          >
            <Pencil className="h-3 w-3" />
            Изменить
          </button>
        ) : (
          <button
            type="button"
            onClick={() => saveSingleTeamMapping(index, side)}
            disabled={isSaving || !team.name.trim() || !value.trim() || !hasValidDisciplineId}
            className="flex h-7 w-32 items-center justify-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50 text-[9px] font-black uppercase tracking-widest text-emerald-700 transition hover:bg-emerald-100 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Сохранить
          </button>
        )}
      </div>
    );
  }

  const visibleRecognitionStages = getVisibleRecognitionStages(recognitionStage, recognitionStepDetails);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px_220px] lg:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-600">Manual import</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Ручной импорт матчей</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-slate-600">
              Фото сначала распознает ArcCodex AI, локальный OCR остается резервом для сложных случаев.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Шаг 1 · ID дисциплины
            </label>
            <input
              value={disciplineId}
              onChange={(event) => {
                const nextDisciplineId = event.target.value.replace(/[^\d]/g, "");
                setDisciplineId(nextDisciplineId);
                setLockedTeamCells(new Set());
                setEditingTeamCells(new Set());
                setPreview(null);
                setMappingConflicts([]);
                setMappingSaveSummary(null);
                setLastServiceJsonUrl("");
              }}
              inputMode="numeric"
              placeholder="73"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Шаг 2 · ID шапки
            </label>
            <input
              value={shapkaId}
              onChange={(event) => {
                setShapkaId(event.target.value.replace(/[^\d]/g, ""));
                setPreview(null);
                setLastServiceJsonUrl("");
              }}
              inputMode="numeric"
              placeholder="12345"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
          </div>
        </div>
        {(!hasValidDisciplineId || !hasValidShapkaId) && (
          <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {!hasValidDisciplineId && (
                <p>ID дисциплины нужен для автомапинга и постоянного сохранения ID команд.</p>
              )}
              {!hasValidShapkaId && <p>ID шапки понадобится перед формированием payload и заливкой.</p>}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">Команды / спортсмены для автомапинга</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">
              Обновите источник под выбранную дисциплину перед распознаванием матчей.
            </p>
          </div>
          <div className="flex w-fit rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setTeamImportMode("file")}
              className={`rounded-md px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                teamImportMode === "file" ? "bg-white text-slate-950 shadow-sm" : "text-slate-400"
              }`}
            >
              Файл
            </button>
            <button
              onClick={() => setTeamImportMode("url")}
              className={`rounded-md px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                teamImportMode === "url" ? "bg-white text-slate-950 shadow-sm" : "text-slate-400"
              }`}
            >
              Ссылка
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_180px] lg:items-end">
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              {teamImportMode === "file" ? "Excel файл (.xlsx)" : "Google Sheets URL"}
            </label>
            {teamImportMode === "file" ? (
              <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-sm font-bold text-slate-500 transition hover:border-indigo-300 hover:bg-indigo-50/40">
                <FileUp className="h-5 w-5 text-indigo-500" />
                <span className="truncate">{teamFile ? teamFile.name : "Выберите файл из админки"}</span>
                <input key={`team-file-${disciplineId}`} type="file" accept=".xlsx" onChange={handleTeamFileChange} className="hidden" />
              </label>
            ) : (
              <input
                value={teamUrl}
                onChange={(event) => setTeamUrl(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/..."
                className="h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
            )}
          </div>
          <button
            onClick={importTeams}
            disabled={teamImporting || (teamImportMode === "file" ? !teamFile : !teamUrl.trim())}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-600 disabled:bg-slate-100 disabled:text-slate-400"
          >
            {teamImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Импорт
          </button>
        </div>

        {teamImportResult && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Импортировано: <span className="text-slate-950">{teamImportResult.importedCount || 0}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Команд в базе: <span className="text-slate-950">{teamImportResult.mappingResult?.adminTeamsCount || 0}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Найдено маппингов: <span className="text-slate-950">{teamImportResult.mappingResult?.liquipediaTeamsFound || 0}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Автомапинг: <span className="text-slate-950">{teamImportResult.mappingResult?.autoMappedCount || 0}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Спорные: <span className="text-slate-950">{teamImportResult.mappingResult?.ambiguousCount || 0}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Без ID: <span className="text-slate-950">{teamImportResult.mappingResult?.unmappedCount || 0}</span>
              </div>
            </div>
            {teamImportResult.mappingResult?.newlyMappedNames?.length ? (
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                Новые маппинги: {teamImportResult.mappingResult.newlyMappedNames.slice(0, 6).join(", ")}
                {teamImportResult.mappingResult.newlyMappedNames.length > 6 ? "..." : ""}
              </p>
            ) : null}
            {teamImportResult.detectedLayout ? (
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Колонки: ID {teamImportResult.detectedLayout.idCol + 1}, название {teamImportResult.detectedLayout.nameCol + 1}
                {teamImportResult.detectedLayout.source === "data" ? " (без шапки)" : ""}
              </p>
            ) : null}
          </div>
        )}

        {teamImportMessage && (
          <div
            className={`mt-4 rounded-2xl border p-4 text-xs font-bold ${
              teamImportMessage.type === "success"
                ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                : teamImportMessage.type === "error"
                  ? "border-rose-100 bg-rose-50 text-rose-800"
                  : "border-sky-100 bg-sky-50 text-sky-800"
            }`}
          >
            {teamImportMessage.text}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-5">
            <div>
              <h2 className="text-xl font-black text-slate-950">Фото или текст</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">Скрин расписания, OCR-текст или копипаст из HLTV.</p>
            </div>
            <div className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600">
              OCR + AI
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/30 p-6 text-center transition hover:bg-indigo-50">
              <ImageUp className="h-9 w-9 text-indigo-500" />
              <span className="mt-3 text-sm font-black text-slate-950">
                {imageItems.length > 0 ? `Скринов в очереди: ${imageItems.length}/${MANUAL_IMPORT_MAX_IMAGES}` : "Ctrl+V или выбрать скрины"}
              </span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                до {MANUAL_IMPORT_MAX_IMAGES} файлов · png / jpg / webp
              </span>
              <input
                key={`image-file-${disciplineId}`}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <textarea
                value={rawText}
                onChange={(event) => {
                  setRawText(event.target.value);
                  setPreview(null);
                }}
                placeholder="Вставьте текст расписания или OCR..."
                className="h-36 w-full resize-none rounded-xl border-0 bg-white p-4 text-xs font-semibold leading-relaxed text-slate-800 outline-none"
              />
            </div>
          </div>

          {imageItems.length > 0 && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
                    <Images className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-950">Очередь скринов</h3>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {imageItems.length}/{MANUAL_IMPORT_MAX_IMAGES} · вставляйте через Ctrl+V
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearImageItems}
                  disabled={parsing}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  Очистить все
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {imageItems.map((item, index) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div
                      className="relative h-28 overflow-hidden rounded-xl border border-slate-100 bg-slate-100 bg-cover bg-center"
                      style={{ backgroundImage: `url(${item.previewUrl})` }}
                      aria-label={item.name}
                    >
                      <button
                        type="button"
                        onClick={() => removeImageItem(item.id)}
                        disabled={parsing}
                        aria-label={`Удалить скрин ${item.name}`}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-slate-950">
                          {index + 1}. {item.name}
                        </p>
                        <p className="mt-1 text-[10px] font-bold text-slate-400">
                          {item.rawMatches?.length ? `Матчей: ${item.rawMatches.length}` : item.error || "Ожидает распознавания"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${getImageStatusClass(
                          item.status
                        )}`}
                      >
                        {getImageStatusLabel(item.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchSummary && (
            <div className="mt-5 grid gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-[10px] font-black uppercase tracking-widest text-emerald-800 sm:grid-cols-3 xl:grid-cols-6">
              <div>Скринов: {batchSummary.total}</div>
              <div>Успешно: {batchSummary.success}</div>
              <div>Без матчей: {batchSummary.empty}</div>
              <div>Ошибок: {batchSummary.error}</div>
              <div>Матчей: {batchSummary.matches}</div>
              <div>Дубли: {batchSummary.duplicatesRemoved}</div>
            </div>
          )}

          {recognitionStage !== "idle" && (
            <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black text-slate-950">Ход распознавания</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                    {recognitionStage === "done" ? "готово" : "в процессе"}
                  </span>
                  {parsing && (
                    <button
                      type="button"
                      onClick={abortRecognition}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-slate-50"
                    >
                      Отменить
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {visibleRecognitionStages.map((stage) => {
                  const status = getRecognitionStageStatus(recognitionStage, stage.id, visibleRecognitionStages);
                  const isActive = status === "active";
                  const isDone = status === "done";
                  return (
                    <div
                      key={stage.id}
                      className={`rounded-xl border px-3 py-2 transition ${
                        isActive
                          ? "border-indigo-200 bg-white text-indigo-700 shadow-sm"
                          : isDone
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-slate-100 bg-white/60 text-slate-400"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isActive ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : isDone ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full border border-current opacity-40" />
                        )}
                        <span className="text-[10px] font-black uppercase tracking-widest">{stage.label}</span>
                      </div>
                      {recognitionStepDetails[stage.id] && (
                        <p className="mt-1 text-[10px] font-bold leading-snug opacity-80">{recognitionStepDetails[stage.id]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(ocrText || parseSource || parseWarnings.length > 0 || ocrFallbackAvailable) && (
            <div className="mt-5 rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sky-600 shadow-sm">
                    <ScanText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-950">Диагностика распознавания</h3>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-sky-700">
                      {getParseSourceLabel(parseSource)}
                      {ocrConfidence !== null ? ` • confidence ${Math.round(ocrConfidence)}%` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ocrText && (
                    <button
                      onClick={() => parseMatches({ useOcrText: true })}
                      disabled={parsing || !ocrText.trim()}
                      className="flex h-10 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-sky-700 transition hover:bg-sky-100 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
                    >
                      {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Повторить по OCR
                    </button>
                  )}
                  {aiFallbackAvailable && (
                    <button
                      onClick={runAiFallback}
                      disabled={parsing}
                      className="flex h-10 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-600 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-indigo-700 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
                    >
                      {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      AI fallback
                    </button>
                  )}
                  {ocrFallbackAvailable && (
                    <button
                      onClick={runOcrFallback}
                      disabled={parsing}
                      className="flex h-10 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-500 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-amber-600 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
                    >
                      {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                      OCR fallback для ошибок
                    </button>
                  )}
                </div>
              </div>

              {ocrText && (
                <textarea
                  value={ocrText}
                  onChange={(event) => {
                    setOcrText(event.target.value);
                    setPreview(null);
                  }}
                  className="mt-4 h-36 w-full resize-none rounded-xl border border-sky-100 bg-white p-3 text-xs font-semibold leading-relaxed text-slate-800 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-300/20"
                />
              )}

              {parseWarnings.length > 0 && (
                <div className="mt-3 space-y-1 rounded-xl border border-amber-100 bg-white/70 p-3 text-[11px] font-bold text-amber-800">
                  {parseWarnings.map((warning, index) => (
                    <div key={`parse-warning-${index}`}>{warning}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => parseMatches()}
              disabled={parsing}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Распознать
            </button>
            <button
              onClick={addEmptyMatch}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-black uppercase tracking-widest text-slate-600 transition hover:bg-slate-50"
            >
              <Table2 className="h-4 w-4" />
              Добавить матч
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black">Данные для заливки</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">JSON / PHP / сервис</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-right">
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Готово</div>
              <div className="text-2xl font-black text-white">{selectedReadyCount}</div>
              <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                выбрано {selectedCount}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <button
              onClick={runPreview}
              disabled={previewing || selectedCount === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-950 transition hover:bg-indigo-50 disabled:bg-white/10 disabled:text-slate-500"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              Сформировать {selectedCount ? `(${selectedCount})` : ""}
            </button>
            <button
              onClick={sendToAdmin}
              disabled={sending || !preview?.phpArray || selectedCount === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-400 disabled:bg-white/10 disabled:text-slate-500"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Залить в API
            </button>
            <button
              onClick={openServiceUpload}
              disabled={sending || selectedCount === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-slate-500"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Залить через сервис
            </button>
            {matches.length > 0 && selectedCount === 0 && (
              <p className="text-[11px] font-bold text-slate-400">Выберите хотя бы один матч в таблице ниже.</p>
            )}
          </div>

          {lastServiceJsonUrl && (
            <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-emerald-200">
                JSON-ссылка для сервиса
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={lastServiceJsonUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-[11px] font-bold text-white outline-none"
                />
                <button
                  onClick={async () => {
                    const copied = await copyToClipboard(lastServiceJsonUrl);
                    setMessage({
                      type: copied ? "success" : "info",
                      text: copied
                        ? "JSON-ссылка скопирована."
                        : "Не удалось скопировать автоматически. Выделите ссылку в поле и скопируйте вручную.",
                      raw: copied ? undefined : lastServiceJsonUrl,
                    });
                  }}
                  className="flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-50"
                >
                  <Clipboard className="h-3 w-3" />
                  Копировать
                </button>
              </div>
            </div>
          )}

          {preview?.phpArray && (
            <div className="mt-5 space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(preview.phpArray, null, 2))}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-300"
                >
                  <Clipboard className="h-3 w-3" />
                  Копировать JSON
                </button>
                <button
                  onClick={() => copyToClipboard(preview.phpArrayText)}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-300"
                >
                  <Clipboard className="h-3 w-3" />
                  Копировать PHP
                </button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/20 p-4 text-[10px] leading-relaxed text-slate-300">
                {preview.phpArrayText}
              </pre>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">Матчи</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">Можно поправить строки вручную и пересобрать payload.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 text-[10px] font-black uppercase tracking-widest text-slate-500 shadow-sm">
              <Clock className="h-4 w-4 text-indigo-500" />
              <span className="hidden sm:inline">Сдвиг времени</span>
              <input
                value={timeShiftMinutes}
                onChange={(event) => setTimeShiftMinutes(event.target.value.replace(/[^\d.,]/g, ""))}
                inputMode="decimal"
                aria-label="Количество минут для сдвига времени всех матчей"
                className="h-8 w-16 rounded-lg border border-slate-200 bg-slate-50 px-2 text-center text-xs font-black text-slate-900 outline-none transition focus:border-indigo-400"
              />
              <span>мин</span>
              <button
                type="button"
                onClick={() => applyTimeShift(-1)}
                disabled={matches.length === 0}
                aria-label="Вычесть минуты из времени всех матчей"
                title="Вычесть минуты из времени всех матчей"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:bg-slate-50 disabled:text-slate-300"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => applyTimeShift(1)}
                disabled={matches.length === 0}
                aria-label="Добавить минуты ко времени всех матчей"
                title="Добавить минуты ко времени всех матчей"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-700 transition hover:bg-indigo-100 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              onClick={toggleAllMatchesSelection}
              disabled={matches.length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:bg-slate-50 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
            >
              {allMatchesSelected ? "Снять все" : "Выбрать все"}
            </button>
            <button
              onClick={runAutoMap}
              disabled={autoMapping || matches.length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 text-[10px] font-black uppercase tracking-widest text-indigo-700 transition hover:bg-indigo-100 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
            >
              {autoMapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Авто-мапинг
            </button>
            <button
              onClick={() => saveManualTeamMappings(false)}
              disabled={mappingSaving || matches.length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:bg-emerald-100 disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
            >
              {mappingSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Запомнить ID
            </button>
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Bot className="h-4 w-4 text-indigo-500" />
              {selectedCount}/{matches.length} выбрано · {totalReadyCount} готово
            </div>
          </div>
        </div>

        {(mappingSaveSummary || mappingConflicts.length > 0) && (
          <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
            {mappingSaveSummary && (
              <div className="grid gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-800 sm:grid-cols-4">
                <div>Сохранено: {mappingSaveSummary.savedCount}</div>
                <div>Пропущено: {mappingSaveSummary.skippedCount}</div>
                <div>Конфликты: {mappingSaveSummary.conflictCount}</div>
                <div>Заменено: {mappingSaveSummary.overwrittenCount}</div>
              </div>
            )}
            {mappingConflicts.length > 0 && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1 text-xs font-bold text-amber-800">
                  {mappingConflicts.slice(0, 8).map((conflict) => (
                    <div key={`${conflict.normalizedTeamName}-${conflict.incomingPlatformId}`}>
                      {conflict.teamName}: сохранён {conflict.existingPlatformId}, введён {conflict.incomingPlatformId}
                    </div>
                  ))}
                  {mappingConflicts.length > 8 && <div>И ещё конфликтов: {mappingConflicts.length - 8}</div>}
                </div>
                <button
                  onClick={() => saveManualTeamMappings(true)}
                  disabled={mappingSaving}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-amber-600 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {mappingSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Заменить конфликтующие
                </button>
              </div>
            )}
          </div>
        )}

        {matches.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center text-sm font-bold text-slate-400">
            После распознавания матчи появятся здесь.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allMatchesSelected}
                      onChange={toggleAllMatchesSelection}
                      aria-label="Выбрать все матчи"
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="px-3 py-2">Дата</th>
                  <th className="px-3 py-2">Команда 1</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Команда 2</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matches.map((match, index) => {
                  const mapped = mappedMatches[index];
                  const team1PlatformId = match.team1PlatformId || mapped?.team1.platformId || "";
                  const team2PlatformId = match.team2PlatformId || mapped?.team2.platformId || "";
                  const isReady = Boolean(team1PlatformId && team2PlatformId);
                  const isSelected = selectedMatchIndexes.has(index);
                  return (
                    <tr
                      key={`${match.team1}-${match.team2}-${index}`}
                      className={`text-xs font-bold text-slate-700 transition ${
                        isSelected ? "bg-white" : "bg-slate-50/70 opacity-70"
                      }`}
                    >
                      <td className="px-3 py-3 align-middle">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleMatchSelection(index)}
                          aria-label={`Выбрать матч ${match.team1} против ${match.team2}`}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={match.date || ""}
                          onChange={(event) => updateMatch(index, "date", event.target.value)}
                          placeholder="22.05.2026 18:00:00"
                          className="h-9 w-44 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={match.team1 || ""}
                          onChange={(event) => updateMatch(index, "team1", event.target.value)}
                          className="h-9 w-40 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        {renderTeamPlatformIdCell(index, "team1", team1PlatformId)}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={match.team2 || ""}
                          onChange={(event) => updateMatch(index, "team2", event.target.value)}
                          className="h-9 w-40 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        {renderTeamPlatformIdCell(index, "team2", team2PlatformId)}
                      </td>
                      <td className="px-3 py-3">
                        {isReady ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Готово
                          </span>
                        ) : (
                          <span className="rounded-full bg-rose-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-rose-600">
                            Нужен ID
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => removeMatch(index)}
                          className="rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {message && (
        <div
          className={`rounded-2xl border p-5 text-sm font-bold ${
            message.type === "success"
              ? "border-emerald-100 bg-emerald-50 text-emerald-800"
              : message.type === "error"
                ? "border-rose-100 bg-rose-50 text-rose-800"
                : "border-sky-100 bg-sky-50 text-sky-800"
          }`}
        >
          <p>{message.text}</p>
          {message.raw && <pre className="mt-3 max-h-32 overflow-auto rounded-xl bg-white/70 p-3 text-[10px]">{message.raw}</pre>}
        </div>
      )}

      {preview && (preview.warnings.length > 0 || preview.skippedMatches.length > 0) && (
        <section className="rounded-3xl border border-amber-100 bg-amber-50/70 p-6 shadow-soft">
          <h2 className="text-sm font-black uppercase tracking-widest text-amber-800">Проверка</h2>
          <div className="mt-3 space-y-2 text-xs font-bold text-amber-800">
            {preview.warnings.map((warning, index) => (
              <div key={`warning-${index}`}>{warning}</div>
            ))}
            {preview.skippedMatches.map((match, index) => (
              <div key={`skipped-${index}`}>
                {match.teams}: {match.reason}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function getParseSourceLabel(source?: string) {
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

async function copyToClipboard(value: string) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to textarea fallback
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    activeElement?.focus({ preventScroll: true });
  }
}

function mergeMatchesWithMappedIds(matches: ManualMatch[], mappedMatches: MappedMatch[]) {
  return matches.map((match, index) => {
    const mapped = mappedMatches[index];
    return {
      ...match,
      team1PlatformId: match.team1PlatformId || mapped?.team1.platformId || "",
      team2PlatformId: match.team2PlatformId || mapped?.team2.platformId || "",
    };
  });
}

function createAllSelectedIndexes(length: number) {
  return new Set(Array.from({ length }, (_, index) => index));
}

function isValidManualAdminId(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}

function getTeamCellKey(index: number, side: TeamSide) {
  return `${index}:${side}`;
}

function createLockedTeamCellsFromMappedMatches(mappedMatches: MappedMatch[]) {
  const locked = new Set<string>();
  mappedMatches.forEach((match, index) => {
    if (match.team1.platformId && match.team1.source === "manual") locked.add(getTeamCellKey(index, "team1"));
    if (match.team2.platformId && match.team2.source === "manual") locked.add(getTeamCellKey(index, "team2"));
  });
  return locked;
}

function mergeLockedTeamCellsFromSavedMappings(
  current: Set<string>,
  matches: ManualMatch[],
  mappedMatches: MappedMatch[],
  savedMappings: Array<{ teamName?: string; normalizedTeamName?: string; platformId?: string }>
) {
  const savedNames = new Set(
    savedMappings
      .flatMap((mapping) => [
        mapping.normalizedTeamName || "",
        normalizeManualTeamNameForClient(mapping.teamName || ""),
      ])
      .filter(Boolean)
  );
  if (savedNames.size === 0) return current;

  const next = new Set(current);
  matches.forEach((match, index) => {
    for (const side of ["team1", "team2"] as const) {
      const team = getTeamCellData(matches, mappedMatches, index, side);
      const normalizedTeamName = normalizeManualTeamNameForClient(team.name);
      if (team.platformId && (savedNames.has(normalizedTeamName) || savedNames.has(normalizedTeamName.replace(/\s+/g, "")))) {
        next.add(getTeamCellKey(index, side));
      }
    }
  });
  return next;
}

function getTeamCellData(matches: ManualMatch[], mappedMatches: MappedMatch[], index: number, side: TeamSide) {
  const match = matches[index];
  const mapped = mappedMatches[index];
  if (side === "team1") {
    return {
      name: match?.team1 || mapped?.team1.name || "",
      platformId: match?.team1PlatformId || mapped?.team1.platformId || "",
    };
  }

  return {
    name: match?.team2 || mapped?.team2.name || "",
    platformId: match?.team2PlatformId || mapped?.team2.platformId || "",
  };
}

function normalizeManualTeamNameForClient(value: string) {
  return value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

function removeFromSet<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  next.delete(value);
  return next;
}

function shiftTeamCellSetAfterRemove(set: Set<string>, removedIndex: number) {
  const next = new Set<string>();
  for (const key of set) {
    const [rawIndex, side] = key.split(":") as [string, TeamSide | undefined];
    const index = Number(rawIndex);
    if (!Number.isSafeInteger(index) || (side !== "team1" && side !== "team2")) continue;
    if (index < removedIndex) next.add(key);
    if (index > removedIndex) next.add(getTeamCellKey(index - 1, side));
  }
  return next;
}

function getTeamSideFromMatchField(field: keyof ManualMatch): TeamSide | null {
  if (field === "team1" || field === "team1PlatformId") return "team1";
  if (field === "team2" || field === "team2PlatformId") return "team2";
  return null;
}

function getSelectedMatches(matches: ManualMatch[], selectedIndexes: Set<number>) {
  return matches.filter((_, index) => selectedIndexes.has(index));
}

function mergeSelectedMatchesWithMappedIds(
  matches: ManualMatch[],
  selectedIndexes: Set<number>,
  mappedMatches: MappedMatch[]
) {
  let mappedIndex = 0;
  return matches.map((match, index) => {
    if (!selectedIndexes.has(index)) return match;
    const mapped = mappedMatches[mappedIndex++];
    return {
      ...match,
      team1PlatformId: match.team1PlatformId || mapped?.team1.platformId || "",
      team2PlatformId: match.team2PlatformId || mapped?.team2.platformId || "",
    };
  });
}

function mergeSelectedMappedMatches(
  currentMappedMatches: MappedMatch[],
  selectedIndexes: Set<number>,
  nextMappedMatches: MappedMatch[]
) {
  let mappedIndex = 0;
  const merged = [...currentMappedMatches];
  for (const selectedIndex of Array.from(selectedIndexes).sort((a, b) => a - b)) {
    const mapped = nextMappedMatches[mappedIndex++];
    if (mapped) merged[selectedIndex] = mapped;
  }
  return merged;
}

function getVisibleRecognitionStages(
  current: RecognitionStage,
  details: Partial<Record<RecognitionStage, string>>
) {
  return recognitionStages.filter((stage) => {
    if (stage.id === "preparing" || stage.id === "mapping" || stage.id === "done") return true;
    return current === stage.id || Boolean(details[stage.id]);
  });
}

function getRecognitionStageStatus(
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

function getImageStatusLabel(status: ImageRecognitionStatus) {
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

function getImageStatusClass(status: ImageRecognitionStatus) {
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

async function resizeImageForAi(file: File) {
  return resizeImage(file, {
    maxSide: 1600,
    maxPassthroughBytes: 1.25 * 1024 * 1024,
    outputType: "image/jpeg",
    quality: 0.9,
    suffix: "ai",
  });
}

async function resizeImageForOcr(file: File) {
  return resizeImage(file, {
    maxSide: 2000,
    maxPassthroughBytes: 2 * 1024 * 1024,
    outputType: "image/webp",
    quality: 0.92,
    suffix: "ocr",
  });
}

async function resizeImage(
  file: File,
  options: {
    maxSide: number;
    maxPassthroughBytes: number;
    outputType: "image/webp" | "image/jpeg";
    quality: number;
    suffix: string;
  }
) {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (maxSide <= options.maxSide && file.size <= options.maxPassthroughBytes) {
      bitmap.close?.();
      return file;
    }

    const scale = Math.min(1, options.maxSide / maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, options.outputType, options.quality));
    if (!blob) return file;
    const resizedName = file.name.replace(/\.[^.]+$/, "") || "schedule";
    const extension = options.outputType === "image/jpeg" ? "jpg" : "webp";
    return new File([blob], `${resizedName}-${options.suffix}.${extension}`, { type: options.outputType });
  } catch {
    return file;
  }
}

async function getClientAiImageCacheKey(disciplineId: string, file: File | null, imageDataUrl: string) {
  if (typeof window === "undefined" || !window.crypto?.subtle) return "";
  const source = file ? await file.arrayBuffer() : imageDataUrl ? new TextEncoder().encode(imageDataUrl).buffer : null;
  if (!source) return "";
  const hash = await window.crypto.subtle.digest("SHA-256", source);
  return `${disciplineId.trim() || "manual"}:${Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function getImageFilesFromClipboard(clipboardData: DataTransfer | null) {
  if (!clipboardData?.items) return [];
  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

async function getFileHash(file: File) {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }
  const hash = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fileExtensionFromMime(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "png";
}

async function runImageBatchPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function getClientAiImageCache(key: string) {
  const cached = clientAiImageCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    clientAiImageCache.delete(key);
    return null;
  }
  return {
    rawMatches: cached.rawMatches.map((match) => ({ ...match })),
    normalizedText: cached.normalizedText,
    expiresAt: cached.expiresAt,
  };
}

function setClientAiImageCache(
  key: string,
  value: {
    rawMatches: ManualMatch[];
    normalizedText: string;
  }
) {
  cleanupClientAiImageCache();
  clientAiImageCache.set(key, {
    rawMatches: value.rawMatches.map((match) => ({ ...match })),
    normalizedText: value.normalizedText,
    expiresAt: Date.now() + CLIENT_AI_IMAGE_CACHE_TTL_MS,
  });
}

function cleanupClientAiImageCache() {
  const now = Date.now();
  for (const [key, value] of clientAiImageCache) {
    if (value.expiresAt < now) clientAiImageCache.delete(key);
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
