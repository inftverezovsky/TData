/** Общая точка обмена настройками для TableT и TBvolley. */
export async function loadGlobalSettings(signal?: AbortSignal): Promise<Record<string, string>> {
  const response = await fetch("/api/settings/global", { signal, cache: "no-store" });
  const data = await readSettingsResponse(response);
  if (!Object.values(data).every((value) => typeof value === "string")) {
    throw new Error("Сервер вернул некорректные настройки.");
  }
  return data as Record<string, string>;
}

export async function saveGlobalSettings(settings: Record<string, string>): Promise<void> {
  const response = await fetch("/api/settings/global", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  // fetch отклоняет только сетевые ошибки. HTTP 401/500 и отсутствие подтверждения тоже означают неуспех.
  const data = await readSettingsResponse(response);
  if (data.ok !== true) throw new Error("Сервер не подтвердил сохранение настроек.");
}

async function readSettingsResponse(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  const record = data !== null && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  if (!response.ok) {
    throw new Error(typeof record?.error === "string" ? record.error : `Запрос настроек завершился с ошибкой HTTP ${response.status}.`);
  }
  if (!record) throw new Error("Сервер вернул некорректный ответ настроек.");
  return record;
}
