import { selectManualImportImageHashes } from "@backend/manualImport/imageBatch";

/** Отбирает файлы очереди и возвращает отклонённые элементы для освобождения preview URL. */
export function selectManualImportImageItems<T extends { hash: string }>(currentHashes: string[], preparedItems: T[]) {
  const selection = selectManualImportImageHashes(currentHashes, preparedItems.map((item) => item.hash));
  const acceptedHashes = new Set(selection.acceptedHashes);
  // Один разрешённый хеш соответствует ровно одному файлу: повторный preview нужно освободить.
  const items = preparedItems.reduce<{ acceptedItems: T[]; rejectedItems: T[] }>((result, item) => {
    const alreadyAccepted = result.acceptedItems.some((accepted) => accepted.hash === item.hash);
    return acceptedHashes.has(item.hash) && !alreadyAccepted
      ? { ...result, acceptedItems: [...result.acceptedItems, item] }
      : { ...result, rejectedItems: [...result.rejectedItems, item] };
  }, { acceptedItems: [], rejectedItems: [] });
  return {
    ...selection,
    ...items,
  };
}
