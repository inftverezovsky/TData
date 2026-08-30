import { prisma } from "@backend/db/db";
import { getAdminLineConfiguration } from "@backend/tline/admin/configuration";
import { apiError, apiOk, isTLineEnabled, requireTLineAccess } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await requireTLineAccess(request);
  if (denied) return denied;
  try {
    const [sports, queuedJobs, schedule] = await Promise.all([
      prisma.tLineSportConfig.count({ where: { active: true } }),
      prisma.tLineJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
      prisma.tLineScheduleState.findUnique({ where: { id: "global" }, select: { enabled: true } }),
    ]);
    const admin = getAdminLineConfiguration();
    return apiOk({
      healthy: true,
      enabled: isTLineEnabled(),
      schedulerEnabled: schedule?.enabled ?? false,
      adminConfigured: admin.configured,
      activeSports: sports,
      activeJobs: queuedJobs,
    });
  } catch {
    return apiError("TLINE_DATABASE_UNAVAILABLE", "TLine database health check failed.", 503);
  }
}
