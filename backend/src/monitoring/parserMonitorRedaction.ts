export function redactMonitorText(value: string) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/<[^>\r\n]{0,1000}>/g, "")
    .replace(/https:\/\/api\.telegram\.org\/bot[^\s/]+\/[^\s]+/gi, "[REDACTED_TELEGRAM_URL]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{6,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s<>"']+/gi, "[REDACTED_CREDENTIAL_URL]")
    .replace(/\bauthorization\s*[=:]\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization=[REDACTED]")
    .replace(/(["']?)(password|passwd|token|api[_-]?key|authorization)\1\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi, "$2=[REDACTED]");
}
