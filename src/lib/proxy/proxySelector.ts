import { prisma } from "@/lib/db/db";
import { isBlockedParserError, normalizeParserErrorClass, shouldCooldownProxyForError } from "@/lib/proxy/parserErrors";

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
      console.log("[Proxy Selector] Proxy pool has depleted or is empty. Auto-seeding 50 residential Spanish proxies...");
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
  const proxiesList = [
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-jrbyd8po-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-yjypfj5p-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-oq783r0o-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-c8jk7jw2-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-z7t4z19t-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-sprn5myu-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-on5z73h6-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-3zc8wrff-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-8h54s4up-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-0kcq1jkd-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-c2uk1njk-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-qum5nncj-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-x25979nz-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-4yvnwbhq-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-rxz77eym-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-6b14rene-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-qgv8kj7u-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-gea4wjnd-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-5ydubvv1-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-w044yhod-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-68gdhm3o-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-uex0ojfd-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-dweypk86-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-c2d4r6b1-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-71ouq3hs-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-e7ad5rac-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-egs01op9-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-gftx583q-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-5wlgl241-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-yls2jo92-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-s10w6n41-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-mqzyjnux-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-n7povuub-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-9pmyoo7z-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-31fjoswd-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-ijacfqhi-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-d9x24she-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-qbt91zpq-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-btqbmjki-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-v2gp9qx4-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-itf9iv9v-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-9pvepw7i-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-2mlpzho7-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-ue4hmg6q-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-igzz74dk-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-crdhb9vm-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-t528l19d-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-bn5wg315-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-4opmqwh6-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080",
    "http://user-8j4eVPxWX4ouug9d-type-residential-session-w8vzu3h8-country-es-rotation-5:TcUvtlQJpZxFpxxz@geo.g-w.info:10080"
  ];

  const data = proxiesList.map(line => {
    const u = new URL(line);
    return {
      url: line,
      protocol: u.protocol.replace(':', ''),
      host: u.hostname,
      port: parseInt(u.port),
      username: u.username,
      password: u.password,
      isActive: true
    };
  });

  await prisma.proxyPool.createMany({
    data,
    skipDuplicates: true
  });
}
