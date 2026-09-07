"use client";

import { useState, type ChangeEvent } from "react";
import { FileUp, Loader2, UploadCloud } from "lucide-react";
import { isValidManualAdminId } from "./matchModel";
import type { TeamImportResult, ResultMessage } from "./types";
import { readJsonResponse } from "@/services/responseSchema";
import { decodeTeamImportResult } from "./response";

type Props = {
  disciplineId: string;
  onMessage: (message: ResultMessage | null) => void;
};

/** Импорт справочника: проверить дисциплину → загрузить файл/URL → показать результат автомапинга. */
export function ManualImportTeamSource({ disciplineId, onMessage }: Props) {
  const hasValidDisciplineId = isValidManualAdminId(disciplineId);
  const [teamImportMode, setTeamImportMode] = useState<"file" | "url">("file");
  const [teamFile, setTeamFile] = useState<File | null>(null);
  const [teamUrl, setTeamUrl] = useState("");
  const [teamImporting, setTeamImporting] = useState(false);
  const [teamImportResult, setTeamImportResult] = useState<TeamImportResult | null>(null);
  const [teamImportMessage, setTeamImportMessage] = useState<ResultMessage | null>(null);

  async function handleTeamFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setTeamFile(file);
  }

  async function importTeams() {
    if (teamImportMode === "file" && !teamFile) return;
    if (teamImportMode === "url" && !teamUrl.trim()) return;
    if (!hasValidDisciplineId) {
      const errorMessage = { type: "error", text: "Укажите ID дисциплины перед импортом команд." } as const;
      setTeamImportMessage(errorMessage);
      onMessage(errorMessage);
      return;
    }

    setTeamImporting(true);
    setTeamImportResult(null);
    setTeamImportMessage(null);
    onMessage(null);

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
      const data = await readJsonResponse(response, decodeTeamImportResult, "Не удалось импортировать команды");
      if (!data.success) throw new Error("Сервер не подтвердил импорт команд.");

      setTeamImportResult(data);
      const successMessage = {
        type: "success",
        text: `Источник обновлен: ${data.importedCount || 0} записей. Автомапинг: ${data.mappingResult?.autoMappedCount || 0}.`,
      } as const;
      setTeamImportMessage(successMessage);
      onMessage(successMessage);
    } catch (error) {
      const errorMessage = { type: "error", text: error instanceof Error ? error.message : "Ошибка импорта команд" } as const;
      setTeamImportMessage(errorMessage);
      onMessage(errorMessage);
    } finally {
      setTeamImporting(false);
    }
  }

  return (
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
  );
}
