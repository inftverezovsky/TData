import { prisma } from "@backend/db/db";
import { apiError, apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { parseId } from "@backend/tline/api/parsers";
import { createOfficialSourceRegistry } from "@backend/tline/sources/registry";
import { createVolleyRuAdapter } from "@backend/tline/sources/volleyRu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  const startedAt = Date.now();
  let championshipId: string | null = null;
  try {
    championshipId = parseId((await context.params).id);
    const championship = await prisma.tLineChampionship.findUniqueOrThrow({
      where: { id: championshipId },
    });
    const adapter = createOfficialSourceRegistry([createVolleyRuAdapter()]).get(championship.sourceProvider);
    const result = await adapter.testConnection({
      id: championship.id,
      externalId: championship.sourceChampionshipId || championship.id,
      name: championship.name,
      sourceUrl: championship.sourceUrl,
      sourceTimezone: championship.sourceTimezone,
    });
    await writeLog(championshipId, startedAt, 200, result.matchCount);
    return apiOk(result);
  } catch (error) {
    if (championshipId) await writeLog(championshipId, startedAt, null, null, error);
    const known = tlineErrorResponse(error);
    if (known.status !== 500) return known;
    return apiError("SOURCE_UNAVAILABLE", "The official source could not be read with fresh data.", 502);
  }
}

async function writeLog(
  championshipId: string,
  startedAt: number,
  statusCode: number | null,
  matchesCount: number | null,
  error?: unknown,
) {
  await prisma.parserRequestLog.create({
    data: {
      source: "tline-official",
      mode: "fresh",
      route: "connection-test",
      tlineChampionshipId: championshipId,
      durationMs: Date.now() - startedAt,
      statusCode,
      matchesCount,
      errorClass: error instanceof Error ? error.name.slice(0, 128) : error ? "UnknownError" : null,
    },
  }).catch(() => undefined);
}
