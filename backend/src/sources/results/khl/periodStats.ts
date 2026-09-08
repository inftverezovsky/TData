import type { KhlScore, KhlSegment } from "./normalize";

type Stats = { shotsOnGoal: KhlScore; faceoffsWon: KhlScore };
export type PeriodStats = Record<string, Stats>;
type StatsEvidence = {
  periods: PeriodStats;
  summaries: Record<string, Stats>;
  conflicts: string[];
};

export function parseKhlPeriodStats(events: Record<string, unknown>[]): StatsEvidence {
  const rows: Record<string, Stats> = {};
  const conflicts = new Set<string>();
  for (const event of events) {
    if (event.type !== "info" || typeof event.text !== "string") continue;
    const key = statsKey(event.text);
    if (!key) continue;
    const shotsOnGoal = metricPair(event.text, "Броски в створ");
    const faceoffsWon = metricPair(event.text, "Вбрасывания");
    if (!shotsOnGoal || !faceoffsWon) {
      conflicts.add(key);
      continue;
    }
    const stats = { shotsOnGoal, faceoffsWon };
    if (rows[key] && JSON.stringify(rows[key]) !== JSON.stringify(stats)) conflicts.add(key);
    rows[key] = stats;
  }
  // Never select an arbitrary duplicate based on timeline array order.
  const unique = Object.entries(rows).filter(([key]) => !conflicts.has(key));
  return {
    periods: Object.fromEntries(unique.filter(([key]) => /^(P|OT)/.test(key))),
    summaries: Object.fromEntries(unique.filter(([key]) => key.startsWith("summary"))),
    conflicts: [...conflicts].sort(),
  };
}

function statsKey(text: string): string | null {
  const period = text.match(/^Статистика\s+([123])-го периода:/i);
  if (period) return `P${period[1]}`;
  const overtime = text.match(/^Статистика\s+(\d+)-го овертайма:/i);
  if (overtime) return `OT${Number(overtime[1])}`;
  if (/^Статистика\s+овертайма:/i.test(text)) return "OT1";
  if (/^Статистика\s+(?:матча\s+)?после тр[её]х периодов:/i.test(text)) return "summaryRegulation";
  if (/^Статистика\s+(?:матча\s+)?после двух периодов:/i.test(text)) return "summaryTwo";
  if (/^Статистика\s+матча:/i.test(text)) return "summaryFull";
  return null;
}

function metricPair(text: string, label: string): KhlScore | null {
  const match = text.match(new RegExp(`${label}:\\s*(\\d+)\\s*-\\s*(\\d+)(?=\\s*(?:;|$))`, "i"));
  if (!match) return null;
  const pair = { home: Number(match[1]), away: Number(match[2]) };
  return validPair(pair) ? pair : null;
}

function validPair(pair: KhlScore): boolean {
  return Object.values(pair).every((value) => Number.isSafeInteger(value) && value >= 0);
}

function equalPair(a: KhlScore, b: KhlScore): boolean {
  return a.home === b.home && a.away === b.away;
}

/** Recover only a misallocated single-OT faceoff pair, with independent cumulative evidence. */
export function reconcileKhlOvertimeFaceoffs(
  evidence: StatsEvidence,
  segments: KhlSegment[],
  finished: boolean,
  sourceTotals: { home: unknown; away: unknown }
): { periods: PeriodStats; warnings: string[] } {
  const unchanged = { periods: evidence.periods, warnings: [] };
  const { periods, summaries, conflicts } = evidence;
  if (!finished || conflicts.length > 0 || !periods.P1 || !periods.P2 || !periods.P3 || !periods.OT1) return unchanged;
  if (segments.some((segment) => !["P1", "P2", "P3", "OT1", "SO"].includes(segment))) return unchanged;
  const regulation = summaries.summaryRegulation?.faceoffsWon;
  const full = summaries.summaryFull?.faceoffsWon;
  if (!regulation || !full || typeof sourceTotals.home !== "number" || typeof sourceTotals.away !== "number") return unchanged;
  const source = { home: sourceTotals.home, away: sourceTotals.away };
  if (!validPair(source) || !equalPair(source, full)) return unchanged;
  const sum = {
    home: periods.P1.faceoffsWon.home + periods.P2.faceoffsWon.home + periods.P3.faceoffsWon.home,
    away: periods.P1.faceoffsWon.away + periods.P2.faceoffsWon.away + periods.P3.faceoffsWon.away,
  };
  if (!validPair(sum) || !equalPair(sum, regulation)) return unchanged;
  if (summaries.summaryTwo && !equalPair(summaries.summaryTwo.faceoffsWon, {
    home: periods.P1.faceoffsWon.home + periods.P2.faceoffsWon.home,
    away: periods.P1.faceoffsWon.away + periods.P2.faceoffsWon.away,
  })) return unchanged;
  const corrected = { home: full.home - regulation.home, away: full.away - regulation.away };
  const original = periods.OT1.faceoffsWon;
  if (!validPair(corrected) || equalPair(original, corrected)) return unchanged;
  if (original.home + original.away !== corrected.home + corrected.away) return unchanged;
  const pair = (value: KhlScore) => `${value.home}:${value.away}`;
  return {
    periods: { ...periods, OT1: { ...periods.OT1, faceoffsWon: corrected } },
    warnings: [
      `Вбрасывания в овертайме: ${pair(original)} в источнике уточнены до ${pair(corrected)}. `
      + `Основание: итог матча ${pair(full)} подтверждён командными итогами и сводкой матча; `
      + `итог трёх периодов ${pair(regulation)} подтверждён суммой периодов и сводкой. `
      + "Общее число вбрасываний в овертайме сохранено. Данные основного времени не изменены.",
    ],
  };
}
