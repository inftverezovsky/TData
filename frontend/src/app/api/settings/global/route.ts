import { NextResponse } from "next/server";
import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { isSecretSetting, prepareGlobalSettingEntries } from "@backend/settings/globalSettings";
import { apiErrorResponse, logApiError } from "@backend/http/apiResponse";
import { readJsonRequest } from "@backend/http/requestBody";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const settings = await prisma.globalSettings.findMany();
    const config = settings.reduce((acc, s) => {
      if (isSecretSetting(s.key)) return acc;
      return { ...acc, [s.key]: s.value };
    }, {});
    return NextResponse.json(config, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logApiError("global-settings-read", error);
    return apiErrorResponse(error, "Failed to read settings.");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  // Изменение общих настроек требует и сессию, и подтверждённый источник запроса.
  const unsafeMutation = requireSameOriginJsonMutation(request);
  if (unsafeMutation) return unsafeMutation;

  try {
    const entries = await prepareGlobalSettingEntries(await readJsonRequest(request));
    // Проверка и хеширование завершаются до первой записи; весь набор сохраняется атомарно.
    await prisma.$transaction(entries.map(({ key, value }) => prisma.globalSettings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })));

    return NextResponse.json({ ok: true });
  } catch (err) {
    logApiError("global-settings-write", err);
    return apiErrorResponse(err, "Failed to save settings.");
  }
}
