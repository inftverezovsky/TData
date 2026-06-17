import { buildFixtPayload } from "@backend/adminUpload/buildFixtPayload";
import { toAdminFixtPayloadEnvelope } from "@backend/adminUpload/fixtPayloadFormat";
import { readShapkaOverridesSearchParam } from "@backend/adminUpload/shapkaOverrides";
import { toPhpString } from "@backend/adminUpload/utils";
import { prisma } from "@backend/db/db";

export async function GET(request: Request, { params }: { params: Promise<{ disciplineSlug: string; id: string }> }) {
  const { disciplineSlug, id } = await params;
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  const selectedIds = idsParam ? idsParam.split(",") : undefined;
  const shapkaIdBySelectionId = readShapkaOverridesSearchParam(searchParams);

  const tournament = await prisma.tournament.findUnique({ where: { id } });
  if (!tournament) {
    return new Response("Tournament not found", { status: 404 });
  }

  const buildResult = await buildFixtPayload(id, disciplineSlug, selectedIds, shapkaIdBySelectionId);
  if (!buildResult.payload) {
    const errorMsg = "Данные не готовы.\n\n" + buildResult.warnings.join("\n");
    return new Response(errorMsg, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const phpString = toPhpString(toAdminFixtPayloadEnvelope(buildResult.payload));
  return new Response(phpString, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
