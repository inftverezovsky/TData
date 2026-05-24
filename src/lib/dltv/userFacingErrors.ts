import { normalizeParserErrorClass } from "@/lib/proxy/parserErrors";

export function normalizeDltvErrorClass(errorClass?: string | null, message?: string | null) {
  return normalizeParserErrorClass(errorClass || message || "unknown");
}

export function getDltvErrorMessage(errorClass?: string | null, message?: string | null) {
  const normalized = normalizeDltvErrorClass(errorClass, message);
  if (normalized === "cloudflare_block" || normalized === "rate_limited") {
    return "DLTV ограничил доступ через текущий прокси. Попробуйте обновить или сменить прокси.";
  }
  if (normalized === "proxy_tunnel" || normalized === "proxy_missing" || normalized === "network_error") {
    return "Прокси не смог открыть DLTV. Проверьте proxy pool и повторите запрос.";
  }
  if (normalized === "timeout") {
    return "DLTV не ответил вовремя. Попробуйте повторить запрос позже.";
  }
  if (normalized === "selector_changed" || normalized === "parse_failed") {
    return "DLTV изменил разметку страницы. Нужна проверка парсера.";
  }
  if (normalized === "empty_valid") {
    return "DLTV не вернул подходящие турниры по этому запросу.";
  }
  return message || "Не удалось загрузить данные DLTV.";
}
