import { buildFixtPayload } from "@backend/adminUpload/buildFixtPayload";
import { toAdminFixtPayloadEnvelope } from "@backend/adminUpload/fixtPayloadFormat";
import { readShapkaOverridesSearchParam } from "@backend/adminUpload/shapkaOverrides";
import { prisma } from "@backend/db/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> }
) {
  const { disciplineSlug, id } = await params;
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  const selectedIds = idsParam ? idsParam.split(",") : undefined;
  const shapkaIdBySelectionId = readShapkaOverridesSearchParam(searchParams);

  const tournament = await prisma.tournament.findUnique({
    where: { id },
  });

  if (!tournament) {
    return Response.json(
      { error: "Tournament not found" },
      {
        status: 404,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }

  const buildResult = await buildFixtPayload(id, disciplineSlug, selectedIds, shapkaIdBySelectionId);
  
  if (!buildResult.payload) {
    return Response.json({
      error: "Данные не готовы",
      warnings: buildResult.warnings,
      skippedMatches: buildResult.skippedMatches,
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  const jsonString = JSON.stringify(toAdminFixtPayloadEnvelope(buildResult.payload), null, 2);

  return new Response(jsonString, {
    headers: { 
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Disposition': `inline; filename="${id}.json"`,
    }
  });
}
