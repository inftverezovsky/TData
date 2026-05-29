import { buildFixtPayload } from "@/lib/adminUpload/buildFixtPayload";
import { toAdminFixtPayloadEnvelope } from "@/lib/adminUpload/fixtPayloadFormat";
import { readShapkaOverridesSearchParam } from "@/lib/adminUpload/shapkaOverrides";
import { toPhpString } from "@/lib/adminUpload/utils";
import { prisma } from "@/lib/db/db";

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
    select: { id: true },
  });

  if (!tournament) {
    return new Response("Tournament not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const buildResult = await buildFixtPayload(id, disciplineSlug, selectedIds, shapkaIdBySelectionId);

  if (!buildResult.payload) {
    return new Response(["Данные не готовы.", ...buildResult.warnings].join("\n"), {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": `inline; filename="${id}.php.txt"`,
      },
    });
  }

  return new Response(toPhpString(toAdminFixtPayloadEnvelope(buildResult.payload)), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": `inline; filename="${id}.php.txt"`,
    },
  });
}
