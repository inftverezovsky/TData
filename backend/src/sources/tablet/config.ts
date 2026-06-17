export const TABLE_TENNIS_DISCIPLINE_SLUG = "tabletennis";
export const TABLE_TENNIS_MEN_SINGLES_MAPPING_SLUG = "tabletennis-men";
export const TABLE_TENNIS_WOMEN_SINGLES_MAPPING_SLUG = "tabletennis-women";
export const TABLE_TENNIS_MEN_DOUBLES_MAPPING_SLUG = "tabletennis-men-doubles";
export const TABLE_TENNIS_WOMEN_DOUBLES_MAPPING_SLUG = "tabletennis-women-doubles";
export const TABLE_TENNIS_MIXED_DOUBLES_MAPPING_SLUG = "tabletennis-mixed";

export type TableTennisCategoryScope =
  | "men"
  | "women"
  | "men-doubles"
  | "women-doubles"
  | "mixed";

export function isTableTennisScopeSlug(value: string | null | undefined) {
  const slug = String(value || "").trim().toLowerCase();
  return slug === TABLE_TENNIS_DISCIPLINE_SLUG
    || slug === TABLE_TENNIS_MEN_SINGLES_MAPPING_SLUG
    || slug === TABLE_TENNIS_WOMEN_SINGLES_MAPPING_SLUG
    || slug === TABLE_TENNIS_MEN_DOUBLES_MAPPING_SLUG
    || slug === TABLE_TENNIS_WOMEN_DOUBLES_MAPPING_SLUG
    || slug === TABLE_TENNIS_MIXED_DOUBLES_MAPPING_SLUG;
}

export function getTableTennisMappingSlug(category: unknown) {
  const normalized = normalizeTableTennisCategoryScope(category);
  if (normalized === "men") return TABLE_TENNIS_MEN_SINGLES_MAPPING_SLUG;
  if (normalized === "women") return TABLE_TENNIS_WOMEN_SINGLES_MAPPING_SLUG;
  if (normalized === "men-doubles") return TABLE_TENNIS_MEN_DOUBLES_MAPPING_SLUG;
  if (normalized === "women-doubles") return TABLE_TENNIS_WOMEN_DOUBLES_MAPPING_SLUG;
  if (normalized === "mixed") return TABLE_TENNIS_MIXED_DOUBLES_MAPPING_SLUG;
  return TABLE_TENNIS_DISCIPLINE_SLUG;
}

export function normalizeTableTennisCategoryScope(value: unknown): TableTennisCategoryScope | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized === "men-doubles"
    || normalized === "men doubles"
    || normalized === "men's doubles"
    || normalized === "mdoubles"
    || normalized === "m doubles"
    || normalized === "мужские пары"
    || normalized === "муж пары"
    || normalized === "муж. пары"
  ) {
    return "men-doubles";
  }

  if (
    normalized === "women-doubles"
    || normalized === "women doubles"
    || normalized === "women's doubles"
    || normalized === "wdoubles"
    || normalized === "w doubles"
    || normalized === "женские пары"
    || normalized === "жен пары"
    || normalized === "жен. пары"
  ) {
    return "women-doubles";
  }

  if (
    normalized === "men"
    || normalized === "mens"
    || normalized === "men singles"
    || normalized === "men's singles"
    || normalized === "msingles"
    || normalized === "мужчины"
    || normalized === "муж"
  ) {
    return "men";
  }

  if (
    normalized === "women"
    || normalized === "womens"
    || normalized === "women singles"
    || normalized === "women's singles"
    || normalized === "wsingles"
    || normalized === "женщины"
    || normalized === "жен"
  ) {
    return "women";
  }

  if (
    normalized === "mixed"
    || normalized === "mixed doubles"
    || normalized === "x doubles"
    || normalized === "xdoubles"
    || normalized.startsWith("микс")
  ) {
    return "mixed";
  }

  return null;
}

export function readTableTennisCategoryFromNormalization(normalization: unknown) {
  const root = asRecord(normalization);
  const wtt = asRecord(root?.wtt);
  return wtt?.categoryScope ?? null;
}

export function resolveTournamentTeamMappingDisciplineSlug(disciplineSlug: string, normalization: unknown) {
  const slug = disciplineSlug.trim().toLowerCase();
  if (slug === TABLE_TENNIS_DISCIPLINE_SLUG) {
    return getTableTennisMappingSlug(readTableTennisCategoryFromNormalization(normalization));
  }
  return slug;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
