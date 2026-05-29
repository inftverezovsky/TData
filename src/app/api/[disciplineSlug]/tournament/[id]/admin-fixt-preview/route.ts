import { NextResponse } from 'next/server';
import { buildFixtPayload } from '@/lib/adminUpload/buildFixtPayload';
import { toAdminFixtPayloadEnvelope } from '@/lib/adminUpload/fixtPayloadFormat';
import { phpSerialize } from '@/lib/adminUpload/phpSerialize';
import { normalizeShapkaOverrides } from '@/lib/adminUpload/shapkaOverrides';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  // API remains callable directly; password gate is UI-only for settings visibility.

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
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
