import { prisma } from "@backend/db/db";
import { resolveTeamMapping } from "@backend/tline/mappings/teamMapping";
import { apiOk, readJsonBody, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { objectBody, optionalText, parseId } from "@backend/tline/api/parsers";
import { TLineValidationError } from "@backend/tline/api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const championshipId = parseId((await context.params).id);
    const body = request.body ? objectBody(await readJsonBody(request)) : {};
    const sourceTeamText = optionalText(body, "sourceTeamId", 128);
    const sourceTeamId = sourceTeamText ? parseId(sourceTeamText, "sourceTeamId") : null;
    const championship = await prisma.tLineChampionship.findUniqueOrThrow({
      where: { id: championshipId },
      select: {
        globalHeader: { select: { id: true, active: true } },
        sourceTeams: { include: { mapping: true } },
      },
    });
    if (!championship.globalHeader?.active) {
      throw new TLineValidationError("GLOBAL_HEADER_REQUIRED", "Assign an active Global Header/Shapka before automapping.");
    }
    const memberships = championship.globalHeader
      ? await prisma.tLineGlobalHeaderAdminTeam.findMany({
          where: { globalHeaderId: championship.globalHeader.id },
          include: { adminTeam: true },
        })
      : [];
    const adminTeams = memberships.map((membership) => membership.adminTeam);
    const candidates = adminTeams.map((team) => ({
      id: team.id,
      platformId: team.platformId,
      nameRu: team.platformNameRu || team.platformName,
      nameEn: team.platformNameEn,
      aliases: [] as string[],
    }));
    const existingMappings = championship.sourceTeams.flatMap((team) => team.mapping ? [{
      championshipId,
      sourceTeamId: team.id,
      adminTeamId: team.mapping.adminTeamId,
      locked: team.mapping.isLocked,
      status: team.mapping.status,
    }] : []);
    const selectedTeams = sourceTeamId
      ? championship.sourceTeams.filter((team) => team.id === sourceTeamId)
      : championship.sourceTeams;
    if (sourceTeamId && selectedTeams.length === 0) {
      throw new TLineValidationError("SOURCE_TEAM_NOT_FOUND", "The source team does not belong to this championship.");
    }
    const results = selectedTeams.map((team) => ({
      team,
      resolution: resolveTeamMapping({
        sourceTeam: {
          id: team.id,
          championshipId,
          externalId: team.externalId,
          nameRu: team.name,
          nameEn: null,
          aliases: [],
        },
        adminTeams: candidates,
        existingMappings,
      }),
    }));
    const mapped = results.filter((item) => item.resolution.kind === "mapped");
    const writable = mapped.filter((item) => !item.team.mapping?.isLocked);
    await prisma.$transaction(writable.map(({ team, resolution }) => {
      if (resolution.kind !== "mapped") throw new Error("Unreachable mapping state");
      return prisma.tLineTeamMapping.upsert({
        where: { sourceTeamId: team.id },
        update: {
          championshipId,
          adminTeamId: resolution.adminTeamId,
          status: "AUTO_MAPPED",
          confidenceScore: resolution.score,
          matchMethod: resolution.method,
        },
        create: {
          championshipId,
          sourceTeamId: team.id,
          adminTeamId: resolution.adminTeamId,
          status: "AUTO_MAPPED",
          confidenceScore: resolution.score,
          matchMethod: resolution.method,
          isLocked: false,
        },
      });
    }));
    return apiOk({
      total: results.length,
      mapped: mapped.length,
      updated: writable.length,
      ambiguous: results.filter((item) => item.resolution.kind === "ambiguous").length,
      unmapped: results.filter((item) => item.resolution.kind === "unmapped").length,
    });
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
