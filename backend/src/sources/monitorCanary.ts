export type MonitorRequestPlan<T> = Readonly<{
  items: readonly T[];
  concurrency: number;
}>;

export function buildMonitorRequestPlan<T>(
  items: readonly T[],
  requestedConcurrency: number,
  monitorMode: boolean,
): MonitorRequestPlan<T> {
  if (monitorMode) {
    return Object.freeze({
      items: Object.freeze(items.slice(0, 1)),
      concurrency: 1,
    });
  }

  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.trunc(requestedConcurrency))
    : 1;
  return Object.freeze({
    items: Object.freeze([...items]),
    concurrency,
  });
}
