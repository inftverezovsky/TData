export const BEACH_VOLLEYBALL_DISCIPLINE_SLUG = "beachvolleyball";
export const BEACH_VOLLEYBALL_MEN_MAPPING_SLUG = "beachvolleyball-men";
export const BEACH_VOLLEYBALL_WOMEN_MAPPING_SLUG = "beachvolleyball-women";
export const BEACH_VOLLEYBALL_ADMIN_SPORT_ID = "58";

export type BeachVolleyballGender = "men" | "women";

export function isBeachVolleyballScopeSlug(value: string | null | undefined) {
  const slug = String(value || "").trim().toLowerCase();
  return slug === BEACH_VOLLEYBALL_DISCIPLINE_SLUG
    || slug === BEACH_VOLLEYBALL_MEN_MAPPING_SLUG
    || slug === BEACH_VOLLEYBALL_WOMEN_MAPPING_SLUG;
}

export function normalizeBeachVolleyballGender(value: unknown): BeachVolleyballGender | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "women" || normalized === "woman" || normalized === "female" || normalized.startsWith("жен")) {
    return "women";
  }
  if (normalized === "men" || normalized === "man" || normalized === "male" || normalized.startsWith("муж")) {
    return "men";
  }
  return null;
}

export function getBeachVolleyballMappingSlug(gender: unknown) {
  const normalizedGender = normalizeBeachVolleyballGender(gender);
  if (normalizedGender === "women") return BEACH_VOLLEYBALL_WOMEN_MAPPING_SLUG;
  if (normalizedGender === "men") return BEACH_VOLLEYBALL_MEN_MAPPING_SLUG;
  return BEACH_VOLLEYBALL_DISCIPLINE_SLUG;
}

export function resolveTournamentTeamMappingDisciplineSlug(disciplineSlug: string, normalization: unknown) {
  const slug = disciplineSlug.trim().toLowerCase();
  if (slug !== BEACH_VOLLEYBALL_DISCIPLINE_SLUG) return slug;

  return getBeachVolleyballMappingSlug(readBeachVolleyballGenderFromNormalization(normalization));
}

export function readVolleyballWorldGenderFromNormalization(normalization: unknown) {
  const root = asRecord(normalization);
  const volleyballWorld = asRecord(root?.volleyballWorld);
  return volleyballWorld?.gender ?? null;
}

export function readBeachVolleyballGenderFromNormalization(normalization: unknown) {
  const root = asRecord(normalization);
  const volleyballWorld = asRecord(root?.volleyballWorld);
  const beachVolleyRu = asRecord(root?.beachVolleyRu);
  const germanBeachTour = asRecord(root?.germanBeachTour);
  return volleyballWorld?.gender ?? beachVolleyRu?.gender ?? germanBeachTour?.gender ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
