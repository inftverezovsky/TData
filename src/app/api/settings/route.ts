import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/adminAuth";
import { prisma } from "@/lib/db/db";

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

  try {
    const data = await request.json();
    const { key, value } = data;

    if (!key) return NextResponse.json({ error: "Key is required" }, { status: 400 });
    if (isSecretSetting(key) && String(value) === "") {
      return NextResponse.json({ success: true, skipped: true });
    }

    await prisma.globalSettings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

function isSecretSetting(key: string) {
  return /password|secret|token|api[_-]?key/i.test(key);
}
