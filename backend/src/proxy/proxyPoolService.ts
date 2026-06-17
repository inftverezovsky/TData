import { prisma } from "@backend/db/db";

export type ProxyPoolAction = "clear-blocked" | "clear-all";

export async function listProxyPool() {
  const proxies = await prisma.proxyPool.findMany({
    orderBy: { createdAt: "desc" },
  });

  return proxies.map((proxy) => ({
    id: proxy.id,
    url: maskProxyUrl(proxy.url),
    protocol: proxy.protocol,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username ? maskValue(proxy.username) : null,
    isActive: proxy.isActive,
    successCount: proxy.successCount,
    blockedCount: proxy.blockedCount,
    failCount: proxy.failCount,
    cooldownUntil: proxy.cooldownUntil,
    avgLatencyMs: proxy.avgLatencyMs,
    lastError: maskSecrets(proxy.lastError),
    lastUsed: proxy.lastUsed,
    createdAt: proxy.createdAt,
  }));
}

export async function upsertProxyPoolFromText(rawText: string) {
  const parsedProxies = parseProxyList(rawText);
  if (parsedProxies.length === 0) return 0;

  let inserted = 0;
  for (const proxy of parsedProxies) {
    await prisma.proxyPool.upsert({
      where: { url: proxy.url },
      update: { isActive: true, failCount: 0, cooldownUntil: null, lastError: null },
      create: { ...proxy, isActive: true },
    });
    inserted++;
  }

  return inserted;
}

export async function deleteProxyPoolByAction(action: ProxyPoolAction) {
  if (action === "clear-blocked") {
    return prisma.proxyPool.deleteMany({ where: { isActive: false } });
  }

  return prisma.proxyPool.deleteMany();
}

export async function deleteProxyPoolById(id: string) {
  return prisma.proxyPool.delete({ where: { id } });
}

export function parseProxyList(rawText: string) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = parseProxyLine(line);
      return parsed ? [parsed] : [];
    });
}

function parseProxyLine(line: string) {
  if (
    /^(HTTPS?|SOCKS5?)\s*[:#-]?\s*$/i.test(line) ||
    line.includes("Россия") ||
    line.includes("Иностранные")
  ) {
    return null;
  }

  const normalizedUrl = toProxyUrl(line);
  if (!normalizedUrl) return null;

  try {
    const url = new URL(normalizeProxyUrl(normalizedUrl));
    const port = parseInt(url.port, 10);
    if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) return null;

    return {
      url: url.toString(),
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port,
      username: url.username ? decodeURIComponent(url.username) : null,
      password: url.password ? decodeURIComponent(url.password) : null,
    };
  } catch {
    return null;
  }
}

function toProxyUrl(rawLine: string) {
  let clean = rawLine.trim();
  if (!clean) return null;

  let protocol = "http";
  const protoMatch = clean.match(/^([a-zA-Z0-9+.-]+):\/\//);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    clean = clean.substring(protoMatch[0].length);
  }

  if (clean.includes("@")) {
    return `${protocol}://${clean}`;
  }

  const parts = clean.split(":");
  if (parts.length === 2) {
    return `${protocol}://${parts[0]}:${parts[1]}`;
  }

  if (parts.length === 4) {
    const secondIsPort = /^\d+$/.test(parts[1]);
    if (secondIsPort) {
      const [host, port, username, password] = parts;
      return `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    }

    const [username, password, host, port] = parts;
    return `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }

  return null;
}

export function maskProxyUrl(rawUrl: string) {
  try {
    const url = new URL(normalizeProxyUrl(rawUrl));
    if (url.username) url.username = maskValue(decodeURIComponent(url.username));
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "[invalid proxy]";
  }
}

export function maskValue(value: string) {
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function maskSecrets(value: string | null) {
  if (!value) return null;
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+)(?::([^/\s@]*))?@/gi, "$1***:***@");
}

function normalizeProxyUrl(rawUrl: string) {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)
    ? rawUrl
    : `http://${rawUrl}`;
  const url = new URL(withProtocol);

  if (isGWGateway(url.hostname)) {
    url.protocol = "http:";
    if (!url.port || url.port === "10443") {
      url.port = "10080";
    }

    const username = decodeURIComponent(url.username || "");
    if (username && !username.startsWith("user-")) {
      const country = process.env.GW_PROXY_DEFAULT_COUNTRY || "ru";
      url.username = `user-${username}-type-residential-country-${country.toLowerCase()}`;
    }
  }

  return url.toString();
}

function isGWGateway(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "geo.g-w.info" || host.endsWith(".g-w.info");
}
