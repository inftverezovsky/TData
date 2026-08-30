import { prisma } from "@backend/db/db";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalBoolean, optionalText, parseId, requiredText } from "@backend/tline/api/parsers";
import {
  clearManualTLineTeamMapping,
  saveManualTLineTeamMapping,
  unlockTLineTeamMapping,
} from "@backend/tline/mappings/manualMapping";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const id = parseId((await context.params).id);
    const body = objectBody(await readJsonBody(request));
    if (body.locked === false && body.platformId === undefined) {
      return apiOk(await unlockTLineTeamMapping(prisma, id));
    }
    const current = await prisma.tLineTeamMapping.findUniqueOrThrow({
      where: { id },
      select: { championshipId: true, sourceTeamId: true },
    });
    const result = await saveManualTLineTeamMapping(prisma, {
      championshipId: current.championshipId,
      sourceTeamId: current.sourceTeamId,
      platformId: requiredText(body, "platformId", 128),
      adminName: optionalText(body, "adminName", 256),
      locked: optionalBoolean(body, "locked") ?? true,
    });
    return apiOk({
      ...result.mapping,
      adminTeamPlatformId: result.adminTeam.platformId,
      adminTeamName: result.adminTeam.platformName,
      inDirectory: result.inDirectory,
      locked: result.mapping.isLocked,
    });
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const mapping = await clearManualTLineTeamMapping(prisma, parseId((await context.params).id));
    return apiOk({ ...mapping, adminTeamId: null, status: "MANUAL_UNMAPPED", locked: true });
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
