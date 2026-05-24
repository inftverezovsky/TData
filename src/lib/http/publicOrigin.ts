const PUBLIC_ORIGIN_ENV_KEYS = [
  "TCYBER_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "PUBLIC_BASE_URL",
  "APP_URL",
];

export function resolvePublicOrigin(request: Request, explicitOrigin?: unknown) {
  const candidates = [
    readConfiguredPublicOrigin(),
    typeof explicitOrigin === "string" ? explicitOrigin : "",
    readForwardedOrigin(request),
    readHostOrigin(request),
    readRequestOrigin(request),
  ];

  const parsedCandidates = candidates
    .map((candidate) => normalizeOrigin(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  return (
    parsedCandidates.find((candidate) => !isWildcardOrLocalOrigin(candidate)) ||
    parsedCandidates[0] ||
    "http://localhost:3010"
  );
}

function readConfiguredPublicOrigin() {
  for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
    const value = process.env[key];
    if (value) return value;
  }
  return "";
}

function readForwardedOrigin(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return "";

  const host = readFirstHeaderValue(request.headers.get("x-forwarded-host"));
  if (!host) return "";

  const proto = readFirstHeaderValue(request.headers.get("x-forwarded-proto")) || readRequestProtocol(request);
  return `${proto}://${host}`;
}

function readHostOrigin(request: Request) {
  const host = request.headers.get("host");
  if (!host) return "";
  return `${readRequestProtocol(request)}://${host}`;
}

function readRequestOrigin(request: Request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

function readRequestProtocol(request: Request) {
  try {
    return new URL(request.url).protocol.replace(":", "") || "http";
  } catch {
    return "http";
  }
}

function readFirstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || "";
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function isWildcardOrLocalOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return (
      hostname === "0.0.0.0" ||
      hostname === "::" ||
      hostname === "[::]" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return true;
  }
}
