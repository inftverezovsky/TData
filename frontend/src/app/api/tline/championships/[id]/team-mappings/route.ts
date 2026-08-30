import { prisma } from "@backend/db/db";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalBoolean, optionalText, parseId, requiredText } from "@backend/tline/api/parsers";
import { saveManualTLineTeamMapping } from "@backend/tline/mappings/manualMapping";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = await requireTLineAccess(request);
  if (denied) return denied;
  try {
    const championshipId = parseId((await context.params).id);
    const championship = await prisma.tLineChampionship.findUniqueOrThrow({
      where: { id: championshipId },
      select: { globalHeaderId: true },
    });
    const sourceTeams = await prisma.tLineSourceTeam.findMany({
      where: { championshipId },
      orderBy: { name: "asc" },
      include: {
        mapping: { include: { adminTeam: { select: { id: true, platformId: true, platformName: true } } } },
      },
    });
    const mappedAdminIds = sourceTeams.flatMap((team) => team.mapping ? [team.mapping.adminTeamId] : []);
    const directoryIds = championship.globalHeaderId && mappedAdminIds.length
      ? new Set((await prisma.tLineGlobalHeaderAdminTeam.findMany({
          where: { globalHeaderId: championship.globalHeaderId, adminTeamId: { in: mappedAdminIds } },
          select: { adminTeamId: true },
        })).map((membership) => membership.adminTeamId))
      : new Set<string>();
    return apiOk(sourceTeams.map((team) => {
      const mapping = team.mapping;
      const manuallyUnmapped = mapping?.status === "MANUAL_UNMAPPED";
      return {
        id: mapping?.id || `unmapped:${team.id}`,
        sourceTeamId: team.id,
        sourceTeamExternalId: team.externalId,
        sourceTeamName: team.name,
        adminTeamId: manuallyUnmapped ? null : mapping?.adminTeamId || null,
        adminTeamPlatformId: manuallyUnmapped ? null : mapping?.adminTeam.platformId || null,
        adminTeamName: manuallyUnmapped ? null : mapping?.adminTeam.platformName || null,
        status: mapping?.status || "UNMAPPED",
        matchMethod: mapping?.matchMethod || null,
        locked: mapping?.isLocked || false,
        confidence: mapping?.confidenceScore ?? null,
        inDirectory: manuallyUnmapped ? false : Boolean(mapping && directoryIds.has(mapping.adminTeamId)),
      };
    }));
  } catch (error) {
    return tlineErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const championshipId = parseId((await context.params).id);
    const body = objectBody(await readJsonBody(request));
    const result = await saveManualTLineTeamMapping(prisma, {
      championshipId,
      sourceTeamId: parseId(requiredText(body, "sourceTeamId", 128)),
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
