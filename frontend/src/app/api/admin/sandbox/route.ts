import { logApiError, safeErrorMessage } from "@backend/http/apiResponse";
import { NextResponse } from "next/server";
import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { getNormalizer, hasNormalizer } from "@backend/normalizers/registry";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Публичный парсер запускаем только для запроса из интерфейса своего сайта.
  const invalidMutation = requireSameOriginJsonMutation(request);
  if (invalidMutation) return invalidMutation;

  try {
    const { disciplineSlug, wikitext } = await request.json();

    if (!disciplineSlug || !wikitext) {
      return NextResponse.json({ error: "Необходимы параметры disciplineSlug и wikitext" }, { status: 400 });
    }

    const slug = disciplineSlug.trim().toLowerCase();
    if (!hasNormalizer(slug)) {
      return NextResponse.json({ error: `Дисциплина ${slug} не поддерживается` }, { status: 400 });
    }

    const normalizer = getNormalizer(slug);
    const result = normalizer({
      title: "Песочница Тест",
      pageUrl: "https://liquipedia.net/sandbox",
      wikitext: wikitext,
    });

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    logApiError("api:admin/sandbox/route.ts", error);
    return NextResponse.json({ error: safeErrorMessage(error) || "Ошибка парсинга" }, { status: 500 });
  }
}
