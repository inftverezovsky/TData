import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

// Force Next.js to not cache this route
export const dynamic = "force-dynamic";

const CONCURRENCY_LIMIT = 5; // Check 5 proxies in parallel at a time
const TEST_TIMEOUT_MS = 6000; // 6 seconds timeout for proxy test
const TEST_URL = "https://httpbin.org/ip"; // Light and fast test target

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_PROXY_CHECK_SECRET;
  if (configuredSecret) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (bearer !== configuredSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    // API remains callable directly; password gate is UI-only for settings visibility.
  }

  try {
    // 1. Fetch all proxies (both active and inactive to see if inactive came back online!)
    const proxies = await prisma.proxyPool.findMany();
    console.log(`[Cron Proxy Checker] Found ${proxies.length} proxies to check.`);
    
    if (proxies.length === 0) {
      return NextResponse.json({ message: "No proxies found in the pool." });
    }

    const results = {
      totalChecked: proxies.length,
      succeeded: 0,
      failed: 0,
      markedInactive: 0,
      details: [] as string[]
    };

    // 2. Process proxies in chunks to avoid overwhelming the server/network
    for (let i = 0; i < proxies.length; i += CONCURRENCY_LIMIT) {
      const chunk = proxies.slice(i, i + CONCURRENCY_LIMIT);
      
      await Promise.all(
        chunk.map(async (proxy) => {
          const startTime = Date.now();
          let agent: HttpsProxyAgent<string> | SocksProxyAgent | null = null;
          
          try {
            // Determine agent type based on protocol
            if (proxy.url.startsWith("socks")) {
              agent = new SocksProxyAgent(proxy.url);
            } else {
              agent = new HttpsProxyAgent(proxy.url);
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

            const res = await fetch(TEST_URL, {
              agent: agent as any, // dynamic agent inject
              signal: controller.signal,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
              }
            } as any).finally(() => clearTimeout(timeoutId));

            if (!res.ok) throw new Error(`HTTP status ${res.status}`);

            const latency = Date.now() - startTime;
            
            // Proxy is healthy!
            await prisma.proxyPool.update({
              where: { id: proxy.id },
              data: {
                isActive: true,
                failCount: 0,
                lastError: null,
                avgLatencyMs: latency,
                successCount: { increment: 1 },
                lastUsed: new Date()
              }
            });

            results.succeeded++;
            results.details.push(`[PASS] ${proxy.host}:${proxy.port} - ${latency}ms`);
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const newFailCount = proxy.failCount + 1;
            const shouldDeactivate = newFailCount >= 3;

            await prisma.proxyPool.update({
              where: { id: proxy.id },
              data: {
                failCount: newFailCount,
                isActive: shouldDeactivate ? false : proxy.isActive, // deactivate only if failed 3 times
                lastError: errorMessage,
                lastUsed: new Date()
              }
            });

            results.failed++;
            if (shouldDeactivate && proxy.isActive) {
              results.markedInactive++;
              results.details.push(`[DEACTIVATED] ${proxy.host}:${proxy.port} after ${newFailCount} failures. Error: ${errorMessage}`);
            } else {
              results.details.push(`[FAIL] ${proxy.host}:${proxy.port} (Fails: ${newFailCount}). Error: ${errorMessage}`);
            }
          }
        })
      );
    }

    return NextResponse.json({
      ok: true,
      summary: `Checked ${results.totalChecked} proxies. Succeeded: ${results.succeeded}, Failed: ${results.failed}, Deactivated: ${results.markedInactive}`,
      details: results.details
    });

  } catch (error) {
    console.error("[Cron Proxy Checker] Fatal error:", error);
    return NextResponse.json({ error: "Fatal proxy checker error" }, { status: 500 });
  }
}
