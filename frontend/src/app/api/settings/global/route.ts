import { NextResponse } from "next/server";
import { requireAdmin } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const settings = await prisma.globalSettings.findMany();
  const config = settings.reduce((acc, s) => {
    if (isSecretSetting(s.key)) return acc;
    return { ...acc, [s.key]: s.value };
  }, {});
  return NextResponse.json(config, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const entries = Object.entries(body);

    for (const [key, value] of entries) {
      if (isSecretSetting(key) && String(value) === "") continue;

      await prisma.globalSettings.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}

function isSecretSetting(key: string) {
  return /password|secret|token|api[_-]?key/i.test(key);
}
