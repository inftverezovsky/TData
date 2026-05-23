"use client";

import { ChangeEvent, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clipboard,
  FileJson,
  FileUp,
  ImageUp,
  Loader2,
  RefreshCw,
  Save,
  ScanText,
  Send,
  Sparkles,
  Table2,
  UploadCloud,
} from "lucide-react";

const disciplines = [
  { slug: "dota2", label: "Dota 2" },
  { slug: "counterstrike", label: "Counter-Strike" },
  { slug: "leagueoflegends", label: "League of Legends" },
  { slug: "valorant", label: "Valorant" },
] as const;

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
  team1: { name: string; platformId: string | null };
  team2: { name: string; platformId: string | null };
  date: string;
  isReady: boolean;
};

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

type ParseSource = "local-text" | "local-ocr" | "ai" | "fallback" | "";

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

export default function ManualImportWorkbench() {
  const [disciplineSlug, setDisciplineSlug] = useState("counterstrike");
  const [disciplineId, setDisciplineId] = useState("73");
  const [shapkaId, setShapkaId] = useState("");
  const [rawText, setRawText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [parseSource, setParseSource] = useState<ParseSource>("");
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [matches, setMatches] = useState<ManualMatch[]>([]);
  const [mappedMatches, setMappedMatches] = useState<MappedMatch[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [message, setMessage] = useState<ResultMessage | null>(null);
  const [parsing, setParsing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingConflicts, setMappingConflicts] = useState<ManualMappingConflict[]>([]);
  const [mappingSaveSummary, setMappingSaveSummary] = useState<ManualMappingSaveSummary | null>(null);

  const [teamImportMode, setTeamImportMode] = useState<"file" | "url">("file");
  const [teamFile, setTeamFile] = useState<File | null>(null);
  const [teamUrl, setTeamUrl] = useState("");
  const [teamImporting, setTeamImporting] = useState(false);
  const [teamImportResult, setTeamImportResult] = useState<TeamImportResult | null>(null);

  const readyCount =
    preview?.readyMatchesCount ??
    matches.filter((match, index) => {
      const mapped = mappedMatches[index];
      return Boolean(
        (match.team1PlatformId || mapped?.team1.platformId) &&
          (match.team2PlatformId || mapped?.team2.platformId)
      );
    }).length;

  async function handleTeamFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setTeamFile(file);
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImageName(file.name);
    setImageFile(file);
    setImageDataUrl("");
    setOcrText("");
    setOcrConfidence(null);
    setParseSource("");
    setParseWarnings([]);
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
    setMessage(null);
  }

  async function importTeams() {
    if (teamImportMode === "file" && !teamFile) return;
    if (teamImportMode === "url" && !teamUrl.trim()) return;

    setTeamImporting(true);
    setTeamImportResult(null);
    setMessage(null);

    const formData = new FormData();
    formData.append("disciplineSlug", disciplineSlug);
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
      setMessage({
        type: "success",
        text: `Источник обновлен: ${data.importedCount || 0} записей. Автомапинг: ${data.mappingResult?.autoMappedCount || 0}.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка импорта команд" });
    } finally {
      setTeamImporting(false);
    }
  }

  async function parseMatches(options: { useOcrText?: boolean } = {}) {
    const textForParse = options.useOcrText ? ocrText : rawText;
    const shouldUploadImage = !options.useOcrText && Boolean(imageFile || imageDataUrl);

    if (!textForParse.trim() && !shouldUploadImage) {
      setMessage({ type: "error", text: "Добавьте текст или фото для распознавания." });
      return;
    }

    setParsing(true);
    setMessage(null);
    setPreview(null);
    setParseWarnings([]);

    try {
      const formData = new FormData();
      formData.append("disciplineSlug", disciplineSlug);
      formData.append("disciplineId", disciplineId);
      formData.append("text", textForParse);
      if (shouldUploadImage && imageFile) {
        formData.append("image", imageFile);
      } else if (shouldUploadImage && imageDataUrl) {
        formData.append("imageDataUrl", imageDataUrl);
      }

      const response = await fetch("/api/manual-import/parse", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Матчи не распознаны");
      }

      setMatches(mergeMatchesWithMappedIds(data.rawMatches || [], data.mappedMatches || []));
      setMappedMatches(data.mappedMatches || []);
      setMappingConflicts([]);
      setMappingSaveSummary(null);
      setParseSource(data.parseSource || "");
      setParseWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setOcrConfidence(typeof data.ocrConfidence === "number" ? data.ocrConfidence : null);
      if (typeof data.ocrText === "string" && data.ocrText.trim()) {
        setOcrText(data.ocrText);
      } else if (data.parseSource === "local-ocr" && typeof data.normalizedText === "string") {
        setOcrText(data.normalizedText);
      }
      if (data.normalizedText && !rawText.trim() && !data.ocrText && data.parseSource !== "local-ocr") {
        setRawText(data.normalizedText);
      }
      setMessage({
        type: data.fallback ? "info" : "success",
        text: `${getParseSourceLabel(data.parseSource)}. Найдено матчей: ${(data.rawMatches || []).length}.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка распознавания" });
    } finally {
      setParsing(false);
    }
  }

  async function runPreview() {
    if (matches.length === 0) {
      setMessage({ type: "error", text: "Сначала распознайте или добавьте матчи." });
      return;
    }

    setPreviewing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineSlug, disciplineId, shapkaId, matches }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Ошибка превью");

      setPreview(data);
      setMappedMatches(data.mappedMatches || []);
      setMatches((current) => mergeMatchesWithMappedIds(current, data.mappedMatches || []));
      setMessage({ type: "success", text: `Готово к заливке: ${data.readyMatchesCount} матчей.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка превью" });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendToAdmin() {
    if (!confirm("Залить ручной payload в API?")) return;

    setSending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineSlug, disciplineId, shapkaId, matches }),
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

    setAutoMapping(true);
    setMessage(null);
    setPreview(null);

    try {
      const response = await fetch("/api/manual-import/automap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineSlug, disciplineId, matches }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Автомапинг не выполнен");

      setMappedMatches(data.mappedMatches || []);
      setMatches((current) => mergeMatchesWithMappedIds(current, data.mappedMatches || []));
      setMappingConflicts([]);
      setMappingSaveSummary(null);
      setMessage({
        type: "success",
        text: `Автомапинг готов: ${data.readyMatchesCount || 0} строк с ID.`,
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
    if (!disciplineId.trim()) {
      setMessage({ type: "error", text: "Укажите ID дисциплины перед сохранением ID команд." });
      return;
    }

    setMappingSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/team-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineSlug, disciplineId, matches, overwriteConflicts }),
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

  async function openServiceUpload() {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/service-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineSlug, disciplineId, shapkaId, matches }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Не удалось создать ссылку для сервиса");
      }

      await copyToClipboard(data.jsonUrl);
      setMessage({ type: "success", text: "JSON-ссылка создана и скопирована. Открываю сервис..." });
      window.open(data.serviceUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
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
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
  }

  function updateMatch(index: number, field: keyof ManualMatch, value: string) {
    setMatches((current) => current.map((match, i) => (i === index ? { ...match, [field]: value } : match)));
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
  }

  function removeMatch(index: number) {
    setMatches((current) => current.filter((_, i) => i !== index));
    setPreview(null);
    setMappingConflicts([]);
    setMappingSaveSummary(null);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px_220px_220px] lg:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-600">Manual import</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Ручной импорт матчей</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-slate-600">
              Фото или текст проходят через ArcCodex GPT-5.5, затем payload собирается в тот же формат FIxt.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Дисциплина</label>
            <select
              value={disciplineSlug}
              onChange={(event) => {
                const nextDiscipline = event.target.value;
                setDisciplineSlug(nextDiscipline);
                setDisciplineId("");
                setShapkaId("");
                setRawText("");
                setImageFile(null);
                setImageDataUrl("");
                setImageName("");
                setOcrText("");
                setOcrConfidence(null);
                setParseSource("");
                setParseWarnings([]);
                setPreview(null);
                setMatches([]);
                setMappedMatches([]);
                setTeamImportResult(null);
                setTeamFile(null);
                setTeamUrl("");
                setMappingConflicts([]);
                setMappingSaveSummary(null);
                setMessage(null);
              }}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            >
              {disciplines.map((discipline) => (
                <option key={discipline.slug} value={discipline.slug}>
                  {discipline.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">ID дисциплины</label>
            <input
              value={disciplineId}
              onChange={(event) => {
                setDisciplineId(event.target.value.replace(/[^\d]/g, ""));
                setPreview(null);
                setMappingConflicts([]);
                setMappingSaveSummary(null);
              }}
              inputMode="numeric"
              placeholder="73"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">ID шапки</label>
            <input
              value={shapkaId}
              onChange={(event) => {
                setShapkaId(event.target.value.replace(/[^\d]/g, ""));
                setPreview(null);
              }}
              inputMode="numeric"
              placeholder="12345"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
          </div>
        </div>
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
                <input key={`team-file-${disciplineSlug}`} type="file" accept=".xlsx" onChange={handleTeamFileChange} className="hidden" />
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
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-5">
            <div>
              <h2 className="text-xl font-black text-slate-950">Фото или текст</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">Скрин расписания, OCR-текст или копипаст из HLTV.</p>
            </div>
            <div className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-indigo-600">
              GPT-5.5
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/30 p-6 text-center transition hover:bg-indigo-50">
              <ImageUp className="h-9 w-9 text-indigo-500" />
              <span className="mt-3 text-sm font-black text-slate-950">{imageName || "Добавить фото"}</span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">png / jpg / webp</span>
              <input key={`image-file-${disciplineSlug}`} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
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

          {(ocrText || parseSource || parseWarnings.length > 0) && (
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
              <div className="text-2xl font-black text-white">{readyCount}</div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <button
              onClick={runPreview}
              disabled={previewing || matches.length === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-950 transition hover:bg-indigo-50 disabled:bg-white/10 disabled:text-slate-500"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              Сформировать
            </button>
            <button
              onClick={sendToAdmin}
              disabled={sending || !preview?.phpArray}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-400 disabled:bg-white/10 disabled:text-slate-500"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Залить в API
            </button>
            <button
              onClick={openServiceUpload}
              disabled={sending || matches.length === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-slate-500"
            >
              <UploadCloud className="h-4 w-4" />
              Залить через сервис
            </button>
          </div>

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
              {mappedMatches.length || matches.length} строк
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
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
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
                  return (
                    <tr key={`${match.team1}-${match.team2}-${index}`} className="text-xs font-bold text-slate-700">
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
                        <input
                          value={team1PlatformId}
                          onChange={(event) => updateMatch(index, "team1PlatformId", event.target.value.replace(/[^\d]/g, ""))}
                          inputMode="numeric"
                          placeholder="НЕТ ID"
                          className="h-9 w-28 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-900 outline-none focus:border-indigo-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={match.team2 || ""}
                          onChange={(event) => updateMatch(index, "team2", event.target.value)}
                          className="h-9 w-40 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={team2PlatformId}
                          onChange={(event) => updateMatch(index, "team2PlatformId", event.target.value.replace(/[^\d]/g, ""))}
                          inputMode="numeric"
                          placeholder="НЕТ ID"
                          className="h-9 w-28 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-900 outline-none focus:border-indigo-400"
                        />
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
    case "ai":
      return "AI fallback";
    case "fallback":
      return "Fallback parser";
    default:
      return "Распознавание";
  }
}

async function copyToClipboard(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to textarea fallback
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
  return true;
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
