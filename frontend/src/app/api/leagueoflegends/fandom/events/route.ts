import { NextResponse } from "next/server";
import { prisma } from "@backend/db/db";
import { classifyFandomError, fetchFandomTournamentCargoEvents, makeFandomPageUrl, searchFandomTournamentPages } from "@backend/sources/tdata/fandom/client";

export const dynamic = "force-dynamic";

type FandomEventListItem = {
  id: string;
  title: string;
  url: string;
  dates: string | null;
  status: "upcoming";
};

const FANDOM_EVENTS_FALLBACK_WINDOW_DAYS = Number(process.env.FANDOM_EVENTS_FUTURE_WINDOW_DAYS || 60);

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

  const now = new Date();
  const currentYear = now.getFullYear();
  const futureYear = new Date(now.getTime() + FANDOM_EVENTS_FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000).getFullYear();
  const years = Array.from(new Set([currentYear, futureYear]));
  const queries = years.flatMap((year) => [
    `MSI ${year}`,
    `Esports World Cup ${year}`,
  ]);
  const results = (await Promise.allSettled(queries.map((query) => searchFandomTournamentPages(query))))
    .flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const byUrl = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    if (!byUrl.has(result.pageUrl)) byUrl.set(result.pageUrl, result);
  }

  return Array.from(byUrl.values())
    .filter((result) => shouldKeepFandomFallbackEvent(result.title, years))
    .slice(0, 20)
    .map((result) => ({
      id: String(result.pageId),
      title: result.title,
      url: result.pageUrl,
      dates: result.dates ?? null,
      status: "upcoming" as const,
    }));
}

function shouldKeepFandomFallbackEvent(title: string, allowedYears: number[]) {
  const years = extractFandomTitleYears(title);
  if (years.length === 0) return false;
  if (!years.some((year) => allowedYears.includes(year))) return false;
  if (!/(mid-season invitational|\bmsi\b|road to msi|esports world cup)/i.test(title)) return false;
  if (/world championship/i.test(title)) return false;
  if (/\/(?:scoreboards|teams timeline|prospective participant timeline|upcoming qualifying matches)(?:\/|$)/i.test(title)) return false;
  return true;
}

function extractFandomTitleYears(title: string) {
  return Array.from(String(title || "").matchAll(/\b(20\d{2})\b/g)).map((match) => Number(match[1]));
}
