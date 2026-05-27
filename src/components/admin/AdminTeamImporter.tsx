"use client";

import React, { useState } from "react";

type BindingMode = "discipline" | "id";
type KnownDisciplineOption =
  | "dota2"
  | "counterstrike"
  | "valorant"
  | "leagueoflegends"
  | "beachvolleyball-men"
  | "beachvolleyball-women"
  | "custom";

const DISCIPLINE_OPTIONS: Array<{ value: KnownDisciplineOption; label: string }> = [
  { value: "dota2", label: "Dota 2" },
  { value: "counterstrike", label: "Counter-Strike" },
  { value: "valorant", label: "Valorant" },
  { value: "leagueoflegends", label: "League of Legends" },
  { value: "beachvolleyball-men", label: "Пляжный волейбол (м)" },
  { value: "beachvolleyball-women", label: "Пляжный волейбол (ж)" },
  { value: "custom", label: "Другая" },
];

export function AdminTeamImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [importMode, setImportMode] = useState<"file" | "url">("file");
  const [bindingMode, setBindingMode] = useState<BindingMode>("discipline");
  const [discipline, setDiscipline] = useState<KnownDisciplineOption>("dota2");
  const [customDiscipline, setCustomDiscipline] = useState("");
  const [sportId, setSportId] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const disciplineScope = discipline === "custom" ? normalizeDisciplineKey(customDiscipline) : discipline;
  const idScope = normalizeSportId(sportId);
  const targetKey = bindingMode === "id" ? idScope : disciplineScope;
  const canImportSource = importMode === "file" ? Boolean(file) : Boolean(url.trim());
  const canImport = canImportSource && Boolean(targetKey) && status !== "uploading";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!canImport) return;

    setStatus("uploading");
    setError(null);

    const formData = new FormData();
    if (importMode === "file" && file) {
      formData.append("file", file);
    } else {
      formData.append("url", url);
    }
    if (bindingMode === "id") {
      formData.append("disciplineId", idScope);
    } else {
      formData.append("disciplineSlug", disciplineScope);
    }

    try {
      const response = await fetch("/api/admin-teams/import", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to upload");
      }

      setResult(data);
      setStatus("success");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  };

  return (
    <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm relative overflow-hidden group">
      <div className="absolute -top-6 -right-6 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
        <svg className="w-32 h-32 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Импорт команд</h2>
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">Excel / Google Sheets</p>
          </div>
          
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button 
              onClick={() => setImportMode("file")}
              className={`px-3 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${importMode === "file" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >
              Файл
            </button>
            <button 
              onClick={() => setImportMode("url")}
              className={`px-3 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${importMode === "url" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >
              Ссылка
            </button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end">
          <div className="md:col-span-3 space-y-1.5">
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 ml-1">Тип привязки</label>
            <div className="flex h-10 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setBindingMode("discipline")}
                className={`flex-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  bindingMode === "discipline" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Дисциплина
              </button>
              <button
                type="button"
                onClick={() => setBindingMode("id")}
                className={`flex-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  bindingMode === "id" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                По ID
              </button>
            </div>
          </div>

          {bindingMode === "discipline" ? (
            <>
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 ml-1">Выбор дисциплины</label>
                <select
                  value={discipline}
                  onChange={(e) => setDiscipline(e.target.value as KnownDisciplineOption)}
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500 transition-all cursor-pointer"
                >
                  {DISCIPLINE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {discipline === "custom" && (
                <div className="md:col-span-3 space-y-1.5">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 ml-1">
                    Ключ дисциплины
                  </label>
                  <input
                    type="text"
                    value={customDiscipline}
                    onChange={(e) => setCustomDiscipline(e.target.value)}
                    placeholder="tabletennis"
                    className="w-full h-10 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-950 focus:outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
              )}
            </>
          ) : (
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 ml-1">Sport ID</label>
              <input
                type="text"
                inputMode="numeric"
                value={sportId}
                onChange={(e) => setSportId(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="46"
                className="w-full h-10 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-950 focus:outline-none focus:border-indigo-500 transition-all"
              />
            </div>
          )}

          <div className={`${bindingMode === "discipline" && discipline !== "custom" ? "md:col-span-6" : "md:col-span-3"} space-y-1.5`}>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 ml-1">Справочник</label>
            <div className={`flex h-10 items-center rounded-xl border px-4 text-xs font-black ${
              targetKey ? "border-indigo-100 bg-indigo-50 text-indigo-700" : "border-amber-100 bg-amber-50 text-amber-700"
            }`}>
              {targetKey ? (
                <span className="truncate">
                  {bindingMode === "id" ? "ID" : "Дисциплина"} · {targetKey}
                </span>
              ) : (
                "Укажите привязку"
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-9 space-y-1.5">
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 ml-1">
              {importMode === "file" ? "Выбор файла (.xlsx)" : "Google Sheets URL"}
            </label>
            {importMode === "file" ? (
              <div className="relative h-10">
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                />
                <div className="absolute inset-0 flex items-center px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-400 transition-all pointer-events-none">
                  {file ? (
                    <span className="text-slate-900 truncate">{file.name}</span>
                  ) : (
                    "Выберите файл..."
                  )}
                </div>
              </div>
            ) : (
              <input
                type="text"
                placeholder="Вставьте ссылку..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full h-10 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-950 focus:outline-none focus:border-indigo-500 transition-all"
              />
            )}
          </div>

          <div className="md:col-span-3">
            <button
              onClick={handleUpload}
              disabled={!canImport}
              className={`
                w-full h-10 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all
                ${!canImport
                  ? "bg-slate-50 text-slate-300 cursor-not-allowed"
                  : "bg-slate-900 text-white hover:bg-slate-800 shadow-sm"
                }
              `}
            >
              {status === "uploading" ? "Загрузка..." : "Импорт"}
            </button>
          </div>
        </div>

        {status === "success" && result && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-tight">
              ✓ Успешно: {result.importedCount} команд добавлено в {formatImportTarget(result.targetKey || targetKey)}.
              {result.mappingResult ? ` Автомаппинг: ${result.mappingResult.autoMappedCount || 0}, конфликтов: ${result.mappingResult.conflictCount || 0}.` : ""}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl">
            <p className="text-[10px] font-bold text-rose-700 uppercase tracking-tight">
              ⚠ Ошибка: {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeDisciplineKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

function normalizeSportId(value: string) {
  const text = value.trim();
  return /^[1-9]\d*$/.test(text) ? text : "";
}

function formatImportTarget(value: string) {
  return /^[1-9]\d*$/.test(String(value)) ? `Sport ID ${value}` : `дисциплину ${value}`;
}

