import {
  normalizeTableTennisCategoryScope,
  type TableTennisCategoryScope,
} from "@/lib/sources/tablet/config";

export type WttCachedTournament = {
  id: string;
  sourceTitle: string;
  sourceUrl: string | null;
  name: string;
  startDate: Date | string | null;
  endDate: Date | string | null;
  location: string | null;
  formatText: string | null;
  normalization: unknown;
};

export function selectCachedWttCategoryTournament(
  current: WttCachedTournament,
  candidates: WttCachedTournament[],
  targetCategory: TableTennisCategoryScope,
) {
  const currentIdentity = buildWttCachedTournamentIdentity(current);
  if (!currentIdentity) return null;

  return candidates.find((candidate) => {
    if (candidate.id === current.id) return false;
    const candidateIdentity = buildWttCachedTournamentIdentity(candidate);
    if (!candidateIdentity) return false;

    return candidateIdentity.eventId === currentIdentity.eventId
      && candidateIdentity.categoryScope === targetCategory;
  }) || null;
}

function buildWttCachedTournamentIdentity(tournament: WttCachedTournament) {
  const root = asRecord(tournament.normalization);
  const wtt = asRecord(root?.wtt);
  const eventId = readString(wtt?.eventId) || inferWttEventId(tournament.sourceTitle, tournament.sourceUrl);
  const categoryScope = normalizeTableTennisCategoryScope(wtt?.categoryScope || inferWttCategoryScope(tournament.sourceTitle, tournament.name));

  if (!eventId || !categoryScope) return null;

  return {
    eventId,
    categoryScope,
  };
}

function inferWttEventId(...values: Array<unknown>) {
  for (const value of values) {
    const text = readString(value);
    if (!text) continue;

    const marker = text.match(/\[WTT:(\d+)(?::[^\]]+)?]/i);
    if (marker) return marker[1];

    try {
      const url = new URL(text);
      const id = url.searchParams.get("eventId");
      if (id) return id.trim();
    } catch {
      const loose = text.match(/(?:eventId=|event\/|#)(\d{3,})/i);
      if (loose) return loose[1];
    }
  }
  return "";
}

function inferWttCategoryScope(...values: Array<unknown>) {
  for (const value of values) {
    const text = readString(value);
    if (!text) continue;
    const marker = text.match(/\[WTT:\d+:([^\]]+)]/i);
    if (marker) return marker[1];
  }
  return "";
}

function readString(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
