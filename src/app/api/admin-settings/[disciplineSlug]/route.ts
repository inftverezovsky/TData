import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/db';
import { getAdminAuthConfigStatus } from '@/lib/adminUpload/adminHttpClient';
import { resolveAdminSettings } from '@/lib/adminUpload/resolveAdminSettings';
import { requireAdmin } from '@/lib/auth/adminAuth';
import { queueIdentitySync } from '@/lib/sync/identitySync';

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;

  try {
    const settings = await resolveAdminSettings(disciplineSlug);
    const authStatus = getAdminAuthConfigStatus();

    const merged = {
      disciplineSlug: disciplineSlug,
      ...settings,
      authStatus,
    };

    return NextResponse.json(merged);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const {
      apiUrl,
      adminSportId,
      adminMax,
      defaultShapkaId,
      timezone,
      dateFormat,
      requestMode,
      sslVerify,
    } = body;

    const settings = await prisma.disciplineAdminSettings.upsert({
      where: { disciplineSlug: disciplineSlug },
      update: {
        apiUrl,
        adminSportId: adminSportId?.toString(),
        adminMax: adminMax?.toString(),
        defaultShapkaId: defaultShapkaId?.toString(),
        timezone,
        dateFormat,
        requestMode,
        sslVerify,
      },
      create: {
        disciplineSlug: disciplineSlug,
        apiUrl,
        adminSportId: adminSportId?.toString(),
        adminMax: adminMax?.toString(),
        defaultShapkaId: defaultShapkaId?.toString(),
        timezone: timezone || 'Europe/Moscow',
        dateFormat: dateFormat || 'DD.MM.YYYY HH:mm:ss',
        requestMode: requestMode || 'legacy_raw',
        sslVerify: sslVerify ?? true,
      },
    });

    const identitySync = queueIdentitySync(`admin-settings:${disciplineSlug}`);
    return NextResponse.json({ ...settings, identitySync });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
