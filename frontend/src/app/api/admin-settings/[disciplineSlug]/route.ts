import { safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from 'next/server';
import { prisma } from '@backend/db/db';
import { requireAdmin, requireSameOriginJsonMutation } from '@backend/auth/adminAuth';
import { getAdminAuthConfigStatus } from '@backend/adminUpload/adminHttpClient';
import { resolveAdminSettings } from '@backend/adminUpload/resolveAdminSettings';
import { queueIdentitySync } from '@backend/sync/identitySync';

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

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
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  // После сессии проверяем Origin и JSON-формат; только затем разрешаем изменение интеграции.
  const unsafeMutation = requireSameOriginJsonMutation(request);
  if (unsafeMutation) return unsafeMutation;

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
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
