const SAFE_SYNC_MESSAGES = new Set([
  "KHL schedule returned an invalid match date.",
  "KHL detail identity, date or finished status does not match the selected result.",
  "KHL normalized revision was stored as REJECTED and was not activated.",
  "KHL protocol was preserved as a rejected diagnostic revision.",
  "KHL sync lease lost; refusing an unfenced write.",
  "KHL API response exceeds the configured size limit.",
  "KHL API request failed.",
  "KHL API request timed out.",
]);

/** Публикуем только известную причину; исходный текст остаётся в защищённых данных парсера. */
export function safeKhlSyncError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  if (SAFE_SYNC_MESSAGES.has(message)) return message;
  if (/^KHL API returned HTTP [1-5]\d{2}\.$/.test(message)) return message;
  // Эти категории также использует retry: редактирование диагностики не отключает повтор сетевого чтения.
  if (/^KHL API request failed:/.test(message)) return "KHL API request failed.";
  if (/^KHL API request timed out after \d+ ms\.$/.test(message)) return "KHL API request timed out.";
  return "KHL operation failed; protected server diagnostics are required.";
}
