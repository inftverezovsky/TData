import { prisma } from "@backend/db/db";
import { findTLineRunView } from "@backend/tline/application/runViews";
import { apiError, apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { parseId } from "@backend/tline/api/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Context) {
  const denied = await requireTLineAccess(request);
  if (denied) return denied;
  try {
    const run = await findTLineRunView(prisma, parseId((await context.params).runId, "runId"));
    return run ? apiOk(run) : apiError("RUN_NOT_FOUND", "TLine run was not found.", 404);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
