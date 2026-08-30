import { normalizeFuzzyName } from "@backend/teams/fuzzyMatch";
import { prisma } from "@backend/db/db";
import { apiError, apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { parseId } from "@backend/tline/api/parsers";
import { buildTLineSourceTeamSyncPeriod } from "@backend/tline/pilot/period";
import { createDefaultOfficialSourceRegistry } from "@backend/tline/sources/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const denied = await requireTLineAccess(request, true);
  if (denied) return denied;
  try {
    const championship = await prisma.tLineChampionship.findUniqueOrThrow({
      where: { id: parseId((await context.params).id) },
    });
    const adapter = createDefaultOfficialSourceRegistry().get(championship.sourceProvider);
    const now = new Date();
    const period = buildTLineSourceTeamSyncPeriod(now, championship.sourceTimezone, championship.season);
    const snapshot = await adapter.fetchChampionship({
      championship: {
        id: championship.id,
        externalId: championship.sourceChampionshipId || championship.id,
        name: championship.name,
        sourceUrl: championship.sourceUrl,
        sourceTimezone: championship.sourceTimezone,
      },
      from: period.from,
      to: period.to,
      forceFresh: true,
      includeUndatedSourceMatches: true,
    });
    const teams = await prisma.$transaction(snapshot.teams.map((team) => prisma.tLineSourceTeam.upsert({
      where: {
        championshipId_externalId: {
          championshipId: championship.id,
          externalId: team.externalId || team.id,
        },
      },
      update: {
        name: team.nameRu || team.nameEn || team.id,
        normalizedName: normalizeFuzzyName(team.nameRu || team.nameEn || team.id),
        lastSeenAt: now,
      },
      create: {
        championshipId: championship.id,
        externalId: team.externalId || team.id,
        name: team.nameRu || team.nameEn || team.id,
        normalizedName: normalizeFuzzyName(team.nameRu || team.nameEn || team.id),
        firstSeenAt: now,
        lastSeenAt: now,
      },
    })));
    return apiOk({ synced: teams.length });
  } catch (error) {
    const known = tlineErrorResponse(error);
    if (known.status !== 500) return known;
    return apiError("SOURCE_UNAVAILABLE", "The official source could not be synchronized.", 502);
  }
}
