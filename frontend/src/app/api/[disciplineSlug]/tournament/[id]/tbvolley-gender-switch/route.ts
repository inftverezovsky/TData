import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { normalizeBeachVolleyballGender } from "@backend/sources/tbvolley/config";
import { selectCachedTBvolleyGenderTournament } from "@backend/sources/tbvolley/genderSwitchCache";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string; id: string }> },
) {
  const { disciplineSlug, id } = await params;
  const slug = disciplineSlug.trim().toLowerCase();
  const body = (await request.json().catch(() => ({}))) as { gender?: unknown };
  const targetGender = normalizeBeachVolleyballGender(body.gender);

  if (slug !== "beachvolleyball") {
    return NextResponse.json({ error: "Переключение сетки доступно только для пляжного волейбола." }, { status: 400 });
  }

  if (!targetGender) {
    return NextResponse.json({ error: "Нужно указать сетку: men или women." }, { status: 400 });
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

  const target = selectCachedTBvolleyGenderTournament(current, candidates, targetGender);

  if (!target) {
    return NextResponse.json({
      error: "Эта сетка ещё не загружена в кеш. Нажмите «Загрузить данные» на странице источника, чтобы сохранить обе сетки.",
    }, { status: 404 });
  }

  return NextResponse.json({
    cached: true,
    tournament: { id: target.id },
  });
}
