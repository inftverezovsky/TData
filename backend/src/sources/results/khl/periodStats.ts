import type { KhlScore, KhlSegment, NormalizedKhlMatch } from "./normalize";

type Stats = { shotsOnGoal: KhlScore; faceoffsWon: KhlScore };
export type PeriodStats = Record<string, Stats>;
type StatsEvidence = {
  periods: PeriodStats;
  summaries: Record<string, Stats>;
  conflicts: string[];
};

export function parseKhlPeriodStats(events: Record<string, unknown>[]): StatsEvidence {
  const selectedEvents = selectCompletedPeriodRows(events);
  const rows: Record<string, Stats> = {};
  const conflicts = new Set<string>();
  for (const event of selectedEvents) {
    if (event.type !== "info" || typeof event.text !== "string") continue;
    const key = statsKey(event.text);
    if (!key) continue;
    const shotsOnGoal = metricPair(event.text, "Броски в створ");
    const faceoffsWon = metricPair(event.text, "Вбрасывания");
    const declaredPeriod = event.period;
    const expectedPeriod = key.startsWith("P") ? Number(key.slice(1))
      : key.startsWith("OT") ? Number(key.slice(2)) + 3 : null;
    if (!shotsOnGoal || !faceoffsWon || (expectedPeriod !== null
      && declaredPeriod != null && declaredPeriod !== expectedPeriod)) {
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

/** Timed in-period updates share the final row's title in the mobile feed. */
function selectCompletedPeriodRows(events: Record<string, unknown>[]) {
  const finalKeys = new Set(events.flatMap((event) => {
    if (event.type !== "info" || typeof event.text !== "string" || event.period !== null) return [];
    const key = statsKey(event.text);
    return key && /^(P|OT)/.test(key) ? [key] : [];
  }));
  return events.filter((event) => {
    if (event.type !== "info" || typeof event.text !== "string") return true;
    const key = statsKey(event.text);
    if (!key || !finalKeys.has(key) || event.period == null) return true;
    const expectedPeriod = key.startsWith("P") ? Number(key.slice(1)) : Number(key.slice(2)) + 3;
    // Unknown or contradictory metadata remains visible to the conflict check.
    if (event.period !== expectedPeriod) return true;
    const finalRows = events.filter((row) => row.type === "info" && row.period === null
      && typeof row.text === "string" && statsKey(row.text) === key);
    return !finalRows.every((row) => ["Броски в створ", "Вбрасывания"].every((label) => {
      const partial = metricPair(event.text as string, label);
      const final = metricPair(row.text as string, label);
      return partial && final && partial.home <= final.home && partial.away <= final.away;
    }));
  });
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
  if ([...text.matchAll(new RegExp(`${label}:`, "gi"))].length !== 1) return null;
  const match = text.match(new RegExp(`${label}:\\s*(\\d+)\\s*-\\s*(\\d+)(?=\\s*(?:;|$))`, "i"));
  if (!match) return null;
  const pair = { home: Number(match[1]), away: Number(match[2]) };
  return validPair(pair) ? pair : null;
}

export function validateKhlStatsSummaries(
  evidence: StatsEvidence,
  teamStats: NormalizedKhlMatch["teamStats"],
  issues: string[]
) {
  for (const [key, summary] of Object.entries(evidence.summaries)) {
    for (const side of ["home", "away"] as const) {
      for (const metric of ["shotsOnGoal", "faceoffsWon"] as const) {
        const stats = teamStats[side][metric];
        const total = key === "summaryFull" ? stats.fullMatchTotal
          : key === "summaryRegulation" ? stats.regulationTotal
            : (stats.segments.P1 || 0) + (stats.segments.P2 || 0);
        if (summary[metric][side] !== total) {
          issues.push(`KHL ${side} ${metric} ${key} mismatch: summary=${summary[metric][side]}, segments=${total}.`);
        }
      }
    }
  }
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
