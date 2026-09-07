import type { ReactNode } from "react";
import { Bot, CheckCircle2, Clock, Loader2, Minus, Plus, Save, Sparkles } from "lucide-react";
import type { ManualMatch, MappedMatch, ManualMappingConflict, ManualMappingSaveSummary, TeamSide } from "./types";

type Props = {
  matches: ManualMatch[];
  mappedMatches: MappedMatch[];
  timeShiftMinutes: string;
  setTimeShiftMinutes: (value: string) => void;
  applyTimeShift: (direction: -1 | 1) => void;
  toggleAllMatchesSelection: () => void;
  allMatchesSelected: boolean;
  runAutoMap: () => Promise<void>;
  autoMapping: boolean;
  saveManualTeamMappings: (overwriteConflicts: boolean) => Promise<void>;
  mappingSaving: boolean;
  selectedCount: number;
  totalReadyCount: number;
  mappingSaveSummary: ManualMappingSaveSummary | null;
  mappingConflicts: ManualMappingConflict[];
  selectedMatchIndexes: Set<number>;
  toggleMatchSelection: (index: number) => void;
  updateMatch: (index: number, field: keyof ManualMatch, value: string) => void;
  renderTeamPlatformIdCell: (index: number, side: TeamSide, value: string) => ReactNode;
  removeMatch: (index: number) => void;
};

/** Таблица редактирования. Изменения и сохранение делегируются координатору, чтобы предпросмотр не устаревал. */
export function ManualImportMatchTable({
  matches,
  mappedMatches,
  timeShiftMinutes,
  setTimeShiftMinutes,
  applyTimeShift,
  toggleAllMatchesSelection,
  allMatchesSelected,
  runAutoMap,
  autoMapping,
  saveManualTeamMappings,
  mappingSaving,
  selectedCount,
  totalReadyCount,
  mappingSaveSummary,
  mappingConflicts,
  selectedMatchIndexes,
  toggleMatchSelection,
  updateMatch,
  renderTeamPlatformIdCell,
  removeMatch,
}: Props) {
  return (
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
                        aria-label={`Дата, матч ${index + 1}`}
                        value={match.date || ""}
                        onChange={(event) => updateMatch(index, "date", event.target.value)}
                        placeholder="22.05.2026 18:00:00"
                        className="h-9 w-44 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        aria-label={`Команда 1, матч ${index + 1}`}
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
                        aria-label={`Команда 2, матч ${index + 1}`}
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
  );
}
