/** Хранение свёрнутых чемпионатов — необязательная настройка интерфейса. */
export function readCollapsedPreference(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // При запрете storage показываем чемпионат развёрнутым, сохраняя доступ к данным.
    return false;
  }
}

export function writeCollapsedPreference(key: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(key, collapsed ? "1" : "0");
  } catch {
    // Сворачивание продолжает работать в React-состоянии даже без сохранения между посещениями.
  }
}
