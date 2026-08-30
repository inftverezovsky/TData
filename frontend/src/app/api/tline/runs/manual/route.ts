import { prisma } from "@backend/db/db";
import { PrismaTLineRunStore } from "@backend/tline/application/prismaRunStore";
import { requestManualTLineRun } from "@backend/tline/application/runs";
import { findTLineRunView } from "@backend/tline/application/runViews";
import { parseManualRunRequest } from "@backend/tline/api/contracts";
import { apiError, apiOk, isTLineEnabled, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  if (!isTLineEnabled()) {
    return apiError("TLINE_DISABLED", "TLine execution is disabled by the deployment feature flag.", 503);
  }
  try {
    const input = parseManualRunRequest(await readJsonBody(request));
    const requested = await requestManualTLineRun(new PrismaTLineRunStore(prisma), input);
    const run = await findTLineRunView(prisma, requested.run.id);
    return apiOk({ run, deduplicated: requested.deduplicated }, requested.deduplicated ? 200 : 202);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
