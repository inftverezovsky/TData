export function getClientRateLimitKey(request: Request, namespace: string) {
  return `${namespace}:${getClientIp(request)}`;
}

function getClientIp(request: Request) {
  if (!trustProxyHeaders()) return "direct";

  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "direct"
  );
}

function trustProxyHeaders() {
  return (
    process.env.TRUST_PROXY_HEADERS === "1" ||
    process.env.TRUST_PROXY_HEADERS === "true"
  );
}
