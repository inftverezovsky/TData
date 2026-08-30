import { prisma } from "@backend/db/db";
import { listTLineRunHistory } from "@backend/tline/application/runViews";
import { apiOk, requireTLineAccess } from "@backend/tline/api/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await requireTLineAccess(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const rawLimit = Number(params.get("limit") || "25");
  const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;
  const result = await listTLineRunHistory(prisma, {
    sportId: params.get("sportId") || undefined,
    cursor: params.get("cursor") || undefined,
    limit,
  });
  return apiOk(result.items, 200, { nextCursor: result.nextCursor });
}
