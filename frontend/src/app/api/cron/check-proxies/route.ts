import { NextResponse } from "next/server";
import { requireAdmin, requireSameOriginRequest } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { probeProxyConnection, ProxyProbeError } from "@backend/proxy/healthProbe";
import { apiErrorResponse, logApiError, safeErrorMessage } from "@backend/http/apiResponse";

// Force Next.js to not cache this route
export const dynamic = "force-dynamic";

const CONCURRENCY_LIMIT = 5; // Check 5 proxies in parallel at a time

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_PROXY_CHECK_SECRET;
  if (configuredSecret) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (bearer !== configuredSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;
    const forbidden = requireSameOriginRequest(request);
    if (forbidden) return forbidden;
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
          try {
            // Реальный CONNECT/SOCKS transport; direct fallback не допускается.
            const { latencyMs: latency } = await probeProxyConnection(proxy.url);
            
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
            const errorMessage = err instanceof ProxyProbeError ? err.message : safeErrorMessage(err, "Proxy check failed.");
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
    logApiError("[Cron Proxy Checker] Fatal error", error);
    return apiErrorResponse(error, "Fatal proxy checker error");
  }
}
