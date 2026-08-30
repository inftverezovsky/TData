import { prisma } from "@backend/db/db";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalBoolean, optionalInteger, optionalText, parseId, requiredText } from "@backend/tline/api/parsers";
import { normalizeAdminExternalId } from "@backend/tline/admin/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    const body = objectBody(await readJsonBody(request));
    const name = body.name === undefined ? undefined : requiredText(body, "name", 128);
    const active = optionalBoolean(body, "active");
    const autoEnabled = optionalBoolean(body, "autoEnabled");
    const adminSportText = body.adminSportId === undefined ? undefined : optionalText(body, "adminSportId", 128);
    const adminSportId = adminSportText ? normalizeAdminExternalId(adminSportText) : adminSportText;
    const offsets = {
      autoPeriodFromOffsetMinutes: optionalInteger(body, "autoPeriodFromOffsetMinutes", { min: -525_600, max: 525_600 }),
      autoPeriodToOffsetMinutes: optionalInteger(body, "autoPeriodToOffsetMinutes", { min: -525_600, max: 525_600 }),
      candidateMatchWindowMinutes: optionalInteger(body, "candidateMatchWindowMinutes", { min: 1, max: 10_080 }),
      defaultAllowedTimeDriftMinutes: optionalInteger(body, "defaultAllowedTimeDriftMinutes", { min: 0, max: 5 }),
    };
    const sport = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.tLineSportConfig.update({
        where: { id },
        data: {
          ...(active === undefined ? {} : { active }),
          ...(autoEnabled === undefined ? {} : { autoEnabled }),
          ...(adminSportId === undefined ? {} : { adminSportId }),
          ...defined(offsets),
        },
      });
      if (name !== undefined) {
        await transaction.discipline.update({ where: { id: updated.disciplineId }, data: { name } });
      }
      return transaction.tLineSportConfig.findUniqueOrThrow({
        where: { id },
        include: { discipline: { select: { slug: true, name: true } } },
      });
    });
    return apiOk({ ...sport, slug: sport.discipline.slug, name: sport.discipline.name });
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const sport = await prisma.tLineSportConfig.update({
      where: { id: parseId(rawId) },
      data: { active: false, autoEnabled: false },
      select: { id: true, active: true, autoEnabled: true },
    });
    return apiOk(sport);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
