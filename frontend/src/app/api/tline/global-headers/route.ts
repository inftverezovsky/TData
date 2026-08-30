import { prisma } from "@backend/db/db";
import { normalizeAdminExternalId } from "@backend/tline/admin/directory";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalText, parseId, requiredText } from "@backend/tline/api/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await requireTLineAccess(request);
  if (denied) return denied;
  const sportId = new URL(request.url).searchParams.get("sportId") || undefined;
  const headers = await prisma.tLineGlobalHeader.findMany({
    where: sportId ? { sportConfigId: sportId } : undefined,
    include: {
      sportConfig: { include: { discipline: { select: { name: true, slug: true } } } },
      championships: {
        where: { deletedAt: null },
        select: { id: true, name: true, active: true },
        orderBy: { name: "asc" },
      },
      _count: { select: { adminTeams: true } },
    },
    orderBy: [{ sportConfigId: "asc" }, { name: "asc" }, { adminShapkaId: "asc" }],
  });
  return apiOk(headers.map((header) => ({
    id: header.id,
    sportId: header.sportConfigId,
    sportName: header.sportConfig.discipline.name,
    sportSlug: header.sportConfig.discipline.slug,
    adminShapkaId: header.adminShapkaId,
    name: header.name,
    active: header.active,
    championships: header.championships,
    teamCount: header._count.adminTeams,
  })));
}

export async function POST(request: Request) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const body = objectBody(await readJsonBody(request));
    const header = await prisma.tLineGlobalHeader.create({
      data: {
        sportConfigId: parseId(requiredText(body, "sportId", 128), "sportId"),
        adminShapkaId: normalizeAdminExternalId(requiredText(body, "adminShapkaId", 128)),
        name: optionalText(body, "name", 256),
      },
    });
    return apiOk(header, 201);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
