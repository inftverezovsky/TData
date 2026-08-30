import { buildAdminTeamSuggestions } from "@backend/adminTeams/suggest";
import { prisma } from "@backend/db/db";
import { apiOk, requireTLineAccess, tlineErrorResponse } from "@backend/tline/api/http";
import { parseId } from "@backend/tline/api/parsers";
import { TLineValidationError } from "@backend/tline/api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = await requireTLineAccess(request);
  if (denied) return denied;
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (query.length > 100) {
      throw new TLineValidationError("INVALID_QUERY", "Search query must not exceed 100 characters.");
    }
    if (query.length < 2) return apiOk({ items: [], minQueryLength: 2 });

    const championship = await prisma.tLineChampionship.findUniqueOrThrow({
      where: { id: parseId((await context.params).id) },
      select: { globalHeader: { select: { id: true, active: true } } },
    });
    if (!championship.globalHeader?.active) {
      return apiOk({ items: [], minQueryLength: 2, directoryConfigured: false });
    }
    const memberships = await prisma.tLineGlobalHeaderAdminTeam.findMany({
      where: { globalHeaderId: championship.globalHeader.id },
      include: {
        adminTeam: {
          select: {
            id: true,
            platformId: true,
            platformName: true,
            platformNameRu: true,
            platformNameEn: true,
            normalizedName: true,
            normalizedNameRu: true,
            normalizedNameEn: true,
          },
        },
      },
      orderBy: { adminTeam: { platformName: "asc" } },
    });
    const teams = memberships.map((membership) => membership.adminTeam);
    const byPlatformId = new Map(teams.map((team) => [team.platformId, team]));
    const items = buildAdminTeamSuggestions(teams, query, 8).flatMap((suggestion) => {
      const team = byPlatformId.get(suggestion.platformId);
      return team ? [{
        id: team.id,
        platformId: team.platformId,
        name: team.platformNameRu || team.platformNameEn || team.platformName,
        score: suggestion.score,
        inDirectory: true,
      }] : [];
    });
    return apiOk({ items, minQueryLength: 2, directoryConfigured: true });
  } catch (error) {
    return tlineErrorResponse(error);
  }
}
