export const PARSER_ERROR_CLASSES = [
  "proxy_tunnel",
  "cloudflare_block",
  "selector_changed",
  "empty_valid",
  "source_5xx",
  "parse_failed",
  "timeout",
  "rate_limited",
  "source_4xx",
  "proxy_missing",
  "network_error",
  "process_failed",
  "unknown",
] as const;

export type ParserErrorClass = typeof PARSER_ERROR_CLASSES[number];

type ParserErrorInput = {
  message?: string | null;
  statusCode?: number | null;
  timedOut?: boolean;
};

export function normalizeParserErrorClass(value?: string | null): ParserErrorClass {
  const raw = String(value || "").trim().toLowerCase();
  if (isParserErrorClass(raw)) return raw;

  if (raw === "tunnel") return "proxy_tunnel";
  if (raw === "cloudflare" || raw === "blocked") return "cloudflare_block";
  if (raw === "selector_missing") return "selector_changed";
  if (raw === "invalid_json" || raw === "non_json") return "parse_failed";
  if (raw === "network") return "network_error";
  if (raw === "spawn") return "process_failed";
  if (raw === "http_error") return "source_5xx";

  return "unknown";
}

export function classifyParserError(input: ParserErrorInput): ParserErrorClass {
  const message = String(input.message || "");
  const statusCode = input.statusCode || extractStatusCode(message);

  if (input.timedOut) {
    return "timeout";
  }

  if (/proxy is not configured|прокси не настроены|no proxy|missing proxy/i.test(message)) {
    return "proxy_missing";
  }

  if (/ERR_TUNNEL_CONNECTION_FAILED|tunnel|proxy authentication|proxy auth|407|ECONNRESET|socket hang up/i.test(message)) {
    return "proxy_tunnel";
  }

  if (/chrome-error:\/\/chromewebdata|ERR_PROXY|ERR_SOCKS|ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET/i.test(message)) {
    return "proxy_tunnel";
  }

  if (
    /cloudflare|cf-ray|challenge|captcha|attention required|checking your browser|ddos-guard|turnstile/i.test(message) ||
    statusCode === 403 ||
    statusCode === 424
  ) {
    return "cloudflare_block";
  }

  if (statusCode === 429 || /too many requests|rate.?limit/i.test(message)) {
    return "rate_limited";
  }

  if (statusCode && statusCode >= 500) return "source_5xx";
  if (statusCode && statusCode >= 400) return "source_4xx";

  if (/ERR_TIMED_OUT|ETIMEDOUT|ESOCKETTIMEDOUT|navigation timed out|page\.goto: timeout/i.test(message)) {
    return "timeout";
  }

  if (/Target page, context or browser has been closed|browser closed before|page closed|browser has been closed/i.test(message)) {
    return "timeout";
  }

  if (/selector|waiting for .*elements|locator|element.*not found|Timeout waiting/i.test(message)) {
    return "selector_changed";
  }

  if (/\b(timeout|timed out|deadline exceeded|aborted)\b/i.test(message)) {
    return "timeout";
  }

  if (/non-json|invalid json|unexpected token|JSON\.parse|parse error|failed to parse|syntaxerror/i.test(message)) {
    return "parse_failed";
  }

  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|fetch failed|TLS|SSL|certificate/i.test(message)) {
    return "network_error";
  }

  if (/spawn|process failed|failed to start|child_process/i.test(message)) {
    return "process_failed";
  }

  return "unknown";
}

export function isParserErrorClass(value: string): value is ParserErrorClass {
  return (PARSER_ERROR_CLASSES as readonly string[]).includes(value);
}

export function isBlockedParserError(errorClass?: string | null) {
  const normalized = normalizeParserErrorClass(errorClass);
  return normalized === "cloudflare_block" || normalized === "rate_limited";
}

export function shouldCooldownProxyForError(errorClass?: string | null) {
  const normalized = normalizeParserErrorClass(errorClass);
  return (
    normalized === "proxy_tunnel" ||
    normalized === "cloudflare_block" ||
    normalized === "timeout" ||
    normalized === "network_error" ||
    normalized === "rate_limited"
  );
}

export function emptyValidIfNoItems(counts: Array<number | null | undefined>): ParserErrorClass | null {
  if (counts.length === 0) return null;
  return counts.every((count) => count === 0) ? "empty_valid" : null;
}

function extractStatusCode(message: string) {
  const match = message.match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : null;
}
