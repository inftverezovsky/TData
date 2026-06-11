import {
  classifyParserError,
  normalizeParserErrorClass,
  type ParserErrorClass,
} from "@/lib/proxy/parserErrors";
import { getHltvSearchErrorMessage } from "@/lib/sources/TCyber/hltv/userFacingErrors";
import { getLiquipediaUserMessage } from "@/lib/sources/TCyber/liquipedia/userFacingErrors";
import type { TournamentSource } from "@/lib/utils/tournamentSource";

const SOURCE_LABELS: Record<TournamentSource, string> = {
  liquipedia: "Liquipedia",
  hltv: "HLTV",
  vlr: "VLR",
  dltv: "DLTV",
  fandom: "Fandom",
  volleyballworld: "Volleyball World",
  beachvolleyru: "beach.volley.ru",
  germanbeachtour: "German Beach Tour",
  twelvendrcsvp: "12ndr CSVP",
  twelvendroevv: "12ndr OEVV",
  cbv: "CBV",
  federvolley: "Federvolley",
  wtt: "WTT",
};

const IMPORT_SOURCES = new Set<TournamentSource>(Object.keys(SOURCE_LABELS) as TournamentSource[]);

export function getTournamentImportUserMessage(
  source: TournamentSource | string | null | undefined,
  errorClass?: string | null,
  fallback?: string | null,
) {
  const normalizedSource = normalizeImportSource(source);

  if (normalizedSource === "liquipedia") {
    return getLiquipediaUserMessage(errorClass, fallback);
  }

  if (normalizedSource === "hltv") {
    return getHltvSearchErrorMessage(errorClass, fallback);
  }

  const normalizedErrorClass = normalizeImportErrorClass(errorClass, fallback);
  const label = normalizedSource ? SOURCE_LABELS[normalizedSource] : "Источник";

  switch (normalizedErrorClass) {
    case "proxy_missing":
      return "Прокси не настроены. Добавьте рабочий прокси в Proxy Pool и повторите запрос.";
    case "proxy_tunnel":
      return `Текущий прокси не смог открыть ${label}. Попробуйте другой прокси или повторите позже.`;
    case "timeout":
      return `${label} не успел ответить. Повторите запрос позже.`;
    case "cloudflare_block":
      return `${label}/Cloudflare заблокировал запрос. Повторите позже или проверьте доступ к источнику.`;
    case "rate_limited":
      return `${label} временно ограничил запросы. Подождите несколько минут и повторите.`;
    case "selector_changed":
      return `${label} открылся, но структура страницы изменилась. Нужно обновить парсер.`;
    case "parse_failed":
      return `${label} вернул некорректный ответ. Повторите запрос позже.`;
    case "source_5xx":
      return `${label} сейчас отвечает ошибкой сервера. Повторите запрос позже.`;
    case "source_4xx":
      return `${label} отклонил запрос. Проверьте данные турнира или повторите позже.`;
    case "empty_valid":
      return `${label} не вернул турниры по этому запросу.`;
    case "network_error":
      return `Не удалось подключиться к ${label}. Повторите запрос позже.`;
    default:
      if (fallback && !isInternalTournamentImportError(fallback)) return fallback;
      return `Не удалось загрузить данные из ${label}. Повторите запрос позже.`;
  }
}

function normalizeImportSource(source: TournamentSource | string | null | undefined): TournamentSource | null {
  const normalized = String(source || "").trim().toLowerCase() as TournamentSource;
  return IMPORT_SOURCES.has(normalized) ? normalized : null;
}

function normalizeImportErrorClass(errorClass?: string | null, fallback?: string | null): ParserErrorClass {
  if (errorClass) return normalizeParserErrorClass(errorClass);
  if (fallback) return classifyParserError({ message: fallback });
  return "unknown";
}

function isInternalTournamentImportError(message: string) {
  return /<!doctype|<html|<\/html|<head|<body|<script|cf-ray|cloudflare|turnstile|captcha|attention required|checking your browser|HTTP\s+[45]\d{2}:|returned non-JSON|invalid JSON|fetch failed|AbortError|ERR_|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|socket hang up|node-fetch|Unexpected token/i.test(message);
}
