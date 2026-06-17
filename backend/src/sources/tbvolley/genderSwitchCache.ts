import { normalizeBeachVolleyballGender, type BeachVolleyballGender } from "@backend/sources/tbvolley/config";
import { detectTournamentSource, type TournamentSource } from "@backend/utils/tournamentSource";

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

    if (currentIdentity.source === "twelvendrcsvp" || currentIdentity.source === "twelvendroevv") {
      return sameVisibleTournament(currentIdentity, candidateIdentity);
    }

    if (currentIdentity.source === "cbv") {
      return Boolean(currentIdentity.categoryKey && currentIdentity.categoryKey === candidateIdentity.categoryKey)
        && sameVisibleTournament(currentIdentity, candidateIdentity);
    }

    if (currentIdentity.source === "federvolley") {
      return Boolean(currentIdentity.categoryKey && currentIdentity.categoryKey === candidateIdentity.categoryKey)
        && sameVisibleTournament(currentIdentity, candidateIdentity);
    }

    return false;
  }) || null;
}

type TBvolleyCachedTournamentIdentity = {
  source: Extract<TournamentSource, "volleyballworld" | "beachvolleyru" | "germanbeachtour" | "twelvendrcsvp" | "twelvendroevv" | "cbv" | "federvolley">;
  gender: BeachVolleyballGender;
  titleKey: string;
  locationKey: string;
  startDateKey: string;
  endDateKey: string;
  formatKey: string;
  categoryKey: string;
  eventId: string;
  tournamentId: string;
  tournamentNo: string;
  tcode: string;
  etapaId: string;
  federvolleyNodeId: string;
  matchshareLid: string;
};

function buildTBvolleyCachedTournamentIdentity(tournament: TBvolleyCachedTournament): TBvolleyCachedTournamentIdentity | null {
  const root = asRecord(tournament.normalization);
  const volleyballWorld = asRecord(root?.volleyballWorld);
  const beachVolleyRu = asRecord(root?.beachVolleyRu);
  const germanBeachTour = asRecord(root?.germanBeachTour);
  const twelveNdr = asRecord(root?.twelveNdr);
  const cbv = asRecord(root?.cbv);
  const federvolley = asRecord(root?.federvolley);
  const source = resolveSource(tournament, volleyballWorld, beachVolleyRu, germanBeachTour, twelveNdr, cbv, federvolley);
  if (!source) return null;

  const sourceNormalization = source === "volleyballworld"
    ? volleyballWorld
    : source === "beachvolleyru"
      ? beachVolleyRu
      : source === "germanbeachtour"
        ? germanBeachTour
        : source === "cbv"
          ? cbv
          : source === "federvolley"
            ? federvolley
            : twelveNdr;
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
    categoryKey: normalizeText(readString(sourceNormalization?.category) || readString(sourceNormalization?.championship) || readString(sourceNormalization?.calendarMode)),
    eventId: readString(beachVolleyRu?.eventId),
    tournamentId: readString(germanBeachTour?.tournamentId),
    tournamentNo: readString(volleyballWorld?.tournamentNo),
    tcode: readString(twelveNdr?.tcode),
    etapaId: readString(cbv?.etapaId),
    federvolleyNodeId: readString(federvolley?.nodeId),
    matchshareLid: readString(federvolley?.matchshareLid),
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
  twelveNdr: Record<string, unknown> | null,
  cbv: Record<string, unknown> | null,
  federvolley: Record<string, unknown> | null,
): TBvolleyCachedTournamentIdentity["source"] | null {
  const detected = detectTournamentSource(tournament.sourceUrl);
  if ((detected === "twelvendrcsvp" || detected === "twelvendroevv") && twelveNdr) {
    return readString(twelveNdr.source) === "twelvendroevv" ? "twelvendroevv" : "twelvendrcsvp";
  }
  if (
    detected === "volleyballworld"
    || detected === "beachvolleyru"
    || detected === "germanbeachtour"
    || detected === "twelvendrcsvp"
    || detected === "twelvendroevv"
    || detected === "cbv"
    || detected === "federvolley"
  ) return detected;
  if (volleyballWorld) return "volleyballworld";
  if (beachVolleyRu) return "beachvolleyru";
  if (germanBeachTour) return "germanbeachtour";
  if (twelveNdr) return readString(twelveNdr.source) === "twelvendroevv" ? "twelvendroevv" : "twelvendrcsvp";
  if (cbv) return "cbv";
  if (federvolley) return "federvolley";
  return null;
}

function stripGenderSuffix(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s*\[(?:VW|BVRU|GBT|CBV|FIPAV|12NDR-(?:CSVP|OEVV)):[^\]]+]\s*$/i, "")
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
