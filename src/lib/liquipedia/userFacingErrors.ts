import {
  classifyParserError,
  normalizeParserErrorClass,
  type ParserErrorClass,
} from "@/lib/proxy/parserErrors";

type ErrorLike = {
  message?: unknown;
  errorClass?: unknown;
  statusCode?: unknown;
};

export function getLiquipediaUserMessage(errorClass?: string | null, fallback?: string | null) {
  const normalized = normalizeLiquipediaErrorClass(errorClass, fallback);

  switch (normalized) {
    case "proxy_missing":
      return "Прокси не настроены. Добавьте рабочий прокси в Proxy Pool и повторите запрос.";
    case "proxy_tunnel":
      return "Текущий прокси не смог открыть Liquipedia. Попробуйте другой прокси или повторите позже.";
    case "timeout":
      return "Liquipedia не успела ответить через текущий прокси. Попробуйте обновить запрос или сменить прокси.";
    case "cloudflare_block":
      return "Liquipedia/Cloudflare заблокировала текущую proxy-сессию. Нужен другой прокси или повторите позже.";
    case "rate_limited":
      return "Liquipedia временно ограничила запросы. Подождите несколько минут или смените прокси.";
    case "parse_failed":
      return "Liquipedia вернула некорректный ответ. Попробуйте повторить запрос или сменить прокси.";
    case "source_5xx":
      return "Liquipedia сейчас отвечает ошибкой сервера. Повторите запрос позже.";
    case "source_4xx":
      return "Liquipedia отклонила запрос. Проверьте название турнира или попробуйте другой прокси.";
    case "empty_valid":
      return "По этому запросу Liquipedia не вернула турниры.";
    case "network_error":
      return "Не удалось подключиться к Liquipedia. Проверьте прокси и повторите запрос.";
    default:
      if (fallback && !isInternalLiquipediaError(fallback)) return fallback;
      return "Не удалось выполнить запрос к Liquipedia. Проверьте прокси и повторите попытку.";
  }
}

export function normalizeLiquipediaErrorClass(errorClass?: string | null, fallback?: string | null): ParserErrorClass {
  if (errorClass) return normalizeParserErrorClass(errorClass);
  if (fallback) return classifyParserError({ message: fallback });
  return "unknown";
}

export function toLiquipediaUserFacingError(error: unknown) {
  const errorLike = toErrorLike(error);
  const fallback = typeof errorLike.message === "string"
    ? errorLike.message
    : error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : null;
  const explicitErrorClass = typeof errorLike.errorClass === "string" ? errorLike.errorClass : null;
  const statusCode = typeof errorLike.statusCode === "number" ? errorLike.statusCode : null;
  const errorClass = explicitErrorClass
    ? normalizeParserErrorClass(explicitErrorClass)
    : classifyParserError({ message: fallback, statusCode });
  const userMessage = getLiquipediaUserMessage(errorClass, fallback);

  return { errorClass, userMessage };
}

export function getLiquipediaResponseStatus(errorClass?: string | null) {
  switch (normalizeParserErrorClass(errorClass)) {
    case "rate_limited":
      return 429;
    case "proxy_missing":
      return 503;
    case "cloudflare_block":
    case "proxy_tunnel":
    case "network_error":
    case "source_4xx":
    case "source_5xx":
      return 502;
    default:
      return 500;
  }
}

function toErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === "object") return error as ErrorLike;
  return {};
}

function isInternalLiquipediaError(message: string) {
  return /<!doctype|<html|<\/html|<head|<body|<script|cf-ray|cloudflare|turnstile|captcha|attention required|checking your browser|Liquipedia API error|Failed to fetch HTML|returned non-JSON|invalid JSON|fetch failed|AbortError|ERR_|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|socket hang up|node-fetch|Unexpected token/i.test(message);
}
