"use client";

import { AlertTriangle, Clipboard, FileJson, ImageUp, Loader2, Pencil, RefreshCw, Save, ScanText, Send, Sparkles, Table2, UploadCloud } from "lucide-react";
import { MANUAL_IMPORT_MAX_IMAGES } from "@backend/manualImport/imageBatch";
import { clearManualMatchPlatformIds, getTeamCellKey, getTeamCellData } from "./matchModel";
import { getParseSourceLabel } from "./recognitionModel";
import { copyToClipboard } from "./browserFiles";
import { ManualImportMatchTable } from "./ManualImportMatchTable";
import { ManualImportTeamSource } from "./ManualImportTeamSource";
import { ManualImportImageQueue } from "./ManualImportImageQueue";
import { ManualImportRecognitionProgress } from "./ManualImportRecognitionProgress";
import type { ManualMatch, TeamSide } from "./types";
import { useManualImportState } from "./useManualImportState";
import { createManualImportApi } from "./api";
import { useManualImportImages } from "./useManualImportImages";
import { useManualImportAiBatch } from "./useManualImportAiBatch";
import { useManualImportRecognition } from "./useManualImportRecognition";
import { useManualImportMapping } from "./useManualImportMapping";
import { useManualImportDelivery } from "./useManualImportDelivery";
import { useManualImportTable } from "./useManualImportTable";

/** Экран связывает состояние, контроллеры сценариев и секции UI; сеть и распознавание вынесены в соседние модули. */
export default function ManualImportWorkbench() {
  const state = useManualImportState();
  const api = createManualImportApi(state.disciplineId);
  const images = useManualImportImages(state);
  const batch = useManualImportAiBatch(state, api, images);
  const recognition = useManualImportRecognition(state, api, images, batch);
  const mapping = useManualImportMapping(state);
  const delivery = useManualImportDelivery(state);
  const table = useManualImportTable(state);
  const { disciplineId, setDisciplineId, shapkaId, setShapkaId, rawText, setRawText, imageItems, batchSummary, ocrText, setOcrText, ocrConfidence, parseSource, parseWarnings, recognitionStage, recognitionStepDetails, aiFallbackAvailable, ocrFallbackAvailable, matches, setMatches, mappedMatches, setMappedMatches, selectedMatchIndexes, preview, setPreview, message, setMessage, parsing, previewing, sending, autoMapping, mappingSaving, mappingConflicts, setMappingConflicts, mappingSaveSummary, setMappingSaveSummary, lastServiceJsonUrl, setLastServiceJsonUrl, timeShiftMinutes, setTimeShiftMinutes, lockedTeamCells, setLockedTeamCells, editingTeamCells, setEditingTeamCells, savingTeamCells, selectedCount, allMatchesSelected, selectedReadyCount, totalReadyCount, hasValidDisciplineId, hasValidShapkaId, uploadControlsReady, abortRecognition } = state;
  const { handleImageChange, removeImageItem, clearImageItems } = images;
  const { parseMatches, runAiFallback, runOcrFallback } = recognition;
  const { runAutoMap, saveManualTeamMappings, saveSingleTeamMapping } = mapping;
  const { runPreview, sendToAdmin, openServiceUpload } = delivery;
  const { addEmptyMatch, updateMatch, removeMatch, toggleMatchSelection, toggleAllMatchesSelection, applyTimeShift } = table;

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
          aria-label={`ID команды ${side === "team1" ? 1 : 2}, матч ${index + 1}`}
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
            <label htmlFor="manual-discipline" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Шаг 1 · ID дисциплины
            </label>
            <input
              id="manual-discipline"
              value={disciplineId}
              onChange={(event) => {
                const nextDisciplineId = event.target.value.replace(/[^\d]/g, "");
                setDisciplineId(nextDisciplineId);
                setMatches((current) => current.map(clearManualMatchPlatformIds));
                setMappedMatches([]);
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
            <label htmlFor="manual-shapka" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Шаг 2 · ID шапки
            </label>
            <input
              id="manual-shapka"
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

      <ManualImportTeamSource disciplineId={disciplineId} onMessage={setMessage} />

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
                className="sr-only"
              />
            </label>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <textarea
                aria-label="Текст расписания"
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

          <ManualImportImageQueue
            imageItems={imageItems}
            parsing={parsing}
            onClear={clearImageItems}
            onRemove={removeImageItem}
          />

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

          <ManualImportRecognitionProgress
            recognitionStage={recognitionStage}
            recognitionStepDetails={recognitionStepDetails}
            parsing={parsing}
            onAbort={abortRecognition}
          />

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
                  aria-label="Распознанный OCR текст"
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

        <section data-panel-theme="dark" className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-soft">
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
              disabled={previewing || !uploadControlsReady}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-950 transition hover:bg-indigo-50 disabled:bg-white/10 disabled:text-slate-500"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              Сформировать {selectedCount ? `(${selectedCount})` : ""}
            </button>
            <button
              onClick={sendToAdmin}
              disabled={sending || !preview?.phpArray || !uploadControlsReady}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-400 disabled:bg-white/10 disabled:text-slate-500"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Залить в API
            </button>
            <button
              onClick={openServiceUpload}
              disabled={sending || !uploadControlsReady}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-slate-500"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Залить через сервис
            </button>
            {matches.length > 0 && selectedCount === 0 && (
              <p className="text-[11px] font-bold text-slate-400">Выберите хотя бы один матч в таблице ниже.</p>
            )}
            {selectedCount > 0 && (!hasValidDisciplineId || !hasValidShapkaId) && (
              <p className="text-[11px] font-bold text-amber-200">Для заливки нужны ID дисциплины и ID шапки.</p>
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

      <ManualImportMatchTable
        matches={matches}
        mappedMatches={mappedMatches}
        timeShiftMinutes={timeShiftMinutes}
        setTimeShiftMinutes={setTimeShiftMinutes}
        applyTimeShift={applyTimeShift}
        toggleAllMatchesSelection={toggleAllMatchesSelection}
        allMatchesSelected={allMatchesSelected}
        runAutoMap={runAutoMap}
        autoMapping={autoMapping}
        saveManualTeamMappings={saveManualTeamMappings}
        mappingSaving={mappingSaving}
        selectedCount={selectedCount}
        totalReadyCount={totalReadyCount}
        mappingSaveSummary={mappingSaveSummary}
        mappingConflicts={mappingConflicts}
        selectedMatchIndexes={selectedMatchIndexes}
        toggleMatchSelection={toggleMatchSelection}
        updateMatch={updateMatch}
        renderTeamPlatformIdCell={renderTeamPlatformIdCell}
        removeMatch={removeMatch}
      />

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
