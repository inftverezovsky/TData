import {
  classifyParserError,
  normalizeParserErrorClass,
  type ParserErrorClass,
} from "@backend/proxy/parserErrors";

export function getHltvSearchErrorMessage(errorClass?: string | null, fallback?: string | null) {
  const normalized = normalizeHltvErrorClass(errorClass, fallback);

  switch (normalized) {
    case "proxy_missing":
      return "Прокси не настроены. Добавьте рабочий прокси в Proxy Pool и повторите поиск.";
    case "proxy_tunnel":
      return "Текущий прокси не смог открыть HLTV. Попробуйте другой прокси или повторите запрос позже.";
    case "timeout":
      return "HLTV не успел ответить через текущий прокси. Попробуйте обновить поиск или сменить прокси.";
    case "cloudflare_block":
      return "HLTV/Cloudflare заблокировал текущую proxy-сессию. Нужен другой прокси или ручной импорт.";
    case "rate_limited":
      return "HLTV временно ограничил запросы. Подождите несколько минут или смените прокси.";
    case "selector_changed":
      return "HLTV открылся, но блок с результатами поиска не появился. Попробуйте точнее указать название турнира или повторить позже.";
    case "source_5xx":
      return "HLTV сейчас отвечает ошибкой сервера. Повторите поиск позже.";
    case "source_4xx":
      return "HLTV отклонил запрос поиска. Попробуйте другое название или другой прокси.";
    case "empty_valid":
      return "По этому запросу HLTV не вернул турниры.";
    default:
      // Неизвестный текст нужен только для классификации: он может содержать адреса и данные запроса.
      return "Не удалось выполнить поиск HLTV. Проверьте прокси и повторите запрос.";
  }
}

export function normalizeHltvErrorClass(errorClass?: string | null, fallback?: string | null): ParserErrorClass {
  if (errorClass) return normalizeParserErrorClass(errorClass);
  if (fallback) return classifyParserError({ message: fallback });
  return "unknown";
}
