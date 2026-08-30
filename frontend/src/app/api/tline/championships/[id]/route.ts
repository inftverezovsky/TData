import { prisma } from "@backend/db/db";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalBoolean, optionalInteger, optionalText, parseIanaTimezone, parseId, requiredText } from "@backend/tline/api/parsers";
import { parseOfficialSourceUrl, TLineValidationError } from "@backend/tline/api/validation";
import { normalizeAdminExternalId } from "@backend/tline/admin/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const body = objectBody(await readJsonBody(request));
    const sourceUrl = body.sourceUrl === undefined
      ? undefined
      : parseOfficialSourceUrl(requiredText(body, "sourceUrl", 2_048), ["volley.ru"]);
    const sourceTimezone = body.sourceTimezone === undefined
      ? undefined
      : parseIanaTimezone(requiredText(body, "sourceTimezone", 64));
    const championshipId = parseId((await context.params).id);
    const current = await prisma.tLineChampionship.findUniqueOrThrow({ where: { id: championshipId } });
    const globalHeaderText = body.globalHeaderId === undefined ? undefined : optionalText(body, "globalHeaderId", 128);
    const globalHeaderId = globalHeaderText ? parseId(globalHeaderText, "globalHeaderId") : globalHeaderText;
    if (globalHeaderId) await assertHeaderSport(globalHeaderId, current.sportConfigId);
    const adminChampionshipText = body.adminChampionshipId === undefined
      ? undefined
      : optionalText(body, "adminChampionshipId", 128);
    const championship = await prisma.tLineChampionship.update({
      where: { id: championshipId },
      data: defined({
        globalHeaderId,
        name: body.name === undefined ? undefined : requiredText(body, "name", 256),
        season: body.season === undefined ? undefined : optionalText(body, "season", 64),
        sourceUrl,
        sourceChampionshipId: sourceUrl === undefined ? undefined : championshipIdFromVolleyUrl(sourceUrl),
        sourceTimezone,
        adminChampionshipId: adminChampionshipText ? normalizeAdminExternalId(adminChampionshipText) : adminChampionshipText,
        adminChampionshipName: body.adminChampionshipName === undefined ? undefined : optionalText(body, "adminChampionshipName", 256),
        active: optionalBoolean(body, "active"),
        autoEnabled: optionalBoolean(body, "autoEnabled"),
        allowedTimeDriftMinutes: optionalInteger(body, "allowedTimeDriftMinutes", { min: 0, max: 5 }),
        candidateMatchWindowMinutes: optionalInteger(body, "candidateMatchWindowMinutes", { min: 1, max: 10_080 }),
      }),
    });
    return apiOk({ ...championship, sportId: championship.sportConfigId });
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

export async function DELETE(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const championship = await prisma.tLineChampionship.update({
      where: { id: parseId((await context.params).id) },
      data: { active: false, autoEnabled: false, deletedAt: new Date() },
      select: { id: true, active: true, autoEnabled: true, deletedAt: true },
    });
    return apiOk(championship);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

function championshipIdFromVolleyUrl(sourceUrl: string) {
  const id = new URL(sourceUrl).pathname.match(/^\/calendar\/([^/]+)\/allgames\/?$/)?.[1];
  if (!id) throw new TLineValidationError("INVALID_SOURCE_URL", "A volley.ru calendar URL is required.");
  return id;
}

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
