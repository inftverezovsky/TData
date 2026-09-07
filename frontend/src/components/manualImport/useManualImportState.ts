"use client";

import { useEffect, useRef, useState } from "react";
import { type ManualParsedData } from "./response";
import { useAuthenticatedRequest } from "@/components/admin/AdminSessionProvider";
import { type BatchRecognitionSummary } from "@backend/manualImport/imageBatch";
import { mergeMatchesWithMappedIds, createAllSelectedIndexes, isValidManualAdminId, createLockedTeamCellsFromMappedMatches, getSelectedMatches } from "./matchModel";
import type { ManualMatch, MappedMatch, PreviewData, ResultMessage, ParseSource, RecognitionStage, ManualMappingConflict, ManualMappingSaveSummary, ManualImportImageItem } from "./types";

export function useManualImportState() {

  const authenticatedFetch = useAuthenticatedRequest();
  // Входные данные и ход распознавания живут отдельно от готового payload: правки требуют нового предпросмотра.
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

  const activeRecognitionController = useRef<AbortController | null>(null);
  // Параллельные AI-запросы читают актуальную очередь через ref, не через снимок прошлого React-рендера.
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
  const uploadControlsReady = selectedCount > 0 && hasValidDisciplineId && hasValidShapkaId;
  const tableMutationLocked = previewing || sending || autoMapping;

  function beginRecognition() {
    // Новый запуск отменяет старый: один контроллер задаёт срок жизни всех запросов текущего распознавания.
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
    // Завершившийся старый запрос не должен снимать индикатор загрузки более нового запуска.
    if (activeRecognitionController.current === controller) {
      activeRecognitionController.current = null;
      setParsing(false);
    }
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

  function applyParsedData(data: ManualParsedData) {
    // Заменить таблицу результатом распознавания, выбрать новые строки и сбросить блокировки/предпросмотр прошлого набора.
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

  return {
    authenticatedFetch,
    disciplineId,
    setDisciplineId,
    shapkaId,
    setShapkaId,
    rawText,
    setRawText,
    imageItems,
    setImageItems,
    batchSummary,
    setBatchSummary,
    ocrText,
    setOcrText,
    ocrConfidence,
    setOcrConfidence,
    parseSource,
    setParseSource,
    parseWarnings,
    setParseWarnings,
    recognitionStage,
    setRecognitionStage,
    recognitionStepDetails,
    setRecognitionStepDetails,
    aiFallbackAvailable,
    setAiFallbackAvailable,
    ocrFallbackAvailable,
    setOcrFallbackAvailable,
    matches,
    setMatches,
    mappedMatches,
    setMappedMatches,
    selectedMatchIndexes,
    setSelectedMatchIndexes,
    preview,
    setPreview,
    message,
    setMessage,
    parsing,
    setParsing,
    previewing,
    setPreviewing,
    sending,
    setSending,
    autoMapping,
    setAutoMapping,
    mappingSaving,
    setMappingSaving,
    mappingConflicts,
    setMappingConflicts,
    mappingSaveSummary,
    setMappingSaveSummary,
    lastServiceJsonUrl,
    setLastServiceJsonUrl,
    timeShiftMinutes,
    setTimeShiftMinutes,
    lockedTeamCells,
    setLockedTeamCells,
    editingTeamCells,
    setEditingTeamCells,
    savingTeamCells,
    setSavingTeamCells,
    activeRecognitionController,
    imageItemsRef,
    addImageFilesRef,
    selectedMatches,
    selectedCount,
    allMatchesSelected,
    selectedReadyCount,
    totalReadyCount,
    hasValidDisciplineId,
    hasValidShapkaId,
    uploadControlsReady,
    tableMutationLocked,
    setImageItemsState,
    beginRecognition,
    finishRecognition,
    abortRecognition,
    setRecognitionStep,
    applyParsedData
  };
}

export type ManualImportState = ReturnType<typeof useManualImportState>;
