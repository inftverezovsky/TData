const DEFAULT_SUBPAGE_CONCURRENCY = 3;

/** Нулевой, дробный или нечисловой шаг нарушает продвижение по пакетам страниц. */
export function resolveSubpageConcurrency(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SUBPAGE_CONCURRENCY;
}
