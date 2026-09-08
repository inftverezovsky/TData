import {
  KHL_PENALTY_EXTRA_DEFINITIONS,
  type KhlPenaltyExtrasProjection,
} from "@backend/results/khl/penaltyExtras";

type Props = {
  projection?: KhlPenaltyExtrasProjection | null;
  homeTeamName?: string;
  awayTeamName?: string;
};

export function KhlPenaltyExtras({ projection, homeTeamName, awayTeamName }: Props) {
  const extras = projection?.extras ?? KHL_PENALTY_EXTRA_DEFINITIONS.map((definition) => ({
    ...definition, value: null, displayValue: "Недоступно", issues: [], evidence: [],
  }));
  const teamNames = { home: homeTeamName || "Хозяева", away: awayTeamName || "Гости" };

  return (
    <section data-testid="khl-penalty-extras" className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
      <h4 className="text-sm font-black text-slate-950">Допы штрафного времени</h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Основное время: 60 минут. Овертайм не учитывается. С 1 по 5 минуту — 00:00–04:59.
        Первое двухминутное удаление — ровно 2 минуты; двойной малый штраф (4 минуты) не подходит.
      </p>
      {!projection && (
        <p className="mt-3 rounded-xl bg-amber-100 p-3 text-xs text-amber-900">
          Допы ещё не рассчитаны: обновите официальный протокол матча.
        </p>
      )}
      {projection && !projection.available && (
        <div className="mt-3 rounded-xl bg-amber-100 p-3 text-xs text-amber-900">
          <p className="font-bold">Недостаточно данных для расчёта допов.</p>
          <ul className="mt-1 space-y-1">
            {projection.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {extras.map((extra) => (
          <article key={extra.code} data-testid={`khl-penalty-result-${extra.code}`}
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h5 className="text-xs font-bold text-slate-800">{extra.label}</h5>
              <span data-testid="khl-penalty-value"
                className={`max-w-full break-words rounded-lg px-2 py-1 text-xs font-black ${extra.value === null
                  ? "bg-amber-100 text-amber-900" : extra.value === true
                    ? "bg-emerald-100 text-emerald-800" : extra.value === false
                      ? "bg-slate-100 text-slate-700" : "bg-indigo-100 text-indigo-900"}`}>
                {extra.displayValue}
              </span>
            </div>
            {extra.issues.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-800">
                {extra.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            )}
            {extra.evidence.length > 0 && (
              <ul aria-label="События официального протокола" className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
                {extra.evidence.map((event, index) => (
                  <li key={`${event.elapsedSeconds}:${event.teamSide}:${event.durationMinutes}:${index}`}>
                    <span className="font-bold tabular-nums">{formatClock(event.elapsedSeconds)}</span>
                    {` · ${teamNames[event.teamSide]} · ${event.durationMinutes} мин. · ${event.reason || "Причина не указана"}`}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Одновременные удаления обеих команд или разные виды первых удалений показываются как неоднозначный результат.
      </p>
    </section>
  );
}

function formatClock(elapsedSeconds: number) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return "Время не указано";
  return `${Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")}:${Math.floor(elapsedSeconds % 60).toString().padStart(2, "0")}`;
}
