import { normalizeBeachVolleyballGender, type BeachVolleyballGender } from "@/lib/sources/tbvolley/config";
import { detectTournamentSource, type TournamentSource } from "@/lib/utils/tournamentSource";

export type TBvolleyCachedTournament = {
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

export function selectCachedTBvolleyGenderTournament(
  current: TBvolleyCachedTournament,
  candidates: TBvolleyCachedTournament[],
  targetGender: BeachVolleyballGender,
) {
  const currentIdentity = buildTBvolleyCachedTournamentIdentity(current);
  if (!currentIdentity) return null;

  return candidates.find((candidate) => {
    const candidateIdentity = buildTBvolleyCachedTournamentIdentity(candidate);
    if (!candidateIdentity) return false;
    if (candidate.id === current.id) return false;
    if (candidateIdentity.source !== currentIdentity.source) return false;
    if (candidateIdentity.gender !== targetGender) return false;

    if (currentIdentity.source === "beachvolleyru") {
      return Boolean(currentIdentity.eventId && candidateIdentity.eventId === currentIdentity.eventId);
    }

    if (currentIdentity.source === "volleyballworld") {
      const sameTournamentNo = Boolean(currentIdentity.tournamentNo && candidateIdentity.tournamentNo === currentIdentity.tournamentNo);
      return sameTournamentNo || sameVisibleTournament(currentIdentity, candidateIdentity);
    }

    if (currentIdentity.source === "germanbeachtour") {
      return sameVisibleTournament(currentIdentity, candidateIdentity);
    }

    return false;
  }) || null;
}

type TBvolleyCachedTournamentIdentity = {
  source: Extract<TournamentSource, "volleyballworld" | "beachvolleyru" | "germanbeachtour">;
  gender: BeachVolleyballGender;
  titleKey: string;
  locationKey: string;
  startDateKey: string;
  endDateKey: string;
  formatKey: string;
  eventId: string;
  tournamentId: string;
  tournamentNo: string;
};

function buildTBvolleyCachedTournamentIdentity(tournament: TBvolleyCachedTournament): TBvolleyCachedTournamentIdentity | null {
  const root = asRecord(tournament.normalization);
  const volleyballWorld = asRecord(root?.volleyballWorld);
  const beachVolleyRu = asRecord(root?.beachVolleyRu);
  const germanBeachTour = asRecord(root?.germanBeachTour);
  const source = resolveSource(tournament, volleyballWorld, beachVolleyRu, germanBeachTour);
  if (!source) return null;

  const sourceNormalization = source === "volleyballworld"
    ? volleyballWorld
    : source === "beachvolleyru"
      ? beachVolleyRu
      : germanBeachTour;
  const gender = normalizeBeachVolleyballGender(sourceNormalization?.gender);
  if (!gender) return null;

  return {
    source,
    gender,
    titleKey: normalizeText(stripGenderSuffix(tournament.sourceTitle) || stripGenderSuffix(tournament.name)),
    locationKey: normalizeText(tournament.location),
    startDateKey: toDateKey(tournament.startDate),
    endDateKey: toDateKey(tournament.endDate),
    formatKey: normalizeText(readString(sourceNormalization?.subCompetitionType) || readString(sourceNormalization?.type) || readString(sourceNormalization?.kind) || tournament.formatText),
    eventId: readString(beachVolleyRu?.eventId),
    tournamentId: readString(germanBeachTour?.tournamentId),
    tournamentNo: readString(volleyballWorld?.tournamentNo),
  };
}

function sameVisibleTournament(
  current: TBvolleyCachedTournamentIdentity,
  candidate: TBvolleyCachedTournamentIdentity,
) {
  return Boolean(current.titleKey && candidate.titleKey && current.titleKey === candidate.titleKey)
    && current.locationKey === candidate.locationKey
    && current.startDateKey === candidate.startDateKey
    && current.endDateKey === candidate.endDateKey
    && current.formatKey === candidate.formatKey;
}

function resolveSource(
  tournament: TBvolleyCachedTournament,
  volleyballWorld: Record<string, unknown> | null,
  beachVolleyRu: Record<string, unknown> | null,
  germanBeachTour: Record<string, unknown> | null,
): TBvolleyCachedTournamentIdentity["source"] | null {
  const detected = detectTournamentSource(tournament.sourceUrl);
  if (detected === "volleyballworld" || detected === "beachvolleyru" || detected === "germanbeachtour") return detected;
  if (volleyballWorld) return "volleyballworld";
  if (beachVolleyRu) return "beachvolleyru";
  if (germanBeachTour) return "germanbeachtour";
  return null;
}

function stripGenderSuffix(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s*\[(?:VW|BVRU|GBT):[^\]]+]\s*$/i, "")
    .replace(/\s+—\s*(?:Men|Women|Мужчины|Женщины)\s*$/i, "")
    .trim();
}

function normalizeText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toDateKey(value: Date | string | null) {
  if (!value) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

function readString(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
