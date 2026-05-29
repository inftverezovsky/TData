import { NextResponse } from "next/server";
import { searchFandomTournamentPages, classifyFandomError } from "@/lib/sources/TCyber/fandom/client";
import { prisma } from "@/lib/db/db";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") || "").trim();

  try {
    if (query.length < 2) {
      return NextResponse.json({ ok: false, error: "Введите минимум 2 символа", results: [] }, { status: 400 });
    }

    const results = await searchFandomTournamentPages(query);
    await logFandomRequest({ query, matchesCount: results.length, errorClass: results.length ? null : "empty_valid" });
    return NextResponse.json({ ok: true, query, results });
  } catch (error) {
    const errorClass = classifyFandomError(error);
    const message = toFandomUserMessage(errorClass, error);
    await logFandomRequest({ query, matchesCount: null, errorClass });
    return NextResponse.json({ ok: false, error: message, userMessage: message, errorClass }, { status: errorClass === "rate_limited" ? 429 : 500 });
  }
}

function toFandomUserMessage(errorClass: string, error: unknown) {
  if (errorClass === "rate_limited") return "Fandom временно ограничил запросы. Подождите пару минут и повторите.";
  if (errorClass === "non_json") return "Fandom вернул некорректный ответ.";
  if (errorClass === "network_error") return "Не удалось подключиться к Fandom.";
  return error instanceof Error ? error.message : "Не удалось выполнить поиск Fandom.";
}

async function logFandomRequest(data: {
  query: string;
  matchesCount?: number | null;
  errorClass?: string | null;
}) {
  await prisma.parserRequestLog.create({
    data: {
      source: "fandom",
      mode: "search",
      route: "/api/leagueoflegends/search-fandom",
      disciplineSlug: "leagueoflegends",
      queryHash: crypto.createHash("sha1").update(data.query).digest("hex"),
      errorClass: data.errorClass || null,
      cacheHit: false,
      cacheLayer: null,
      matchesCount: data.matchesCount ?? null,
    },
  }).catch(() => {});
}
