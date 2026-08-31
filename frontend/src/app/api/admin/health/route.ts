import { NextResponse } from "next/server";
import { requireAdmin } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { readLatestParserMonitorReport } from "@backend/monitoring/parserMonitorPersistence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const start = Date.now();
  try {
    // 1. Compute DB Latency
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - start;

    // 2. Query system metrics
    const [
      disciplineCount,
      tournamentCount,
      matchCount,
      totalProxies,
      activeProxiesCount,
      recentLogs
    ] = await Promise.all([
      prisma.discipline.count(),
      prisma.tournament.count(),
      prisma.tournamentMatch.count(),
      prisma.proxyPool.count(),
      prisma.proxyPool.count({ where: { isActive: true } }),
      prisma.parserRequestLog.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          source: true,
          mode: true,
          route: true,
          errorClass: true,
          cacheHit: true,
          createdAt: true
        }
      })
    ]);

    const activeRatio = totalProxies > 0 ? (activeProxiesCount / totalProxies) * 100 : 0;
    const parserMonitor = readLatestParserMonitorReport();

    return NextResponse.json({
      status: "healthy",
      dbLatencyMs,
      metrics: {
        disciplineCount,
        tournamentCount,
        matchCount,
        proxyPool: {
          total: totalProxies,
          active: activeProxiesCount,
          blocked: totalProxies - activeProxiesCount,
          activeRatio: parseFloat(activeRatio.toFixed(1))
        }
      },
      recentLogs,
      parserMonitor
    });
  } catch (error) {
    console.error("[Health Dashboard API] Failure:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Database connection lost"
      },
      { status: 500 }
    );
  }
}
