import { NextResponse } from 'next/server';
import { findTournamentAdminMapping, upsertTournamentAdminMapping } from '@/lib/adminUpload/adminMappingStore';
import { queueIdentitySync } from '@/lib/sync/identitySync';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  const { id } = await params;
  try {
    const mapping = await findTournamentAdminMapping(id);

    return NextResponse.json(mapping || { tournamentId: id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; disciplineSlug: string }> }
) {
  const { disciplineSlug: routeDisciplineSlug, id } = await params;
  try {
    const body = await request.json();
    const { adminShapkaId, adminShapkaName, sourceTournamentName } = body;
    const disciplineSlug = routeDisciplineSlug;

    const mapping = await upsertTournamentAdminMapping({
      tournamentId: id,
      disciplineSlug,
      sourceTournamentName,
      adminShapkaId,
      adminShapkaName,
    });

    const identitySync = queueIdentitySync(`admin-mapping:${disciplineSlug}`);
    return NextResponse.json({ ...mapping, identitySync });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
