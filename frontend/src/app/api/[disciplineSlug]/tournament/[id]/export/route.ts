import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { buildFixtPayload } from "@backend/adminUpload/buildFixtPayload";
import { toAdminFixtPayloadEnvelope } from "@backend/adminUpload/fixtPayloadFormat";
import { readShapkaOverridesSearchParam } from "@backend/adminUpload/shapkaOverrides";
import { matchesToCsv, participantsToCsv, tournamentToMarkdown } from "@backend/exporters/tournament";
import { dedupeTournamentMatches } from "@backend/matches/dedupe";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  try {
    const { disciplineSlug, id } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") ?? "json";
    const type = searchParams.get("type") ?? "matches";
    const idsParam = searchParams.get("ids");
    const selectedIds = idsParam ? idsParam.split(",") : undefined;
    const shapkaIdBySelectionId = readShapkaOverridesSearchParam(searchParams);

    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        participants: { orderBy: { createdAt: "asc" } },
        matches: {
          where: selectedIds ? { matchId: { in: selectedIds } } : undefined,
          orderBy: [{ matchDate: "asc" }, { createdAt: "asc" }]
        }
      }
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    const dedupedTournament = {
      ...tournament,
      matches: dedupeTournamentMatches(tournament.matches),
    };

    // Admin-ready format (JSON/PHP)
    if (format === "json" || format === "php") {
      const buildResult = await buildFixtPayload(id, disciplineSlug, selectedIds, shapkaIdBySelectionId);
      const adminPayload = buildResult.payload ? toAdminFixtPayloadEnvelope(buildResult.payload) : null;

      if (format === "json") {
        return NextResponse.json(adminPayload || {
          error: "Payload not ready",
          warnings: buildResult.warnings,
          skipped: buildResult.skippedMatches.length
        });
      }

      const { toPhpString } = await import("@backend/adminUpload/utils");
      const phpString = adminPayload ? toPhpString(adminPayload) : "Error: Data not ready\n\n" + buildResult.warnings.join("\n");
      return new Response(phpString, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // Legacy/Detailed formats
    if (format === "csv") {
      const csv = type === "participants"
        ? participantsToCsv(dedupedTournament as any)
        : matchesToCsv(dedupedTournament as any, disciplineSlug);

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}-${type}.csv"`
        }
      });
    }

    if (format === "markdown" || format === "md") {
      const markdown = tournamentToMarkdown(dedupedTournament as any, disciplineSlug);
      return new Response(markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.md"`
        }
      });
    }

    return NextResponse.json({ error: "Format not supported" }, { status: 400 });
  } catch (error) {
    logApiError("api:[disciplineSlug]/tournament/[id]/export/route.ts", error);
    return apiErrorResponse(error);
  }
}
