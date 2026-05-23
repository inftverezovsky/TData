import { NextResponse } from 'next/server';
import { buildFixtPayload } from '@/lib/adminUpload/buildFixtPayload';
import { phpSerialize } from '@/lib/adminUpload/phpSerialize';
import { requireAdmin } from '@/lib/auth/adminAuth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  const { disciplineSlug: routeDisciplineSlug, id } = await params;
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const disciplineSlug = routeDisciplineSlug;
    const selectedMatchIds = body.selectedMatchIds;

    const buildResult = await buildFixtPayload(id, disciplineSlug, selectedMatchIds);
    
    let serialized = '';
    let postBody = '';
    
    if (buildResult.payload) {
      serialized = phpSerialize(buildResult.payload);
      postBody = `fixt=${serialized}`;
    }

    return NextResponse.json({
      ok: true,
      phpArray: buildResult.payload,
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
