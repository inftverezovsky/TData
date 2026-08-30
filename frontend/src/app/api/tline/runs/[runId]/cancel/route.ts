import { prisma } from "@backend/db/db";
import { findTLineRunView } from "@backend/tline/application/runViews";
import { apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { parseId } from "@backend/tline/api/parsers";
import { buildCancelJobQuery } from "@backend/tline/jobs/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const runId = parseId((await context.params).runId, "runId");
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const run = await transaction.tLineRun.findUniqueOrThrow({
        where: { id: runId },
        select: { status: true, job: { select: { id: true } } },
      });
      if (run.status !== "QUEUED" && run.status !== "RUNNING") return;
      await transaction.tLineRun.update({
        where: { id: runId },
        data: run.status === "QUEUED"
          ? { status: "CANCELLED", cancelRequestedAt: now, completedAt: now }
          : { cancelRequestedAt: now },
      });
      if (run.status === "QUEUED") {
        await transaction.tLineRunChampionship.updateMany({
          where: { runId, status: "QUEUED" },
          data: {
            status: "CANCELLED",
            automaticStatus: "CANCELLED",
            effectiveStatus: "CANCELLED",
            completedAt: now,
          },
        });
      }
      if (run.job) {
        await transaction.$queryRaw(buildCancelJobQuery({ jobId: run.job.id, now }));
      }
    });
    return apiOk(await findTLineRunView(prisma, runId));
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
