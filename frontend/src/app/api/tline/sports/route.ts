import { logApiError } from "@backend/http/apiResponse";
import { prisma } from "@backend/db/db";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalText, parseSlug, requiredText } from "@backend/tline/api/parsers";
import { normalizeAdminExternalId } from "@backend/tline/admin/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const denied = await requireTLineAccess(request);
    if (denied) return denied;
    const sports = await prisma.tLineSportConfig.findMany({
      orderBy: { discipline: { name: "asc" } },
      include: { discipline: { select: { slug: true, name: true } } },
    });
    return apiOk(sports.map((sport) => ({
      id: sport.id,
      slug: sport.discipline.slug,
      name: sport.discipline.name,
      adminSportId: sport.adminSportId,
      active: sport.active,
      autoEnabled: sport.autoEnabled,
      autoPeriodFromOffsetMinutes: sport.autoPeriodFromOffsetMinutes,
      autoPeriodToOffsetMinutes: sport.autoPeriodToOffsetMinutes,
      candidateMatchWindowMinutes: sport.candidateMatchWindowMinutes,
      defaultAllowedTimeDriftMinutes: sport.defaultAllowedTimeDriftMinutes,
    })));
  } catch (error) {
    logApiError("api:tline/sports/route.ts", error);
    return tlineErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const body = objectBody(await readJsonBody(request));
    const name = requiredText(body, "name", 128);
    const slug = parseSlug(requiredText(body, "slug", 64));
    const rawAdminSportId = optionalText(body, "adminSportId", 128);
    const adminSportId = rawAdminSportId ? normalizeAdminExternalId(rawAdminSportId) : null;
    const sport = await prisma.$transaction(async (transaction) => {
      const discipline = await transaction.discipline.upsert({
        where: { slug },
        update: { name, isEnabled: true },
        create: { slug, name, isEnabled: true },
      });
      return transaction.tLineSportConfig.create({
        data: { disciplineId: discipline.id, adminSportId },
        include: { discipline: { select: { slug: true, name: true } } },
      });
    });
    return apiOk({
      id: sport.id,
      slug: sport.discipline.slug,
      name: sport.discipline.name,
      active: sport.active,
      autoEnabled: sport.autoEnabled,
    }, 201);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
