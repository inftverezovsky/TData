import { prisma } from "@backend/db/db";
import { normalizeAdminExternalId } from "@backend/tline/admin/directory";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalBoolean, optionalText, parseId, requiredText } from "@backend/tline/api/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const body = objectBody(await readJsonBody(request));
    const rawShapkaId = body.adminShapkaId === undefined ? undefined : requiredText(body, "adminShapkaId", 128);
    const header = await prisma.tLineGlobalHeader.update({
      where: { id: parseId((await context.params).id) },
      data: {
        ...(rawShapkaId === undefined ? {} : { adminShapkaId: normalizeAdminExternalId(rawShapkaId) }),
        ...(body.name === undefined ? {} : { name: optionalText(body, "name", 256) }),
        ...(body.active === undefined ? {} : { active: optionalBoolean(body, "active") }),
      },
    });
    return apiOk(header);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const id = parseId((await context.params).id);
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.tLineChampionship.updateMany({
        where: { globalHeaderId: id },
        data: { autoEnabled: false },
      });
      return transaction.tLineGlobalHeader.update({ where: { id }, data: { active: false } });
    });
    return apiOk(result);
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
