import { logApiError } from "@backend/http/apiResponse";
import { prisma } from "@backend/db/db";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalInteger, optionalText, parseIanaTimezone, parseId, requiredText } from "@backend/tline/api/parsers";
import { parseOfficialSourceUrl, TLineValidationError } from "@backend/tline/api/validation";
import { VOLLEY_RU_PROVIDER } from "@backend/tline/sources/volleyRu";
import { normalizeAdminExternalId } from "@backend/tline/admin/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const denied = await requireTLineAccess(request);
    if (denied) return denied;
    const sportId = new URL(request.url).searchParams.get("sportId") || undefined;
    const championships = await prisma.tLineChampionship.findMany({
      where: { deletedAt: null, ...(sportId ? { sportConfigId: sportId } : {}) },
      orderBy: [{ sportConfigId: "asc" }, { name: "asc" }],
      include: { globalHeader: { select: { id: true, adminShapkaId: true, name: true, active: true } } },
    });
    return apiOk(championships.map((championship) => ({
      id: championship.id,
      sportId: championship.sportConfigId,
      name: championship.name,
      season: championship.season,
      sourceProvider: championship.sourceProvider,
      sourceUrl: championship.sourceUrl,
      sourceTimezone: championship.sourceTimezone,
      globalHeaderId: championship.globalHeaderId,
      globalHeader: championship.globalHeader,
      adminChampionshipId: championship.adminChampionshipId,
      adminChampionshipName: championship.adminChampionshipName,
      active: championship.active,
      autoEnabled: championship.autoEnabled,
      allowedTimeDriftMinutes: championship.allowedTimeDriftMinutes,
      candidateMatchWindowMinutes: championship.candidateMatchWindowMinutes,
    })));
  } catch (error) {
    logApiError("api:tline/championships/route.ts", error);
    return tlineErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const body = objectBody(await readJsonBody(request));
    const sourceUrl = parseOfficialSourceUrl(requiredText(body, "sourceUrl", 2_048), ["volley.ru"]);
    const sourceTimezone = parseIanaTimezone(optionalText(body, "sourceTimezone", 64) || "Europe/Moscow");
    const sourceChampionshipId = championshipIdFromVolleyUrl(sourceUrl);
    const sportConfigId = parseId(requiredText(body, "sportId", 128), "sportId");
    const globalHeaderText = optionalText(body, "globalHeaderId", 128);
    const globalHeaderId = globalHeaderText ? parseId(globalHeaderText, "globalHeaderId") : null;
    if (globalHeaderId) await assertHeaderSport(globalHeaderId, sportConfigId);
    const adminChampionshipText = optionalText(body, "adminChampionshipId", 128);
    const championship = await prisma.tLineChampionship.create({
      data: {
        sportConfigId,
        globalHeaderId,
        name: requiredText(body, "name", 256),
        season: optionalText(body, "season", 64),
        sourceProvider: VOLLEY_RU_PROVIDER,
        sourceUrl,
        sourceChampionshipId,
        sourceTimezone,
        adminChampionshipId: adminChampionshipText ? normalizeAdminExternalId(adminChampionshipText) : null,
        adminChampionshipName: optionalText(body, "adminChampionshipName", 256),
        allowedTimeDriftMinutes: optionalInteger(body, "allowedTimeDriftMinutes", { min: 0, max: 5 }),
        candidateMatchWindowMinutes: optionalInteger(body, "candidateMatchWindowMinutes", { min: 1, max: 10_080 }),
      },
    });
    return apiOk({ ...championship, sportId: championship.sportConfigId }, 201);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

async function assertHeaderSport(globalHeaderId: string, sportConfigId: string) {
  const header = await prisma.tLineGlobalHeader.findUnique({ where: { id: globalHeaderId } });
  if (!header || header.sportConfigId !== sportConfigId) {
    throw new TLineValidationError("CROSS_SPORT_GLOBAL_HEADER", "Global Header/Shapka must belong to the championship sport.");
  }
}

function championshipIdFromVolleyUrl(sourceUrl: string) {
  const id = new URL(sourceUrl).pathname.match(/^\/calendar\/([^/]+)\/allgames\/?$/)?.[1];
  if (!id) throw new TLineValidationError("INVALID_SOURCE_URL", "A volley.ru calendar URL is required.");
  return id;
}
