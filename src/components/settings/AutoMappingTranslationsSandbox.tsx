"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  Languages,
  Link2,
  Play,
  Search,
  XCircle,
} from "lucide-react";

type PreviewItem = {
  liquipediaName: string;
  normalizedName: string;
  platformId?: string | null;
  adminName?: string | null;
  matchedName?: string | null;
  score?: number | null;
  secondPlatformId?: string | null;
  secondAdminName?: string | null;
  secondScore?: number | null;
  existingPlatformId?: string | null;
  existingAdminName?: string | null;
  reason?: string | null;
  matchMethod?: string | null;
};

type Preview = {
  adminTeamsCount: number;
  liquipediaTeamsFound: number;
  alreadyMappedCount: number;
  auto: PreviewItem[];
  suggested: PreviewItem[];
  ambiguous: PreviewItem[];
  unmapped: PreviewItem[];
  invalid: PreviewItem[];
  conflicts: PreviewItem[];
  diagnostics?: {
    exactIndexHits: number;
    fuzzyCandidateComparisons: number;
    candidatePoolFallbacks: number;
    maxCandidatePoolSize: number;
    indexedNameKeys: number;
  };
};

type SandboxAutomapResult = {
  ok: true;
  sourceType: "file" | "url";
  fileName: string;
  byteLength: number;
  cacheHit?: boolean;
  sourceNamesCount: number;
  uniqueSourceNamesCount: number;
  adminTeamsCount: number;
  skippedAdminRowsCount: number;
  detectedLayout: unknown;
  timingsMs?: {
    formData: number;
    source: {
      fetch: number;
      readBytes: number;
      readSheet: number;
      total: number;
    };
    parseRows: number;
    match: number;
    total: number;
  };
  preview: Preview;
};

type CategoryKey = "auto" | "suggested" | "ambiguous" | "unmapped" | "invalid" | "conflicts";
type ResultTab = CategoryKey | "json";

const CATEGORY_CONFIG: Array<{
  key: CategoryKey;
  label: string;
  hint: string;
  icon: LucideIcon;
  activeClassName: string;
}> = [
  {
    key: "auto",
    label: "Авто",
    hint: "готово к автоматическому совпадению",
    icon: CheckCircle2,
    activeClassName: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  {
    key: "suggested",
    label: "Предложения",
    hint: "нужна ручная проверка",
    icon: Search,
    activeClassName: "border-sky-300 bg-sky-50 text-sky-700",
  },
  {
    key: "ambiguous",
    label: "Спорные",
    hint: "кандидаты слишком близко",
    icon: AlertTriangle,
    activeClassName: "border-amber-300 bg-amber-50 text-amber-700",
  },
  {
    key: "unmapped",
    label: "Без ID",
    hint: "не найден уверенный platform ID",
    icon: XCircle,
    activeClassName: "border-rose-300 bg-rose-50 text-rose-700",
  },
  {
    key: "invalid",
    label: "Пропущено",
    hint: "source не похож на команду",
    icon: AlertTriangle,
    activeClassName: "border-slate-300 bg-slate-100 text-slate-700",
  },
  {
    key: "conflicts",
    label: "Конфликты",
    hint: "ручной ID конфликтует с кандидатом",
    icon: AlertTriangle,
    activeClassName: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700",
  },
];

export default function AutoMappingTranslationsSandbox() {
  const [sourceNames, setSourceNames] = useState("");
  const [sourceMode, setSourceMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SandboxAutomapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>("auto");
  const [copied, setCopied] = useState(false);

  const sourceCount = useMemo(
    () => sourceNames.split(/\r?\n/).filter((line) => line.trim()).length,
    [sourceNames]
  );

  const handleModeChange = (mode: "file" | "url") => {
    setSourceMode(mode);
    setError(null);
    if (mode === "file") {
      setUrl("");
    } else {
      setFile(null);
    }
  };

  const handleTest = async () => {
    if (!sourceNames.trim()) {
      setError("Добавьте source названия, по одному на строку.");
      return;
    }

    if (sourceMode === "file" && !file) {
      setError("Загрузите .xlsx файл с ID, RU и EN/name колонками.");
      return;
    }

    if (sourceMode === "url" && !url.trim()) {
      setError("Укажите ссылку на Google Sheets таблицу.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const formData = new FormData();
      formData.set("sourceNames", sourceNames);
      if (sourceMode === "file" && file) {
        formData.set("file", file);
      } else {
        formData.set("url", url.trim());
      }

      const response = await fetch("/api/admin/sandbox/automap", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Не удалось выполнить dry-run автомапинга.");
      }

      setResult(data);
      setActiveTab(getFirstResultTab(data.preview));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка автомапинга");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyJson = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const activeItems = result && activeTab !== "json" ? result.preview[activeTab] : [];

  return (
    <section className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-200">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-sky-600">
            <Languages className="h-4 w-4" />
            Автомапинг
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-normal text-slate-950">Переводы</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center ring-1 ring-slate-100 sm:min-w-[360px]">
          <Metric label="Source" value={sourceCount} />
          <Metric label="Admin IDs" value={result?.adminTeamsCount ?? 0} />
          <Metric label="Skipped" value={result?.skippedAdminRowsCount ?? 0} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-400">
              Source названия
            </label>
            <textarea
              value={sourceNames}
              onChange={(event) => setSourceNames(event.target.value)}
              placeholder={"Team Liquid\nАбдулазиз Аль Абдулла\nG2 Esports"}
              rows={10}
              className="min-h-[220px] w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-800 shadow-sm outline-none transition focus:border-sky-500 focus:bg-white"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => handleModeChange("file")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
                  sourceMode === "file" ? "bg-sky-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Файл
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("url")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
                  sourceMode === "url" ? "bg-sky-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                <Link2 className="h-4 w-4" />
                Google Sheets
              </button>
            </div>

            {sourceMode === "file" ? (
              <label className="flex min-h-[118px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-center transition hover:border-sky-300 hover:bg-sky-50/40">
                <FileSpreadsheet className="h-8 w-8 text-sky-600" />
                <span className="mt-2 max-w-full truncate text-sm font-black text-slate-800">
                  {file ? file.name : ".xlsx admin-справочник"}
                </span>
                <span className="mt-1 text-xs font-bold text-slate-400">ID, RU, EN/name</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            ) : (
              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                  Google Sheets ссылка
                </label>
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm outline-none transition focus:border-sky-500"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleTest}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-md shadow-slate-950/10 transition hover:bg-sky-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
            {loading ? "Тестируем" : "Протестировать"}
          </button>
        </div>

        <div className="min-h-[520px] rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          {!result && !loading && (
            <div className="flex h-full min-h-[480px] flex-col items-center justify-center text-center text-slate-400">
              <Languages className="mb-3 h-14 w-14 stroke-1" />
              <div className="text-sm font-black text-slate-500">Dry-run появится здесь</div>
            </div>
          )}

          {loading && (
            <div className="flex h-full min-h-[480px] flex-col items-center justify-center text-center text-slate-500">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-sky-600" />
              <div className="mt-4 text-sm font-black">Считаю совпадения</div>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Source unique" value={result.uniqueSourceNamesCount} />
                <MetricCard label="Admin candidates" value={result.preview.adminTeamsCount} />
                <MetricCard label="Auto" value={result.preview.auto.length} tone="emerald" />
                <MetricCard label="Review" value={result.preview.suggested.length + result.preview.ambiguous.length} tone="amber" />
              </div>

              <PerformanceStrip result={result} />

              <div className="flex flex-wrap gap-2">
                {CATEGORY_CONFIG.map((category) => {
                  const count = result.preview[category.key].length;
                  const Icon = category.icon;
                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => setActiveTab(category.key)}
                      title={category.hint}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${
                        activeTab === category.key
                          ? category.activeClassName
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {category.label}
                      <span className="rounded-lg bg-white/80 px-2 py-0.5 tabular-nums text-slate-700">{count}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setActiveTab("json")}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${
                    activeTab === "json"
                      ? "border-slate-400 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900"
                  }`}
                >
                  <Braces className="h-4 w-4" />
                  JSON
                </button>
              </div>

              {activeTab === "json" ? (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
                    <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Raw JSON</span>
                    <button
                      type="button"
                      onClick={handleCopyJson}
                      className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-black text-white transition hover:bg-slate-700"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? "Скопировано" : "Копировать"}
                    </button>
                  </div>
                  <pre className="max-h-[440px] overflow-auto p-4 text-xs font-semibold leading-5 text-emerald-300">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="overflow-x-auto">
                    <table className="min-w-[900px] w-full text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Source name</th>
                          <th className="px-4 py-3">Admin name</th>
                          <th className="px-4 py-3">Platform ID</th>
                          <th className="px-4 py-3">Score / method</th>
                          <th className="px-4 py-3">Второй кандидат</th>
                          <th className="px-4 py-3">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeItems.map((item) => (
                          <tr key={`${item.liquipediaName}-${item.platformId || item.reason || "none"}`}>
                            <td className="max-w-[220px] px-4 py-3 align-top">
                              <div className="font-black text-slate-900">{item.liquipediaName}</div>
                              <div className="mt-1 truncate text-xs font-semibold text-slate-400">{item.normalizedName}</div>
                            </td>
                            <td className="max-w-[220px] px-4 py-3 align-top">
                              <div className="font-bold text-slate-800">{item.adminName || "-"}</div>
                              {item.matchedName && (
                                <div className="mt-1 text-xs font-semibold text-sky-600">matched: {item.matchedName}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-black tabular-nums text-slate-700">
                                {item.platformId || "-"}
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-black tabular-nums text-slate-900">{formatScore(item.score)}</div>
                              <div className="mt-1 text-xs font-bold text-slate-400">{formatMatchMethod(item.matchMethod)}</div>
                            </td>
                            <td className="max-w-[210px] px-4 py-3 align-top">
                              <div className="font-bold text-slate-700">{item.secondAdminName || "-"}</div>
                              {item.secondPlatformId && (
                                <div className="mt-1 text-xs font-semibold text-slate-400">
                                  {item.secondPlatformId} / {formatScore(item.secondScore)}
                                </div>
                              )}
                            </td>
                            <td className="max-w-[220px] px-4 py-3 align-top text-xs font-bold text-slate-500">
                              {formatReason(item.reason)}
                            </td>
                          </tr>
                        ))}
                        {activeItems.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-sm font-black text-slate-400">
                              В этой категории пусто
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-black tabular-nums text-slate-950">{value}</div>
    </div>
  );
}

function MetricCard({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" | "amber" }) {
  const toneClassName =
    tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-950";

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${toneClassName}`}>{value}</div>
    </div>
  );
}

function PerformanceStrip({ result }: { result: SandboxAutomapResult }) {
  const diagnostics = result.preview.diagnostics;
  const timings = result.timingsMs;

  if (!diagnostics && !timings) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-500">
      <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-700">
        {result.cacheHit ? "Sheets cache hit" : "Fresh source"}
      </span>
      {timings && (
        <>
          <span>source {formatDuration(timings.source.total)}</span>
          <span>parse {formatDuration(timings.parseRows)}</span>
          <span>match {formatDuration(timings.match)}</span>
          <span className="text-slate-900">total {formatDuration(timings.total)}</span>
        </>
      )}
      {diagnostics && (
        <>
          <span>exact hits {diagnostics.exactIndexHits}</span>
          <span>fuzzy checks {diagnostics.fuzzyCandidateComparisons}</span>
          <span>max pool {diagnostics.maxCandidatePoolSize}</span>
        </>
      )}
    </div>
  );
}

function getFirstResultTab(preview: Preview): ResultTab {
  return CATEGORY_CONFIG.find((category) => preview[category.key].length > 0)?.key ?? "json";
}

function formatDuration(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.max(0, Math.round(value))}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatScore(score?: number | null) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "-";
  return `${Math.round(score)}%`;
}

function formatMatchMethod(method?: string | null) {
  const labels: Record<string, string> = {
    exact: "точное",
    alias_exact: "alias exact",
    pair_exact: "пара exact",
    pair_fuzzy: "пара fuzzy",
    token_fuzzy: "token fuzzy",
    translit_fuzzy: "translit fuzzy",
    manual_conflict_replace: "manual conflict",
    none: "нет",
  };
  return labels[method || ""] || method || "-";
}

function formatReason(reason?: string | null) {
  const labels: Record<string, string> = {
    invalid_source_name: "source не похож на валидную команду",
    score_below_threshold: "score ниже порога",
    medium_confidence: "средняя уверенность",
    candidate_gap_too_small: "маленький отрыв от второго кандидата",
    admin_team_source_missing: "admin-справочник пуст",
    manual_locked_without_platform_id: "ручное правило без platform ID",
    manual_mapping_conflict: "ручной ID конфликтует с кандидатом",
  };
  return labels[reason || ""] || reason || "-";
}
