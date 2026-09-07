"use client";

import { useEffect, useState } from "react";
import { loadGlobalSettings, saveGlobalSettings } from "@/services/globalSettings";

/** Загрузка → локальное редактирование → подтверждённое сохранение. Ошибки не стирают пользовательские правки. */
export function useGlobalSettings<T extends Record<string, string>>(
  defaults: T,
  normalize: (settings: Partial<Record<string, string>>) => T,
) {
  const [settings, setSettings] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadGlobalSettings(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSettings(normalize({ ...defaults, ...data }));
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить настройки.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [defaults, normalize, loadAttempt]);

  function retryLoad() {
    setError(null);
    setLoading(true);
    setLoadAttempt((current) => current + 1);
  }

  async function save(): Promise<boolean> {
    // Не записываем defaults поверх неизвестного состояния сервера после неудачной загрузки.
    if (!loaded) return false;
    setSaving(true);
    setError(null);
    try {
      await saveGlobalSettings(normalize(settings));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { settings, setSettings, loading, loaded, saving, error, retryLoad, save };
}
