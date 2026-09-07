import { NextResponse } from "next/server";
import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { isSecretSetting, prepareGlobalSettingEntries } from "@backend/settings/globalSettings";
import { apiErrorResponse, ApiRequestError, logApiError } from "@backend/http/apiResponse";
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
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  // Отсекаем запросы с чужого origin до чтения и сохранения настройки.
  const unsafeMutation = requireSameOriginJsonMutation(request);
  if (unsafeMutation) return unsafeMutation;

  try {
    const data = await readJsonRequest(request);
    if (!data || typeof data !== "object" || !("key" in data) || !("value" in data) || typeof data.key !== "string") {
      throw new ApiRequestError("INVALID_SETTINGS", 400, "Key and value are required.");
    }
    const entries = await prepareGlobalSettingEntries({ [data.key]: data.value });
    if (entries.length === 0) {
      return NextResponse.json({ success: true, skipped: true });
    }
    const { key, value } = entries[0];
    await prisma.globalSettings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError("settings-write", error);
    return apiErrorResponse(error, "Failed to update settings.");
  }
}
