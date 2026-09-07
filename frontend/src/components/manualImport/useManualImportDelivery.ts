"use client";

import { readJsonResponse } from "@/services/responseSchema";
import { decodeManualResponse, decodeManualPreview } from "./response";
import { mergeSelectedMatchesWithMappedIds, mergeSelectedMappedMatches } from "./matchModel";
import { copyToClipboard } from "./browserFiles";
import type { ManualImportState } from "./useManualImportState";

export function useManualImportDelivery(state: ManualImportState) {
  const { authenticatedFetch, disciplineId, shapkaId, matches, setMatches, mappedMatches, setMappedMatches, selectedMatchIndexes, preview, setPreview, message, setMessage, setPreviewing, setSending, setLastServiceJsonUrl, selectedMatches, hasValidDisciplineId, hasValidShapkaId } = state;

  async function runPreview() {
    // Проверить реквизиты и выбор → собрать payload на сервере → вернуть ID только в соответствующие выбранные строки.
    if (!hasValidDisciplineId || !hasValidShapkaId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины и ID шапки перед формированием payload." });
      return;
    }
    if (selectedMatches.length === 0) {
      setMessage({
        type: "error",
        text: matches.length === 0 ? "Сначала распознайте или добавьте матчи." : "Выберите матчи для заливки.",
      });
      return;
    }

    setPreviewing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, shapkaId, matches: selectedMatches }),
      });
      const data = await readJsonResponse(response, decodeManualPreview, "Ошибка превью");

      setPreview(data);
      setMappedMatches((current) => mergeSelectedMappedMatches(current, selectedMatchIndexes, data.mappedMatches || []));
      setMatches((current) => mergeSelectedMatchesWithMappedIds(current, selectedMatchIndexes, data.mappedMatches || []));
      setMessage({ type: "success", text: `Готово к заливке: ${data.readyMatchesCount} выбранных матчей.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка превью" });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendToAdmin() {
    // Отправка — отдельное действие пользователя: повторная валидация, подтверждение и обработка ответа API.
    if (!hasValidDisciplineId || !hasValidShapkaId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины и ID шапки перед заливкой." });
      return;
    }
    if (selectedMatches.length === 0) {
      setMessage({ type: "error", text: "Выберите матчи для заливки." });
      return;
    }
    if (!confirm(`Залить выбранные матчи в API? Количество: ${selectedMatches.length}`)) return;

    setSending(true);
    setMessage(null);

    try {
      const response = await authenticatedFetch("/api/manual-import/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, shapkaId, matches: selectedMatches }),
      });
      const data = await readJsonResponse(response, decodeManualResponse, "Ошибка запроса ручного импорта");
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Ошибка при заливке");
      }

      setMessage({
        type: "success",
        text: `Данные успешно залиты. Статус: ${data.status}`,
        raw: data.rawResponse,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка отправки" });
    } finally {
      setSending(false);
    }
  }

  async function openServiceUpload() {
    if (!hasValidDisciplineId || !hasValidShapkaId) {
      setMessage({ type: "error", text: "Укажите ID дисциплины и ID шапки перед заливкой через сервис." });
      return;
    }
    if (selectedMatches.length === 0) {
      setMessage({ type: "error", text: "Выберите матчи для заливки через сервис." });
      return;
    }

    // Открываем окно синхронно по клику: после await браузер может заблокировать popup.
    const openedWindow = window.open("", "_blank");
    if (!openedWindow) {
      setMessage({ type: "error", text: "Не удалось открыть сервис. Разрешите всплывающие окна для этого сайта." });
      return;
    }
    openedWindow.opener = null;

    setSending(true);
    setMessage(null);
    setLastServiceJsonUrl("");

    try {
      const response = await fetch("/api/manual-import/service-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disciplineId, shapkaId, matches: selectedMatches, publicOrigin: window.location.origin }),
      });
      const data = await readJsonResponse(response, decodeManualResponse, "Ошибка запроса ручного импорта");
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Не удалось создать ссылку для сервиса");
      }

      const jsonUrl = typeof data.jsonUrl === "string" ? data.jsonUrl : "";
      if (!jsonUrl) throw new Error("Сервис не вернул JSON-ссылку.");

      setLastServiceJsonUrl(jsonUrl);
      const copied = await copyToClipboard(jsonUrl);
      if (!data.serviceUrl) throw new Error("Сервис не вернул адрес загрузки.");
      openedWindow.location.href = data.serviceUrl;
      setMessage({
        type: copied ? "success" : "info",
        text: copied
          ? `Сервис открыт, JSON-ссылка скопирована. Выбрано матчей: ${selectedMatches.length}.`
          : "Сервис открыт, но браузер запретил автокопирование. Скопируйте JSON-ссылку из поля ниже.",
        raw: copied ? undefined : jsonUrl,
      });
    } catch (error) {
      if (!openedWindow.closed) openedWindow.close();
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Ошибка сервиса" });
    } finally {
      setSending(false);
    }
  }

  return { runPreview, sendToAdmin, openServiceUpload };
}
