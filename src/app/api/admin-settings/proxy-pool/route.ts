import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { requireAdmin } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const proxies = await prisma.proxyPool.findMany({
    orderBy: { createdAt: 'desc' }
  });
  return NextResponse.json({
    proxies: proxies.map((proxy) => ({
      id: proxy.id,
      url: maskProxyUrl(proxy.url),
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username ? maskValue(proxy.username) : null,
      isActive: proxy.isActive,
      failCount: proxy.failCount,
      successCount: proxy.successCount,
      blockedCount: proxy.blockedCount,
      cooldownUntil: proxy.cooldownUntil,
      avgLatencyMs: proxy.avgLatencyMs,
      lastError: proxy.lastError,
      lastUsed: proxy.lastUsed,
      createdAt: proxy.createdAt,
    }))
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const { urls } = await request.json(); // Array of strings or one multi-line string
    
    if (!urls) return NextResponse.json({ error: "URLs are required" }, { status: 400 });

    const rawUrls = typeof urls === 'string' 
      ? urls.split('\n').map(u => u.trim()).filter(Boolean)
      : Array.isArray(urls) ? urls : [];

    const newProxies = [];
    for (const rawUrl of rawUrls) {
      try {
        const normalized = normalizeProxyUrl(rawUrl);
        const url = new URL(normalized);
        newProxies.push({
          url: normalized,
          protocol: url.protocol.replace(':', ''),
          host: url.hostname,
          port: parseInt(url.port) || 80,
          username: url.username || null,
          password: url.password || null,
          cooldownUntil: null,
          lastError: null,
        });
      } catch (e) {
        console.error(`Invalid proxy URL: ${rawUrl}`);
      }
    }

    if (newProxies.length === 0) {
      return NextResponse.json({ error: "No valid URLs found" }, { status: 400 });
    }

    // Use createMany to insert everything at once
    await prisma.proxyPool.createMany({
      data: newProxies,
      skipDuplicates: true,
    });

    return NextResponse.json({ ok: true, count: newProxies.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const all = searchParams.get("all") === "true";

  if (all) {
    await prisma.proxyPool.deleteMany();
    return NextResponse.json({ ok: true });
  }

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  await prisma.proxyPool.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function maskProxyUrl(rawUrl: string) {
  try {
    const url = new URL(normalizeProxyUrl(rawUrl));
    if (url.username) url.username = maskValue(url.username);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "[invalid proxy]";
  }
}

function maskValue(value: string) {
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function normalizeProxyUrl(rawUrl: string) {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)
    ? rawUrl
    : `http://${rawUrl}`;
  const url = new URL(withProtocol);

  if (isGWGateway(url.hostname)) {
    // The provider UI labels this as HTTP proxy. The working gateway endpoint
    // is HTTP CONNECT on 10080; https://geo.g-w.info:10443 causes browser timeouts.
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
