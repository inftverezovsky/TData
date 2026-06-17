import { prisma } from "@backend/db/db";
import { isBlockedParserError, normalizeParserErrorClass, shouldCooldownProxyForError } from "@backend/proxy/parserErrors";

const PROXY_POOL_CACHE_TTL_MS = Number(process.env.PROXY_POOL_CACHE_TTL_MS || 15000);
const PROXY_COOLDOWN_MS = Number(process.env.PROXY_COOLDOWN_MS || 10 * 60 * 1000);

type CachedProxy = {
  id: string;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  failCount: number;
  blockedCount: number;
  avgLatencyMs: number | null;
  lastUsed: Date | null;
};

export type ProxyCandidate = {
  proxyId: string;
  proxyUrl: string;
};

let proxyCache: { expiresAt: number; proxies: CachedProxy[] } | null = null;

export async function selectProxyCandidate(attempt = 1): Promise<ProxyCandidate | null> {
  const proxies = await getActiveProxyPool();
  if (proxies.length === 0) return null;

  const ranked = [...proxies].sort((a, b) => proxyScore(a) - proxyScore(b));
  const candidate = ranked[(attempt - 1) % Math.min(ranked.length, 5)];
  const proxyUrl = buildProxyUrl(
    candidate.protocol,
    candidate.host,
    candidate.port,
    rotateProxySession(candidate.username || ""),
    candidate.password || ""
  );

  if (!proxyUrl) return null;
  return { proxyId: candidate.id, proxyUrl };
}

export async function markProxySuccess(proxyId: string | null, durationMs?: number) {
  if (!proxyId) return;

  await prisma.proxyPool.update({
    where: { id: proxyId },
    data: {
      lastUsed: new Date(),
      lastError: null,
      cooldownUntil: null,
      successCount: { increment: 1 },
      avgLatencyMs: durationMs ? { set: await nextAverageLatency(proxyId, durationMs) } : undefined,
    },
  }).catch(() => {});

  proxyCache = null;
}

export async function markProxyFailure(proxyId: string | null, params: {
  errorClass?: string;
  errorMessage?: string;
  durationMs?: number;
  blocked?: boolean;
}) {
  if (!proxyId) return;

  const normalizedErrorClass = normalizeParserErrorClass(params.errorClass);
  const isBlocked = params.blocked || isBlockedParserError(normalizedErrorClass);
  const shouldCooldown = shouldCooldownProxyForError(normalizedErrorClass);
  const cooldownUntil = shouldCooldown ? new Date(Date.now() + PROXY_COOLDOWN_MS) : undefined;

  await prisma.proxyPool.update({
    where: { id: proxyId },
    data: {
      lastUsed: new Date(),
      failCount: { increment: 1 },
      blockedCount: isBlocked ? { increment: 1 } : undefined,
      cooldownUntil,
      lastError: params.errorMessage?.slice(0, 1000) || normalizedErrorClass,
      avgLatencyMs: params.durationMs ? { set: await nextAverageLatency(proxyId, params.durationMs) } : undefined,
    },
  }).catch(() => {});

  proxyCache = null;
}

export function maskProxyUrl(proxyUrl: string) {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = `${parsed.username.slice(0, 4)}***`;
    return parsed.toString();
  } catch {
    return "[invalid proxy]";
  }
}

async function getActiveProxyPool() {
  const now = Date.now();
  if (proxyCache && proxyCache.expiresAt > now) return proxyCache.proxies;

  // Self-healing auto-seed if proxy database is empty or depleted
  try {
    const totalCount = await prisma.proxyPool.count();
    if (totalCount < 10) {
      console.log("[Proxy Selector] Proxy pool has depleted or is empty. Checking configured auto-seed URLs...");
      await autoSeedSpanishProxies();
    }
  } catch (err) {
    console.error("[Proxy Selector] Failed to check/auto-seed proxies:", err);
  }

  let proxies = await prisma.proxyPool.findMany({
    where: {
      isActive: true,
      OR: [
        { cooldownUntil: null },
        { cooldownUntil: { lt: new Date() } },
      ],
    },
    orderBy: [
      { failCount: "asc" },
      { avgLatencyMs: "asc" },
      { lastUsed: "asc" },
    ],
    take: 50,
  });

  if (proxies.length === 0) {
    proxies = await prisma.proxyPool.findMany({
      where: { isActive: true },
      orderBy: [
        { failCount: "asc" },
        { blockedCount: "asc" },
        { avgLatencyMs: "asc" },
        { cooldownUntil: "asc" },
        { lastUsed: "asc" },
      ],
      take: 10,
    });
  }

  proxyCache = {
    expiresAt: now + PROXY_POOL_CACHE_TTL_MS,
    proxies: proxies.map((proxy) => ({
      id: proxy.id,
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
      failCount: proxy.failCount,
      blockedCount: proxy.blockedCount,
      avgLatencyMs: proxy.avgLatencyMs,
      lastUsed: proxy.lastUsed,
    })),
  };

  return proxyCache.proxies;
}

async function nextAverageLatency(proxyId: string, durationMs: number) {
  const proxy = await prisma.proxyPool.findUnique({
    where: { id: proxyId },
    select: { avgLatencyMs: true, successCount: true, failCount: true },
  }).catch(() => null);

  if (!proxy?.avgLatencyMs) return Math.round(durationMs);
  const sampleCount = Math.max(1, proxy.successCount + proxy.failCount);
  return Math.round((proxy.avgLatencyMs * Math.min(sampleCount, 20) + durationMs) / (Math.min(sampleCount, 20) + 1));
}

export async function resetProxyCooldowns() {
  await prisma.proxyPool.updateMany({
    where: { isActive: true },
    data: { cooldownUntil: null }
  }).catch(() => {});
  proxyCache = null;
}

function proxyScore(proxy: CachedProxy) {
  // Primary goal: prioritize active, low-latency, and healthy proxies.
  // 1. Fail count penalty: very strong because we want to avoid unstable nodes.
  const failPenalty = proxy.failCount * 50; 
  
  // 2. Blocked count penalty: even stronger (e.g. Cloudflare blocks).
  const blockedPenalty = proxy.blockedCount * 100;
  
  // 3. Latency score:
  // If untested (latency is null), we treat it as average/medium latency (e.g., 1500ms) to give it a chance,
  // but we prefer tested low-latency proxies!
  const latency = proxy.avgLatencyMs !== null ? proxy.avgLatencyMs : 1500;
  const latencyScore = latency / 10; // e.g., 200ms -> 20, 2000ms -> 200.
  
  // 4. Recency penalty (anti-concurrency rotation):
  // We want to avoid using the exact same proxy in the same second, so if it was used less than 15 seconds ago,
  // we add a penalty.
  const lastUsedMs = proxy.lastUsed ? proxy.lastUsed.getTime() : 0;
  const timeSinceLastUsed = Date.now() - lastUsedMs;
  const recencyPenalty = timeSinceLastUsed < 15000 ? (15000 - timeSinceLastUsed) / 100 : 0; // up to 150 penalty points

  return failPenalty + blockedPenalty + latencyScore + recencyPenalty;
}

function rotateProxySession(username: string) {
  if (!username) return username;
  const randomSession = Math.random().toString(36).substring(2, 10);

  // FloppyData/g-w gateway accepts sticky sessions through the extended
  // username. Do not append provider-specific suffixes to generic proxies:
  // many simple username/password proxies treat that as invalid credentials.
  const supportsSessionSuffix =
    username.startsWith("user-")
    || username.includes("-type-")
    || username.includes("-country-");
  if (!supportsSessionSuffix) return username;

  if (username.includes("-session-")) {
    return username.replace(/-session-[a-zA-Z0-9]+/, `-session-${randomSession}`);
  }
  return `${username}-session-${randomSession}`;
}

function buildProxyUrl(protocol: string, host: string, port: number, username: string, password: string) {
  const cleanHost = host.replace(/^(socks5:\/\/|http:\/\/|https:\/\/)/, "");
  const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
  return `${protocol}://${auth}${cleanHost}:${port}`;
}

async function autoSeedSpanishProxies() {
  const seedUrls = getAutoSeedProxyUrls();
  if (seedUrls.length === 0) {
    warnMissingAutoSeedConfigOnce();
    return;
  }

  const data = seedUrls.flatMap((line) => {
    try {
      const u = new URL(line);
      const port = parseInt(u.port, 10);
      if (!u.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("Invalid proxy host or port");
      }
      return [{
        url: u.toString(),
        protocol: u.protocol.replace(":", ""),
        host: u.hostname,
        port,
        username: u.username ? decodeURIComponent(u.username) : null,
        password: u.password ? decodeURIComponent(u.password) : null,
        isActive: true,
      }];
    } catch {
      console.warn("[Proxy Selector] Ignoring invalid PROXY_AUTO_SEED_URLS entry.");
      return [];
    }
  });

  if (data.length === 0) return;

  await prisma.proxyPool.createMany({
    data,
    skipDuplicates: true,
  });
}

let warnedMissingAutoSeedConfig = false;

function warnMissingAutoSeedConfigOnce() {
  if (warnedMissingAutoSeedConfig) return;
  warnedMissingAutoSeedConfig = true;
  console.warn("[Proxy Selector] Proxy pool is empty and PROXY_AUTO_SEED_URLS is not configured.");
}

function getAutoSeedProxyUrls() {
  const raw = process.env.PROXY_AUTO_SEED_URLS || process.env.GW_PROXY_AUTO_SEED_URLS || "";
  return raw
    .split(/[\r\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
