import type { KhlMatchProtocolView } from "@backend/results/khl/matchProtocol";

type Props = {
  protocol: KhlMatchProtocolView | null;
  section?: "all" | "overview" | "players" | "statistics";
};

const PLAYER_POINT_COLUMNS = [
  { key: "goals", label: "Г" },
  { key: "assists", label: "П" },
  { key: "points", label: "О" },
] as const;

export function KhlMatchProtocol({ protocol, section = "all" }: Props) {
  if (!protocol) {
    return (
      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Официальный протокол ещё не сохранён.
      </div>
    );
  }

  const body = (
    <div className="mt-4 space-y-5">
      {(section === "all" || section === "overview") && (
        <>
          <ScoreSummary protocol={protocol} />
          <EventTables protocol={protocol} />
        </>
      )}
      {(section === "all" || section === "players") && (
        <PlayerTables protocol={protocol} />
      )}
      {(section === "all" || section === "statistics") && (
        <TeamMetrics protocol={protocol} />
      )}
      {!protocol.validation.ok && (
        <ul className="rounded-xl bg-red-50 p-4 text-xs text-red-900">
          {protocol.validation.issues.map((issue, index) => (
            <li key={`${issue}:${index}`}>• {issue}</li>
          ))}
        </ul>
      )}
    </div>
  );

  if (section !== "all") {
    return (
      <div
        data-testid={`khl-protocol-${section}`}
        className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4"
      >
        <ProtocolHeader protocol={protocol} section={section} />
        {body}
      </div>
    );
  }

  return (
    <details
      open
      data-testid="khl-protocol"
      className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/40 p-4"
    >
      <summary className="cursor-pointer list-none">
        <ProtocolHeader protocol={protocol} section="all" />
      </summary>
      {body}
    </details>
  );
}

function ProtocolHeader({
  protocol,
  section,
}: {
  protocol: KhlMatchProtocolView;
  section: NonNullable<Props["section"]>;
}) {
  const title = section === "overview"
    ? "Счёт, голы, удаления и события матча"
    : section === "players"
      ? "Все заявленные игроки и их статистика"
      : section === "statistics"
        ? "Командные показатели по периодам"
        : "Командная статистика, все игроки, голы и штрафы";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-xs font-black uppercase tracking-[0.14em] text-blue-700">
          Официальный протокол КХЛ · доступен без Admin mappings
        </div>
        <div className="mt-1 text-sm font-black text-slate-950">{title}</div>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${protocol.validation.ok
        ? "bg-emerald-100 text-emerald-800"
        : "bg-red-100 text-red-800"}`}>
        {protocol.validation.ok ? "Протокол проверен" : "Показан, но доставка заблокирована"}
      </span>
    </div>
  );
}

function ScoreSummary({ protocol }: { protocol: KhlMatchProtocolView }) {
  return (
    <div>
      <h4 className="text-sm font-black text-slate-900">Счёт по периодам</h4>
      <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {protocol.scores.segments.map((score) => (
          <div key={score.segment} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <div className="text-[11px] font-black uppercase text-slate-500">{score.segment}</div>
            <div className="mt-1 text-lg font-black text-slate-950">{score.home}:{score.away}</div>
          </div>
        ))}
        <ScoreCard
          label="P1–P3"
          home={protocol.scores.regulation.home}
          away={protocol.scores.regulation.away}
          accent="blue"
        />
        <ScoreCard
          label="Итог"
          home={protocol.scores.official.home}
          away={protocol.scores.official.away}
          accent="slate"
        />
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  home,
  away,
  accent,
}: {
  label: string;
  home: number;
  away: number;
  accent: "blue" | "slate";
}) {
  return (
    <div className={`rounded-xl border p-3 text-center ${accent === "blue"
      ? "border-blue-200 bg-blue-100"
      : "border-slate-300 bg-slate-900 text-white"}`}>
      <div className={`text-[11px] font-black uppercase ${accent === "blue" ? "text-blue-700" : "text-slate-300"}`}>
        {label}
      </div>
      <div className="mt-1 text-lg font-black">{home}:{away}</div>
    </div>
  );
}

function TeamMetrics({ protocol }: { protocol: KhlMatchProtocolView }) {
  const homeMetrics = new Map(
    protocol.teams.home.metrics.map((metric) => [metric.code, metric])
  );
  const awayMetrics = new Map(
    protocol.teams.away.metrics.map((metric) => [metric.code, metric])
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h4 className="text-sm font-black text-slate-900">Командная статистика</h4>
        <div className="text-xs text-slate-500">
          {protocol.teams.home.name} — {protocol.teams.away.name}
        </div>
      </div>
      <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-black">Метрика</th>
              {protocol.segments.map((segment) => (
                <th key={segment} className="px-3 py-2 text-center font-black">{segment}</th>
              ))}
              <th className="px-3 py-2 text-center font-black text-blue-700">P1–P3</th>
              <th className="px-3 py-2 text-center font-black">Весь матч</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {protocol.teams.home.metrics.map((metric) => {
              const home = homeMetrics.get(metric.code)!;
              const away = awayMetrics.get(metric.code)!;
              return (
                <tr key={metric.code}>
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-800">{metric.label}</td>
                  {protocol.segments.map((segment) => (
                    <MetricPair
                      key={segment}
                      home={home.segments[segment] || 0}
                      away={away.segments[segment] || 0}
                    />
                  ))}
                  <MetricPair home={home.regulationTotal} away={away.regulationTotal} emphasized />
                  <MetricPair home={home.fullMatchTotal} away={away.fullMatchTotal} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        В каждой ячейке: хозяева — гости. PIM включает только удаления на 2 и 4 минуты.
      </p>
    </div>
  );
}

function MetricPair({ home, away, emphasized = false }: {
  home: number;
  away: number;
  emphasized?: boolean;
}) {
  return (
    <td className={`whitespace-nowrap px-3 py-2 text-center tabular-nums ${emphasized
      ? "bg-blue-50 font-black text-blue-900"
      : "text-slate-700"}`}>
      {home} — {away}
    </td>
  );
}

function PlayerTables({ protocol }: { protocol: KhlMatchProtocolView }) {
  return (
    <div>
      <h4 className="text-sm font-black text-slate-900">
        Все заявленные игроки · {protocol.players.length}
      </h4>
      <p className="mt-1 text-[11px] text-slate-500">
        Нулевые значения тоже отображаются. Слева — P1–P3 для Admin, справа — весь матч с OT.
      </p>
      <div className="mt-2 grid gap-4 xl:grid-cols-2">
        {(["home", "away"] as const).map((side) => (
          <PlayerTable key={side} protocol={protocol} side={side} />
        ))}
      </div>
    </div>
  );
}

function PlayerTable({
  protocol,
  side,
}: {
  protocol: KhlMatchProtocolView;
  side: "home" | "away";
}) {
  const players = protocol.players.filter((player) => player.teamSide === side);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-black text-slate-800">
        {protocol.teams[side].name} · {players.length}
      </div>
      <table className="min-w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th rowSpan={2} className="px-2 py-2 text-center">№</th>
            <th rowSpan={2} className="px-2 py-2">Игрок</th>
            <th rowSpan={2} className="px-2 py-2">Амплуа</th>
            <th colSpan={3} className="border-l border-slate-100 px-2 py-1 text-center text-blue-700">P1–P3</th>
            <th colSpan={3} className="border-l border-slate-100 px-2 py-1 text-center">Весь матч</th>
          </tr>
          <tr>
            {["regulation", "fullMatch"].flatMap((scope) => PLAYER_POINT_COLUMNS.map((column) => (
              <th key={`${scope}:${column.key}`} className="border-l border-slate-100 px-2 py-1 text-center">{column.label}</th>
            )))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {players.map((player) => (
            <tr key={player.khlPlayerId} data-testid="khl-protocol-player">
              <td className="px-2 py-2 text-center font-bold tabular-nums">{player.shirtNumber}</td>
              <td className="whitespace-nowrap px-2 py-2">
                <div className="font-bold text-slate-900">{player.name}</div>
                <div className="text-[10px] text-slate-400">KHL {player.khlPlayerId}</div>
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-slate-500">{player.role || "—"}</td>
              {PLAYER_POINT_COLUMNS.map((column) => (
                <td key={`reg:${column.key}`} className="border-l border-slate-100 bg-blue-50/50 px-2 py-2 text-center font-black tabular-nums text-blue-900">
                  {player.regulation[column.key]}
                </td>
              ))}
              {PLAYER_POINT_COLUMNS.map((column) => (
                <td key={`full:${column.key}`} className="border-l border-slate-100 px-2 py-2 text-center tabular-nums text-slate-700">
                  {player.fullMatch[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventTables({ protocol }: { protocol: KhlMatchProtocolView }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <details className="rounded-xl border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-black text-slate-900">
          Голы · {protocol.goals.length}
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {protocol.goals.map((goal, index) => (
                <tr key={`${goal.segment}:${goal.elapsedSeconds}:${index}`}>
                  <td className="whitespace-nowrap px-2 py-2 font-black">{goal.segment} {formatClock(goal.elapsedSeconds)}</td>
                  <td className="px-2 py-2">
                    <div className="font-bold">{goal.scorer.name || "Командный гол"} · {goal.score}</div>
                    <div className="text-[10px] text-slate-500">
                      {goal.assistants.map((assistant) => assistant.name).filter(Boolean).join(", ") || "без ассистентов"}
                      {goal.strengthAbbreviation ? ` · ${goal.strengthAbbreviation}` : ""}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-xl border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-black text-slate-900">
          Штрафы · {protocol.penalties.length}
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {protocol.penalties.map((penalty, index) => (
                <tr key={`${penalty.segment}:${penalty.elapsedSeconds}:${index}`}>
                  <td className="whitespace-nowrap px-2 py-2 font-black">{penalty.segment} {formatClock(penalty.elapsedSeconds)}</td>
                  <td className="px-2 py-2">
                    <div className="font-bold">{penalty.player?.name || "Командный штраф"} · {penalty.durationMinutes} мин.</div>
                    <div className="text-[10px] text-slate-500">{penalty.reason || "Причина не указана"}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {penalty.includedInRegulationAdminTotal
                      ? <span className="font-bold text-emerald-700">в P1–P3</span>
                      : <span className="text-slate-400">не входит</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function formatClock(elapsedSeconds: number) {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
