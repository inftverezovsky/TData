import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/db";
import { classifyFandomError, fetchFandomTournamentCargoEvents, makeFandomPageUrl, searchFandomTournamentPages } from "@/lib/fandom/client";

export const dynamic = "force-dynamic";

type FandomEventListItem = {
  id: string;
  title: string;
  url: string;
  dates: string | null;
  status: "upcoming";
};

export async function GET() {
  try {
    const dbTournaments = await prisma.tournament.findMany({
      where: { disciplineSlug: "leagueoflegends" },
      select: { id: true, name: true, sourceTitle: true },
    });

    const events = await loadFandomEvents();
    const linked = events.map((event) => {
      const lowerTitle = event.title.toLowerCase();
      const existing = dbTournaments.find((db) => {
        const names = [db.name, db.sourceTitle].map((value) => value.toLowerCase());
        return names.some((name) => lowerTitle.includes(name) || name.includes(lowerTitle));
      });

      return {
        ...event,
        dbId: existing?.id || null,
        isLinked: !!existing,
      };
    });

    return NextResponse.json({ ok: true, events: linked, errorClass: linked.length ? null : "empty_valid" });
  } catch (error) {
    const errorClass = classifyFandomError(error);
    const message = errorClass === "rate_limited"
      ? "Fandom временно ограничил список турниров."
      : error instanceof Error ? error.message : "Не удалось загрузить Fandom турниры.";
    return NextResponse.json({ ok: false, error: message, userMessage: message, errorClass }, { status: errorClass === "rate_limited" ? 429 : 500 });
  }
}

async function loadFandomEvents(): Promise<FandomEventListItem[]> {
  try {
    const cargo = await fetchFandomTournamentCargoEvents();
    const events: FandomEventListItem[] = cargo.map((item: any) => {
      const title = String(item?.title?.Name || item?.title?.OverviewPage || "");
      const overviewPage = String(item?.title?.OverviewPage || title);
      const dateStart = String(item?.title?.DateStart || "");
      const dateEnd = String(item?.title?.Date || "");
      return {
        id: overviewPage || title,
        title,
        url: makeFandomPageUrl(overviewPage || title),
        dates: [dateStart, dateEnd].filter(Boolean).join(" - ") || null,
        status: "upcoming" as const,
      };
    }).filter((event: FandomEventListItem) => event.title);
    if (events.length > 0) return events;
  } catch {
    // Cargo is often rate-limited on Fandom; fallback to normal search below.
  }

  const currentYear = new Date().getFullYear();
  const queries = [
    `World Championship ${currentYear}`,
    `MSI ${currentYear}`,
    `Esports World Cup ${currentYear}`,
    `LCK ${currentYear}`,
    `LEC ${currentYear}`,
  ];
  const results = (await Promise.allSettled(queries.map((query) => searchFandomTournamentPages(query))))
    .flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const byUrl = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    if (!byUrl.has(result.pageUrl)) byUrl.set(result.pageUrl, result);
  }

  return Array.from(byUrl.values()).slice(0, 12).map((result) => ({
    id: String(result.pageId),
    title: result.title,
    url: result.pageUrl,
    dates: result.dates ?? null,
    status: "upcoming" as const,
  }));
}
