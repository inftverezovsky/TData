import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from 'next/server';
import { buildFixtPayload } from '@backend/adminUpload/buildFixtPayload';
import { toAdminFixtPayloadEnvelope } from '@backend/adminUpload/fixtPayloadFormat';
import { phpSerialize } from '@backend/adminUpload/phpSerialize';
import { normalizeShapkaOverrides } from '@backend/adminUpload/shapkaOverrides';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  const { disciplineSlug: routeDisciplineSlug, id } = await params;
  try {
    const body = await request.json();
    const disciplineSlug = routeDisciplineSlug;
    const selectedMatchIds = body.selectedMatchIds;
    const shapkaIdBySelectionId = normalizeShapkaOverrides(body.shapkaIdBySelectionId);

    const buildResult = await buildFixtPayload(id, disciplineSlug, selectedMatchIds, shapkaIdBySelectionId);
    
    let serialized = '';
    let postBody = '';
    
    const adminPayload = buildResult.payload ? toAdminFixtPayloadEnvelope(buildResult.payload) : null;

    if (adminPayload) {
      serialized = phpSerialize(adminPayload);
      postBody = `fixt=${serialized}`;
    }

    return NextResponse.json({
      ok: true,
      phpArray: adminPayload,
      serialized,
      postBody,
      readyMatchesCount: buildResult.readyMatchesCount,
      skippedMatches: buildResult.skippedMatches,
      warnings: buildResult.warnings,
    });
  } catch (error: any) {
    logApiError("api:[disciplineSlug]/tournament/[id]/admin-fixt-preview/route.ts", error);
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}
