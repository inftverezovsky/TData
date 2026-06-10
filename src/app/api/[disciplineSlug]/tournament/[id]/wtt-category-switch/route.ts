import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { normalizeTableTennisCategoryScope } from "@/lib/sources/tablet/config";
import { selectCachedWttCategoryTournament } from "@/lib/sources/tablet/wttCategorySwitchCache";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> },
) {
  const { disciplineSlug, id } = await params;
  const slug = disciplineSlug.trim().toLowerCase();
  const body = (await request.json().catch(() => ({}))) as { categoryScope?: unknown };
  const targetCategory = normalizeTableTennisCategoryScope(body.categoryScope);

  if (slug !== "tabletennis") {
    return NextResponse.json({ error: "Переключение сетки WTT доступно только для TableT." }, { status: 400 });
  }

  if (!targetCategory) {
    return NextResponse.json({ error: "Нужно указать сетку WTT." }, { status: 400 });
  }

  const select = {
    id: true,
    sourceTitle: true,
    sourceUrl: true,
    name: true,
    startDate: true,
    endDate: true,
    location: true,
    formatText: true,
    normalization: true,
  } as const;

  const current = await prisma.tournament.findUnique({
    where: { id },
    select,
  });

  if (!current) {
    return NextResponse.json({ error: "Турнир не найден." }, { status: 404 });
  }

  const candidates = await prisma.tournament.findMany({
    where: {
      disciplineSlug: slug,
      id: { not: id },
    },
    select,
    orderBy: { updatedAt: "desc" },
  });

  const target = selectCachedWttCategoryTournament(current, candidates, targetCategory);

  if (!target) {
    return NextResponse.json({
      error: "Эта сетка ещё не загружена в кеш. Откройте WTT и нажмите «Загрузить данные», чтобы сохранить все доступные сетки турнира.",
    }, { status: 404 });
  }

  return NextResponse.json({
    cached: true,
    tournament: { id: target.id },
  });
}
